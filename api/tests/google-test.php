<?php

declare(strict_types=1);

use Lernapp\Antwort;
use Lernapp\Api;

/** Startet den Login und liefert [Login-Cookie, state, nonce, challenge, Location]. */
function loginStarten(Api $api, string $zurueck = '/lektion/abc'): array
{
    $a = $api->bearbeite(anfrage('GET', '/auth/google/start', null, [], [], ['zurueck' => $zurueck]));
    gleich(302, $a->status, 'Start');
    $ort = $a->header['Location'];
    parse_str((string) parse_url($ort, PHP_URL_QUERY), $q);
    return [
        'cookie' => (string) $a->cookie('lernapp_login'),
        'state' => $q['state'],
        'nonce' => $q['nonce'],
        'challenge' => $q['code_challenge'],
        'ort' => $ort,
        'q' => $q,
        'antwort' => $a,
    ];
}

function googleClaims(array $start, array $abweichend = []): array
{
    return $abweichend + [
        'iss' => 'https://accounts.google.com',
        'aud' => CLIENT_ID,
        'azp' => CLIENT_ID,
        'sub' => '1234567890',
        'email' => 'Anna@Example.com',
        'email_verified' => true,
        'name' => 'Anna Muster',
        'nonce' => $start['nonce'],
        'iat' => time(),
        'exp' => time() + 3600,
    ];
}

function callback(Api $api, array $start, array $claims, ?string $challenge = null, ?string $loginCookie = null): Antwort
{
    $code = Lernapp\base64urlKodieren(json_encode(['claims' => $claims, 'challenge' => $challenge ?? $start['challenge']]));
    return $api->bearbeite(anfrage('GET', '/auth/google/callback', null,
        ['lernapp_login' => $loginCookie ?? $start['cookie']], [], ['state' => $start['state'], 'code' => $code]));
}

function googleApi(array $k = []): Api
{
    return api($k + ['google_token_url' => Testlauf::mockUrl()]);
}

/** Login-Cookie wie start() es baut, mit eigenen Werten (signiert mit dem Test-Secret). */
function loginCookie(array $daten, string $secret = CLIENT_SECRET): string
{
    $nutzlast = Lernapp\base64urlKodieren(json_encode($daten, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
    $schluessel = hash_hmac('sha256', 'lernapp-login-zustand', $secret, true);
    return $nutzlast . '.' . Lernapp\base64urlKodieren(hash_hmac('sha256', $nutzlast, $schluessel, true));
}

/** Inhalt eines Login-Cookies (ohne Prüfung der Signatur). */
function loginInhalt(string $cookie): array
{
    return json_decode((string) Lernapp\base64urlDekodieren(explode('.', $cookie)[0]), true);
}

test('google start: Weiterleitung mit PKCE S256, state, nonce, select_account', function (): void {
    $s = loginStarten(api());
    wahr(str_starts_with($s['ort'], 'https://accounts.google.com/o/oauth2/v2/auth?'), 'Google-URL');
    gleich('code', $s['q']['response_type']);
    gleich(CLIENT_ID, $s['q']['client_id']);
    gleich(BASIS . '/api/auth/google/callback', $s['q']['redirect_uri']);
    gleich('openid email profile', $s['q']['scope']);
    gleich('S256', $s['q']['code_challenge_method']);
    gleich('select_account', $s['q']['prompt']);
    wahr(strlen($s['state']) >= 43 && strlen($s['nonce']) >= 22, 'genug Zufall');
    $zeile = $s['antwort']->cookies[0];
    wahr(str_starts_with($zeile, 'lernapp_login=') && str_contains($zeile, '; Path=/;') && str_contains($zeile, 'Max-Age=600')
        && str_contains($zeile, 'HttpOnly') && str_contains($zeile, 'SameSite=Lax'), $zeile);
    wahr(strlen($zeile) < 2000, 'Cookie klein');
    $inhalt = loginInhalt($s['cookie']);
    gleich($s['state'], $inhalt['s'], 'Cookie gehört zu diesem state');
    gleich('/lektion/abc', $inhalt['z']);
});

test('google start: schreibt nichts in die Datenbank (keine Füllung ohne Anmeldung)', function (): void {
    $api = api();
    $vorher = Testlauf::pdo()->query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'phptest\\_%'")->fetchColumn();
    for ($i = 0; $i < 5; $i++) {
        loginStarten($api, '/' . str_repeat('x', 2000));
    }
    gleich($vorher, Testlauf::pdo()->query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'phptest\\_%'")->fetchColumn());
    gleich(0, (int) Testlauf::pdo()->query("SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'phptest_auth_zustand'")->fetchColumn(), 'Tabelle auth_zustand entfernt');
    // Ohne DB-Verbindung startet der Login trotzdem
    $ohneDb = new Lernapp\Api(testKonfig(), static fn () => throw new \RuntimeException('keine DB'), MIGRATIONEN);
    gleich(302, $ohneDb->bearbeite(anfrage('GET', '/auth/google/start'))->status, 'ohne DB');
});

test('google start: ohne Client-Konfiguration → Anmeldeseite mit Fehler', function (): void {
    $a = api(['google_client_id' => ''])->bearbeite(anfrage('GET', '/auth/google/start'));
    gleich(302, $a->status);
    gleich('/anmelden?fehler=fehler', $a->header['Location']);
});

test('google callback: Erfolg legt Konto und Sitzung an, springt zurück', function (): void {
    $api = googleApi();
    $s = loginStarten($api);
    $a = callback($api, $s, googleClaims($s));
    gleich(302, $a->status);
    gleich('/lektion/abc', $a->header['Location']);
    $sitzung = $a->cookie('lernapp_sitzung');
    wahr(is_string($sitzung) && strlen($sitzung) === 43, 'Sitzungs-Cookie');
    gleich('', $a->cookie('lernapp_login'), 'Login-Cookie gelöscht');
    $ich = $api->bearbeite(anfrage('GET', '/ich', null, ['lernapp_sitzung' => $sitzung]));
    gleich(['email' => 'anna@example.com', 'name' => 'Anna Muster', 'konto' => Lernapp\Sitzungen::kontoKennung('1234567890')], $ich->daten());

    // zweiter Login derselben Google-ID aktualisiert das Konto statt ein neues anzulegen
    $s2 = loginStarten($api, '/');
    callback($api, $s2, googleClaims($s2, ['name' => 'Anna M.']));
    gleich(1, (int) Testlauf::pdo()->query('SELECT COUNT(*) FROM phptest_benutzer')->fetchColumn());
    gleich('Anna M.', Testlauf::pdo()->query('SELECT name FROM phptest_benutzer')->fetchColumn());

    // Der Callback löscht das Login-Cookie (gleicher Name und Pfad), danach gilt der state nicht mehr.
    $loeschen = implode("\n", array_filter($a->cookies, static fn (string $z): bool => str_starts_with($z, 'lernapp_login=')));
    wahr(str_starts_with($loeschen, 'lernapp_login=; Path=/;') && str_contains($loeschen, 'Max-Age=0'), $loeschen);
    $nochmal = callback($api, $s, googleClaims($s), null, '');
    gleich('/anmelden?fehler=abgebrochen', $nochmal->header['Location']);

    // Rücksprungziel: fremde Ziele und zu lange → /
    foreach (['//boese.example', '/' . str_repeat('a', 600)] as $ziel) {
        $b = loginStarten($api, $ziel);
        gleich('/', callback($api, $b, googleClaims($b))->header['Location'], substr($ziel, 0, 20));
    }
});

test('google callback: nicht freigegebene Adresse → kein Konto', function (): void {
    $api = googleApi();
    $s = loginStarten($api);
    $a = callback($api, $s, googleClaims($s, ['email' => 'fremd@example.com']));
    gleich('/anmelden?fehler=nicht-freigegeben', $a->header['Location']);
    gleich(null, $a->cookie('lernapp_sitzung'));
    gleich(0, (int) Testlauf::pdo()->query('SELECT COUNT(*) FROM phptest_benutzer')->fetchColumn());
});

test('google callback: ungültige id_token-Claims → fehler', function (): void {
    $api = googleApi();
    $faelle = [
        'nonce' => ['nonce' => 'falsch'],
        'aud' => ['aud' => 'anderer-client'],
        'aud-liste-ohne' => ['aud' => ['x', 'y']],
        'iss' => ['iss' => 'https://boese.example'],
        'exp' => ['exp' => time() - 3600],
        'email_verified' => ['email_verified' => false],
        'ohne-sub' => ['sub' => ''],
    ];
    foreach ($faelle as $was => $abweichung) {
        $s = loginStarten($api);
        $a = callback($api, $s, googleClaims($s, $abweichung));
        gleich('/anmelden?fehler=fehler', $a->header['Location'], $was);
        gleich(null, $a->cookie('lernapp_sitzung'), $was);
    }
    // aud als Liste mit unserer ID und passendem azp ist gültig
    $s = loginStarten($api);
    gleich('/lektion/abc', callback($api, $s, googleClaims($s, ['aud' => [CLIENT_ID, 'x'], 'email_verified' => 'true']))->header['Location']);
});

test('google callback: Abbruch, fremder Browser, abgelaufen, Token-Fehler', function (): void {
    $api = googleApi();
    $abbruch = $api->bearbeite(anfrage('GET', '/auth/google/callback', null, [], [], ['error' => 'access_denied', 'state' => 'x']));
    gleich('/anmelden?fehler=abgebrochen', $abbruch->header['Location']);
    $sonst = $api->bearbeite(anfrage('GET', '/auth/google/callback', null, [], [], ['error' => 'server_error']));
    gleich('/anmelden?fehler=fehler', $sonst->header['Location']);
    gleich('/anmelden?fehler=abgebrochen', $api->bearbeite(anfrage('GET', '/auth/google/callback'))->header['Location'], 'ohne Parameter');

    $s = loginStarten($api);
    gleich('/anmelden?fehler=abgebrochen', callback($api, $s, googleClaims($s), null, 'anderer-browser')->header['Location'], 'Login-Cookie fremd');

    $s = loginStarten($api);
    $abgelaufen = loginCookie(['e' => time() - 1] + loginInhalt($s['cookie']));
    gleich('/anmelden?fehler=abgebrochen', callback($api, $s, googleClaims($s), null, $abgelaufen)->header['Location'], 'abgelaufen');
    gleich('/lektion/abc', callback($api, $s, googleClaims($s), null, loginCookie(loginInhalt($s['cookie'])))->header['Location'], 'nachgebautes Cookie gilt (Gegenprobe)');

    $s = loginStarten($api);
    [$nutzlast, $signatur] = explode('.', $s['cookie']);
    $andere = Lernapp\base64urlKodieren(json_encode(['z' => '//boese.example'] + loginInhalt($s['cookie'])));
    gleich('/anmelden?fehler=abgebrochen', callback($api, $s, googleClaims($s), null, $andere . '.' . $signatur)->header['Location'], 'Inhalt verändert');
    gleich('/anmelden?fehler=abgebrochen', callback($api, $s, googleClaims($s), null, $nutzlast . '.' . strrev($signatur))->header['Location'], 'falsche Signatur');
    gleich('/anmelden?fehler=abgebrochen', callback($api, $s, googleClaims($s), null, loginCookie(loginInhalt($s['cookie']), 'anderes-secret'))->header['Location'], 'mit anderem Schlüssel signiert');
    gleich('/anmelden?fehler=abgebrochen', callback($api, $s, googleClaims($s), null, $nutzlast)->header['Location'], 'ohne Signatur');
    $fremd = loginStarten($api);
    gleich('/anmelden?fehler=abgebrochen', callback($api, $s, googleClaims($s), null, $fremd['cookie'])->header['Location'], 'Cookie eines anderen Logins');

    $s = loginStarten($api);
    gleich('/anmelden?fehler=fehler', callback($api, $s, googleClaims($s), 'falsche-challenge')->header['Location'], 'PKCE passt nicht');

    $s = loginStarten($api);
    $falscheUrl = api(['google_token_url' => 'http://127.0.0.1:1/token']);
    gleich('/anmelden?fehler=fehler', callback($falscheUrl, $s, googleClaims($s))->header['Location'], 'Token-Endpunkt nicht erreichbar');
});

test('google: ohne Testmodus bzw. über https Login-Cookie __Host-lernapp_login, Path=/, Secure', function (): void {
    // Dass die Token-URL ohne Testmodus fest auf Google steht, prüft der Konfigurationstest
    // (kein echter Netzaufruf in den Tests).
    $s = loginStarten(api(['testmodus' => false]));
    $zeile = $s['antwort']->cookies[0];
    wahr(str_starts_with($zeile, '__Host-lernapp_login=') && str_contains($zeile, '; Path=/;')
        && str_contains($zeile, '; Secure') && !str_contains($zeile, 'Domain='), $zeile);
    $https = api()->bearbeite(anfrage('GET', '/auth/google/start', null, [], [], [], 'cli-server', true));
    wahr(str_starts_with($https->cookies[0], '__Host-lernapp_login='), 'https im Testmodus');

    // Callback über https liest und löscht das Cookie mit Präfix
    $api = googleApi();
    $start = $api->bearbeite(anfrage('GET', '/auth/google/start', null, [], [], ['zurueck' => '/x'], 'cli-server', true));
    parse_str((string) parse_url($start->header['Location'], PHP_URL_QUERY), $q);
    $code = Lernapp\base64urlKodieren(json_encode(['claims' => googleClaims(['nonce' => $q['nonce']]), 'challenge' => $q['code_challenge']]));
    $cb = $api->bearbeite(anfrage('GET', '/auth/google/callback', null,
        ['__Host-lernapp_login' => (string) $start->cookie('__Host-lernapp_login')], [], ['state' => $q['state'], 'code' => $code], 'cli-server', true));
    gleich('/x', $cb->header['Location']);
    wahr(is_string($cb->cookie('__Host-lernapp_sitzung')), 'Sitzung mit Präfix');
    gleich('', $cb->cookie('__Host-lernapp_login'), 'Login-Cookie mit Präfix gelöscht');
});
