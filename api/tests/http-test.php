<?php

declare(strict_types=1);

/*
 * Ende-zu-Ende über HTTP: «php -S» mit scripts/php-router.php (wie lokal und in den E2E-Tests).
 * Prüft Routing, SPA-Fallback, Header, Cookies und den echten Anfrage-Körper.
 */

/** @return array{status: int, header: array<string, list<string>>, body: string} */
function http(string $methode, string $url, ?string $body = null, array $header = []): array
{
    $ch = curl_init($url);
    $antwortHeader = [];
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST => $methode,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => $header,
        CURLOPT_TIMEOUT => 20,
        CURLOPT_PATH_AS_IS => true,
        CURLOPT_HEADERFUNCTION => static function ($ch, string $zeile) use (&$antwortHeader): int {
            if (str_contains($zeile, ':')) {
                [$n, $w] = explode(':', $zeile, 2);
                $antwortHeader[strtolower(trim($n))][] = trim($w);
            }
            return strlen($zeile);
        },
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    $inhalt = curl_exec($ch);
    return ['status' => (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE), 'header' => $antwortHeader, 'body' => (string) $inhalt];
}

/** Startet php -S mit Router, Test-Konfiguration und einem kleinen Webroot. */
function httpServer(): string
{
    static $basis = null;
    if ($basis !== null) {
        return $basis;
    }
    $tmp = sys_get_temp_dir() . '/lernapp-http-' . getmypid();
    @mkdir($tmp . '/web/bilder', 0700, true);
    file_put_contents($tmp . '/web/index.html', '<!doctype html><title>Lernapp</title>');
    file_put_contents($tmp . '/web/main-ABC123.js', 'console.log(1)');
    file_put_contents($tmp . '/web/bilder/a.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
    file_put_contents($tmp . '/web/.ftp-deploy-sync-state.json', '{}');
    $k = testKonfig();
    file_put_contents($tmp . '/config.php', '<?php return ' . var_export([
        'db_dsn' => $k->dbDsn, 'db_user' => $k->dbUser, 'db_password' => $k->dbPassword,
        'tabellen_praefix' => 'phptest_', 'google_client_id' => CLIENT_ID, 'google_client_secret' => CLIENT_SECRET,
        'basis_url' => BASIS, 'erlaubte_emails' => ['anna@example.com'], 'deploy_token' => 'deploy-test-token', 'testmodus' => true,
    ], true) . ';');

    $sock = stream_socket_server('tcp://127.0.0.1:0');
    $name = (string) stream_socket_get_name($sock, false);
    fclose($sock);
    $port = (int) substr($name, strrpos($name, ':') + 1);
    $env = getenv() + ['LERNAPP_CONFIG' => $tmp . '/config.php', 'LERNAPP_WEBROOT' => $tmp . '/web'];
    $env['LERNAPP_CONFIG'] = $tmp . '/config.php';
    $env['LERNAPP_WEBROOT'] = $tmp . '/web';
    $prozess = proc_open(
        [PHP_BINARY, '-d', 'post_max_size=16M', '-S', '127.0.0.1:' . $port, dirname(__DIR__, 2) . '/scripts/php-router.php'],
        [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']],
        $pipes,
        null,
        $env,
    );
    register_shutdown_function(static function () use ($prozess, $tmp): void {
        proc_terminate($prozess);
        proc_close($prozess);
        foreach (array_merge(glob($tmp . '/web/bilder/*') ?: [], glob($tmp . '/web/{,.}*', GLOB_BRACE) ?: [], [$tmp . '/config.php']) as $datei) {
            if (is_file($datei)) {
                unlink($datei);
            }
        }
        @rmdir($tmp . '/web/bilder');
        @rmdir($tmp . '/web');
        @rmdir($tmp);
    });
    warteAufPort($port);
    return $basis = 'http://127.0.0.1:' . $port;
}

test('http: Router liefert App, SPA-Fallback und echte 404', function (): void {
    $b = httpServer();
    $start = http('GET', "$b/");
    gleich(200, $start['status']);
    wahr(str_contains($start['body'], '<title>Lernapp</title>'), 'index.html');
    gleich('<!doctype html><title>Lernapp</title>', http('GET', "$b/lektion/bio-p1/kurzfassung")['body'], 'SPA-Fallback');
    $js = http('GET', "$b/main-ABC123.js");
    gleich(200, $js['status']);
    gleich('text/javascript; charset=utf-8', $js['header']['content-type'][0]);
    gleich('image/svg+xml', http('GET', "$b/bilder/a.svg")['header']['content-type'][0]);
    gleich(404, http('GET', "$b/fehlt.js")['status'], 'Datei mit Endung fehlt');
    gleich(404, http('GET', "$b/.ftp-deploy-sync-state.json")['status'], 'Punktdatei');
    $ausserhalb = http('GET', "$b/../../../../../../etc/hosts");
    wahr(!str_contains($ausserhalb['body'], 'localhost'), 'Pfad ausserhalb nicht ausgeliefert');
});

test('http: API über den Router — Status, Header, 401, Test-Login, Sync', function (): void {
    $b = httpServer();
    $status = http('GET', "$b/api/status");
    gleich(200, $status['status']);
    gleich(['ok' => true, 'schema' => schemaVersion()], json_decode($status['body'], true));
    gleich('nosniff', $status['header']['x-content-type-options'][0] ?? null);
    gleich('no-store', $status['header']['cache-control'][0] ?? null);
    wahr(!isset($status['header']['access-control-allow-origin']), 'keine CORS-Header');

    gleich(401, http('GET', "$b/api/ich")['status']);
    gleich(404, http('GET', "$b/api/gibtsnicht")['status']);

    $login = http('POST', "$b/api/test/anmelden", '{"email":"anna@example.com","name":"Anna"}', ['Content-Type: application/json', 'X-Lernapp: 1']);
    gleich(200, $login['status'], 'Test-Login unter php -S');
    $setCookie = $login['header']['set-cookie'][0] ?? '';
    wahr(preg_match('/^lernapp_sitzung=([A-Za-z0-9_-]{43});/', $setCookie, $m) === 1, $setCookie);
    $cookie = 'Cookie: lernapp_sitzung=' . $m[1];
    gleich(200, http('GET', "$b/api/ich", null, [$cookie])['status']);

    $gross = json_encode(['datensaetze' => [ds('lektion', 'gross', str_repeat('ü', 1024 * 1024))]]); // ~2–6 MB
    $hoch = http('POST', "$b/api/sync", $gross, [$cookie, 'Content-Type: application/json', 'X-Lernapp: 1']);
    gleich(200, $hoch['status'], 'grosser Körper');
    gleich(1, json_decode($hoch['body'], true)['angenommen']);
    $runter = json_decode(http('GET', "$b/api/sync?seit=0", null, [$cookie])['body'], true);
    gleich(str_repeat('ü', 1024 * 1024), $runter['datensaetze'][0]['daten']);

    // Konto-Prüfung über den echten Header (veralteter Tab einer anderen Person → 409)
    $konto = json_decode($login['body'], true)['konto'];
    $anders = http('GET', "$b/api/sync?seit=0", null, [$cookie, 'X-Lernapp-Konto: ' . str_repeat('0', 32)]);
    gleich(409, $anders['status'], 'anderes Konto');
    gleich('anderes-konto', json_decode($anders['body'], true)['fehler']);
    gleich(409, http('POST', "$b/api/sync", '{"datensaetze":[]}', [$cookie, 'Content-Type: application/json', 'X-Lernapp: 1', 'X-Lernapp-Konto: x'])['status'], 'POST anderes Konto');
    gleich(200, http('GET', "$b/api/sync?seit=0", null, [$cookie, 'X-Lernapp-Konto: ' . $konto])['status'], 'eigenes Konto');

    gleich(403, http('POST', "$b/api/sync", $gross, [$cookie, 'Content-Type: application/json'])['status'], 'CSRF über HTTP');
    gleich(204, http('POST', "$b/api/auth/abmelden", null, [$cookie, 'X-Lernapp: 1'])['status']);
    gleich(401, http('GET', "$b/api/ich", null, [$cookie])['status'], 'nach Abmelden');
});

test('http: Google-Start leitet um, Migration per Token', function (): void {
    $b = httpServer();
    $start = http('GET', "$b/api/auth/google/start?zurueck=%2Flektion%2Fx");
    gleich(302, $start['status']);
    wahr(str_starts_with($start['header']['location'][0] ?? '', 'https://accounts.google.com/'), 'Location');
    gleich(403, http('POST', "$b/api/admin/migrieren")['status']);
    $mig = http('POST', "$b/api/admin/migrieren", null, ['Authorization: Bearer deploy-test-token']);
    gleich(200, $mig['status']);
    gleich(['schema' => schemaVersion()], json_decode($mig['body'], true));
});
