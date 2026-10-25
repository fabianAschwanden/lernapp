<?php

declare(strict_types=1);

use Lernapp\Anfrage;
use Lernapp\GoogleLogin;
use Lernapp\Konfiguration;
use Lernapp\Migrationen;

test('konfiguration: Allowlist getrimmt und ohne Gross-/Kleinschreibung', function (): void {
    $k = testKonfig();
    gleich(['anna@example.com', 'ben@example.com'], $k->erlaubteEmails);
    wahr($k->istErlaubt('ANNA@example.com '), 'Grossschreibung/Leerraum');
    wahr(!$k->istErlaubt('anna@example.org'), 'andere Domain');
    wahr(!$k->istErlaubt(''), 'leer');
    gleich(['a@x.ch', 'b@y.ch'], Konfiguration::normalisiereListe("a@x.ch, B@y.ch\n;a@x.ch"), 'Text-Liste');
    gleich([], testKonfig(['erlaubte_emails' => []])->erlaubteEmails, 'leere Liste');
});

test('konfiguration: Testmodus nur bei echtem true, Token-URL nur im Testmodus', function (): void {
    gleich(false, testKonfig(['testmodus' => 'true'])->testmodus, 'Text');
    gleich(false, testKonfig(['testmodus' => 1])->testmodus, 'Zahl');
    gleich(true, testKonfig(['testmodus' => true])->testmodus);
    $prod = testKonfig(['testmodus' => false, 'google_token_url' => 'http://127.0.0.1:1/token']);
    gleich('https://oauth2.googleapis.com/token', $prod->googleTokenUrl(), 'ohne Testmodus');
    $test = testKonfig(['google_token_url' => 'http://127.0.0.1:1/token']);
    gleich('http://127.0.0.1:1/token', $test->googleTokenUrl(), 'im Testmodus');
});

test('konfiguration: ungültiges Präfix wird abgelehnt, Pfad aus LERNAPP_CONFIG', function (): void {
    $geworfen = false;
    try {
        testKonfig(['tabellen_praefix' => 'x`; DROP']);
    } catch (\InvalidArgumentException) {
        $geworfen = true;
    }
    wahr($geworfen, 'Präfix mit Sonderzeichen');
    $alt = getenv('LERNAPP_CONFIG');
    putenv('LERNAPP_CONFIG=/irgendwo/config.php');
    gleich('/irgendwo/config.php', Konfiguration::suchePfad(dirname(__DIR__)));
    putenv($alt === false ? 'LERNAPP_CONFIG' : 'LERNAPP_CONFIG=' . $alt);
    $datei = tempnam(sys_get_temp_dir(), 'cfg') . '.php';
    file_put_contents($datei, '<?php return ' . var_export(['tabellen_praefix' => 'abc_', 'erlaubte_emails' => 'x@y.ch'], true) . ';');
    $k = Konfiguration::ausDatei($datei);
    unlink($datei);
    gleich('abc_', $k->praefix);
    gleich(['x@y.ch'], $k->erlaubteEmails);
    gleich(false, $k->testmodus, 'Standard testmodus');
});

test('migrationen: idempotent, Schema-Version und Tabellen mit Präfix', function (): void {
    $pdo = Testlauf::pdo();
    $m = new Migrationen($pdo, testKonfig(), MIGRATIONEN);
    $v1 = $m->ausfuehren();
    $v2 = $m->ausfuehren();
    gleich($v1, $v2, 'zweiter Lauf');
    gleich($m->erwarteteVersion(), $v1);
    wahr($v1 >= 1, 'mindestens Migration 001');
    gleich(1, (int) $pdo->query('SELECT COUNT(*) FROM phptest_schema WHERE version = 1')->fetchColumn(), 'einmal eingetragen');
    $tabellen = $pdo->query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'phptest\\_%' ORDER BY 1")->fetchAll(\PDO::FETCH_COLUMN);
    gleich(['phptest_benutzer', 'phptest_datensaetze', 'phptest_schema', 'phptest_sitzungen'], $tabellen);
    $engine = $pdo->query("SELECT DISTINCT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'phptest\\_%'")->fetchAll(\PDO::FETCH_COLUMN);
    gleich(['InnoDB'], $engine);
});

test('migrationen: Anweisungen zerlegen ohne Kommentare, Präfix ersetzt', function (): void {
    $teile = Migrationen::anweisungen("-- Kommentar; mit Semikolon\nCREATE TABLE {{praefix}}a (x INT);\n\nCREATE TABLE {{praefix}}b (y INT);", 'p_');
    gleich(['CREATE TABLE p_a (x INT)', 'CREATE TABLE p_b (y INT)'], $teile);
});

test('status: ok mit Schema, 503 vor der Migration, keine Geheimnisse', function (): void {
    $a = api()->bearbeite(anfrage('GET', '/status'));
    gleich(200, $a->status);
    gleich(['ok' => true, 'schema' => schemaVersion()], $a->daten());
    gleich('application/json; charset=utf-8', $a->header['Content-Type']);
    $leer = api(['tabellen_praefix' => 'phpleer_'])->bearbeite(anfrage('GET', '/status'));
    gleich(503, $leer->status, 'nicht migriert');
    gleich(false, $leer->daten()['ok']);
    $ohneDb = new Lernapp\Api(testKonfig(['db_password' => 'falsch']), static fn ($k) => Lernapp\verbinde($k), MIGRATIONEN);
    $r = $ohneDb->bearbeite(anfrage('GET', '/status'));
    gleich(503, $r->status, 'DB nicht erreichbar');
    wahr(!str_contains($r->body, 'falsch') && !str_contains($r->body, 'lernapp_test'), 'keine Details nach aussen');
});

test('admin/migrieren: nur mit Deploy-Token, leeres Token gesperrt', function (): void {
    $api = api();
    gleich(403, $api->bearbeite(anfrage('POST', '/admin/migrieren'))->status, 'ohne Token');
    gleich(403, $api->bearbeite(anfrage('POST', '/admin/migrieren', null, [], ['authorization' => 'Bearer falsch']))->status, 'falsches Token');
    $ok = $api->bearbeite(anfrage('POST', '/admin/migrieren', null, [], ['authorization' => 'Bearer deploy-test-token', 'x-lernapp' => null]));
    gleich(200, $ok->status, 'richtiges Token (ohne X-Lernapp)');
    gleich(['schema' => schemaVersion()], $ok->daten());
    gleich(['schema' => schemaVersion()], $api->bearbeite(anfrage('POST', '/admin/migrieren', null, [], ['authorization' => 'Bearer deploy-test-token']))->daten(), 'zweiter Lauf');
    $gesperrt = api(['deploy_token' => '']);
    gleich(403, $gesperrt->bearbeite(anfrage('POST', '/admin/migrieren', null, [], ['authorization' => 'Bearer ']))->status, 'leeres Token');
    gleich(403, $gesperrt->bearbeite(anfrage('POST', '/admin/migrieren', null, [], ['authorization' => 'Bearer x']))->status, 'leeres Token, beliebiger Wert');
    gleich(405, $api->bearbeite(anfrage('GET', '/admin/migrieren'))->status, 'GET');
});

test('router: unbekannte Pfade 404, falsche Methode 405, Fehlerformat', function (): void {
    $api = api();
    $a = $api->bearbeite(anfrage('GET', '/gibtsnicht'));
    gleich(404, $a->status);
    gleich('nicht-gefunden', $a->daten()['fehler']);
    wahr(is_string($a->daten()['meldung']), 'meldung');
    gleich(405, $api->bearbeite(anfrage('POST', '/status'))->status);
    gleich(405, $api->bearbeite(anfrage('PUT', '/sync', ['x' => 1]))->status);
    gleich(200, $api->bearbeite(anfrage('GET', '/status/'))->status, 'Schrägstrich am Ende');
});

test('rücksprung: nur relative Pfade', function (): void {
    $faelle = [
        '/lektion/abc?x=1#y' => '/lektion/abc?x=1#y',
        '/' => '/',
        '' => '/',
        '//boese.example' => '/',
        '/\\boese.example' => '/',
        'https://boese.example' => '/',
        'lektion' => '/',
        "/a\r\nLocation: x" => '/',
        '/a b' => '/',
        '/a\\b' => '/',
        '/' . str_repeat('a', 2100) => '/',
        '/' . str_repeat('a', 511) => '/' . str_repeat('a', 511),
        '/' . str_repeat('a', 512) => '/',
    ];
    foreach ($faelle as $eingabe => $erwartet) {
        gleich($erwartet, GoogleLogin::pruefeZurueck((string) $eingabe), 'zurueck=' . substr((string) $eingabe, 0, 30));
    }
    gleich('/', GoogleLogin::pruefeZurueck(null));
    gleich('/', GoogleLogin::pruefeZurueck(['/x']));
});

test('anfrage: Pfad aus REQUEST_URI ohne /api, Header klein', function (): void {
    $_SERVER = ['REQUEST_METHOD' => 'post', 'REQUEST_URI' => '/api/sync?seit=3', 'HTTP_X_LERNAPP' => '1', 'CONTENT_TYPE' => 'application/json', 'HTTPS' => 'on'];
    $_GET = ['seit' => '3'];
    $_COOKIE = ['lernapp_sitzung' => 'abc'];
    $a = Anfrage::ausGlobals();
    gleich('POST', $a->methode);
    gleich('/sync', $a->pfad);
    gleich('1', $a->header('X-Lernapp'));
    gleich('application/json', $a->header('content-type'));
    gleich(['seit' => '3'], $a->query);
    gleich(true, $a->https);
    $_SERVER = ['REQUEST_URI' => '/api'];
    gleich('/', Anfrage::ausGlobals()->pfad);
    $_SERVER = [];
    $_GET = [];
    $_COOKIE = [];
});

test('db: Transaktion wird bei Deadlock wiederholt, andere Fehler nicht', function (): void {
    $pdo = Testlauf::pdo();
    $deadlock = static function (): \PDOException {
        $e = new \PDOException('SQLSTATE[40001]: Serialization failure: 1213 Deadlock found');
        $e->errorInfo = ['40001', 1213, 'Deadlock found when trying to get lock'];
        return $e;
    };
    $aufrufe = 0;
    $ergebnis = Lernapp\inTransaktion($pdo, function () use (&$aufrufe, $deadlock, $pdo): string {
        $aufrufe++;
        wahr($pdo->inTransaction(), 'läuft in einer Transaktion');
        if ($aufrufe < 3) {
            throw $deadlock();
        }
        return 'ok';
    });
    gleich('ok', $ergebnis);
    gleich(3, $aufrufe, 'zwei Wiederholungen');
    wahr(!$pdo->inTransaction(), 'Transaktion abgeschlossen');

    $aufrufe = 0;
    try {
        Lernapp\inTransaktion($pdo, function () use (&$aufrufe, $deadlock): void {
            $aufrufe++;
            throw $deadlock();
        });
    } catch (\PDOException) {
    }
    gleich(4, $aufrufe, 'gibt nach vier Versuchen auf');

    $aufrufe = 0;
    try {
        Lernapp\inTransaktion($pdo, function () use (&$aufrufe): void {
            $aufrufe++;
            throw new \RuntimeException('anderer Fehler');
        });
    } catch (\RuntimeException) {
    }
    gleich(1, $aufrufe, 'kein Wiederholen bei anderen Fehlern');
    wahr(!$pdo->inTransaction(), 'Rollback');
});
