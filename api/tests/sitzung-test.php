<?php

declare(strict_types=1);

test('test/anmelden: nur im Testmodus unter php -S, sonst 404', function (): void {
    $body = ['email' => 'anna@example.com', 'name' => 'Anna'];
    gleich(404, api()->bearbeite(anfrage('POST', '/test/anmelden', $body, [], [], [], 'cli'))->status, 'SAPI cli');
    gleich(404, api()->bearbeite(anfrage('POST', '/test/anmelden', $body, [], [], [], 'fpm-fcgi'))->status, 'SAPI fpm');
    gleich(404, api(['testmodus' => false])->bearbeite(anfrage('POST', '/test/anmelden', $body))->status, 'ohne Testmodus');
    gleich(404, api(['testmodus' => false])->bearbeite(anfrage('GET', '/test/anmelden'))->status, 'GET ohne Testmodus');
    gleich(200, api()->bearbeite(anfrage('POST', '/test/anmelden', $body))->status, 'Testmodus + cli-server');
});

test('test/anmelden: Allowlist, Cookie-Attribute, kein Konto für Fremde', function (): void {
    $api = api();
    $nein = $api->bearbeite(anfrage('POST', '/test/anmelden', ['email' => 'fremd@example.com']));
    gleich(403, $nein->status);
    gleich('nicht-freigegeben', $nein->daten()['fehler']);
    gleich(0, (int) Testlauf::pdo()->query('SELECT COUNT(*) FROM phptest_benutzer')->fetchColumn(), 'kein Konto angelegt');

    $ja = $api->bearbeite(anfrage('POST', '/test/anmelden', ['email' => ' ANNA@example.com', 'name' => 'Anna']));
    gleich(200, $ja->status);
    gleich(['email' => 'anna@example.com', 'name' => 'Anna', 'konto' => Lernapp\Sitzungen::kontoKennung('test:anna@example.com')], $ja->daten());
    $zeile = $ja->cookies[0];
    wahr(preg_match('/^lernapp_sitzung=[A-Za-z0-9_-]{43}; /', $zeile) === 1, 'Token 32 Byte base64url: ' . $zeile);
    foreach (['Path=/', 'Max-Age=7776000', 'HttpOnly', 'SameSite=Lax'] as $teil) {
        wahr(str_contains($zeile, $teil), $teil);
    }
    wahr(!str_contains($zeile, 'Secure'), 'kein Secure über http im Testmodus');
    $https = $api->bearbeite(anfrage('POST', '/test/anmelden', ['email' => 'anna@example.com'], [], [], [], 'cli-server', true));
    wahr(str_contains($https->cookies[0], '; Secure'), 'Secure über https');

    // DB speichert nur den Hash
    $token = (string) $ja->cookie('lernapp_sitzung');
    $treffer = Testlauf::pdo()->prepare('SELECT COUNT(*) FROM phptest_sitzungen WHERE token_hash = ?');
    $treffer->execute([hash('sha256', $token)]);
    gleich(1, (int) $treffer->fetchColumn());
    $klartext = Testlauf::pdo()->prepare('SELECT COUNT(*) FROM phptest_sitzungen WHERE token_hash = ?');
    $klartext->execute([$token]);
    gleich(0, (int) $klartext->fetchColumn(), 'kein Klartext-Token');
});

test('cookie: ausserhalb des Testmodus immer Secure', function (): void {
    $s = new Lernapp\Sitzungen(Testlauf::pdo(), testKonfig(['testmodus' => false]));
    wahr($s->cookieSicher(anfrage('GET', '/ich')), 'http ohne Testmodus');
});

test('ich: 401 ohne/mit falscher Sitzung, 200 mit Sitzung', function (): void {
    $api = api();
    $ohne = $api->bearbeite(anfrage('GET', '/ich'));
    gleich(401, $ohne->status);
    gleich('nicht-angemeldet', $ohne->daten()['fehler']);
    gleich([], $ohne->cookies, 'kein Cookie zu löschen');

    $falsch = $api->bearbeite(anfrage('GET', '/ich', null, ['lernapp_sitzung' => str_repeat('A', 43)]));
    gleich(401, $falsch->status);
    gleich('', $falsch->cookie('lernapp_sitzung'), 'Cookie wird gelöscht');
    wahr(str_contains($falsch->cookies[0], 'Max-Age=0'), 'Max-Age=0');

    $cookies = anmelden($api);
    $ich = $api->bearbeite(anfrage('GET', '/ich', null, $cookies));
    gleich(200, $ich->status);
    gleich(['email' => 'anna@example.com', 'name' => 'Test', 'konto' => Lernapp\Sitzungen::kontoKennung('test:anna@example.com')], $ich->daten());
    gleich([], $ich->cookies, 'frisch: keine Erneuerung');
});

test('sitzung: abgelaufen → 401, gleitend erneuert nach einer Stunde', function (): void {
    $api = api();
    $cookies = anmelden($api);
    $hash = hash('sha256', $cookies['lernapp_sitzung']);
    $pdo = Testlauf::pdo();

    $pdo->prepare('UPDATE phptest_sitzungen SET zuletzt_genutzt = ?, ablauf = ? WHERE token_hash = ?')
        ->execute([gmdate('Y-m-d H:i:s', time() - 7200), gmdate('Y-m-d H:i:s', time() + 86400), $hash]);
    $a = $api->bearbeite(anfrage('GET', '/ich', null, $cookies));
    gleich(200, $a->status);
    gleich($cookies['lernapp_sitzung'], $a->cookie('lernapp_sitzung'), 'Cookie neu gesetzt');
    $ablauf = $pdo->prepare('SELECT ablauf FROM phptest_sitzungen WHERE token_hash = ?');
    $ablauf->execute([$hash]);
    wahr(strtotime($ablauf->fetchColumn() . ' UTC') > time() + 89 * 86400, 'Ablauf um 90 Tage verlängert');

    $pdo->prepare('UPDATE phptest_sitzungen SET ablauf = ? WHERE token_hash = ?')->execute([gmdate('Y-m-d H:i:s', time() - 1), $hash]);
    gleich(401, $api->bearbeite(anfrage('GET', '/ich', null, $cookies))->status, 'abgelaufen');

    // Aufräumen beim nächsten Login
    anmelden($api, 'ben@example.com');
    $rest = $pdo->prepare('SELECT COUNT(*) FROM phptest_sitzungen WHERE token_hash = ?');
    $rest->execute([$hash]);
    gleich(0, (int) $rest->fetchColumn(), 'abgelaufene Sitzung gelöscht');
});

test('allowlist: wer entfernt wird, verliert sofort den Zugang', function (): void {
    $cookies = anmelden(api());
    $ohneAnna = api(['erlaubte_emails' => ['ben@example.com']]);
    $a = $ohneAnna->bearbeite(anfrage('GET', '/ich', null, $cookies));
    gleich(401, $a->status);
    gleich('nicht-freigegeben', $a->daten()['fehler']);
    gleich(401, $ohneAnna->bearbeite(anfrage('GET', '/sync', null, $cookies))->status, 'Sync');
    gleich(0, (int) Testlauf::pdo()->query('SELECT COUNT(*) FROM phptest_sitzungen')->fetchColumn(), 'Sitzungen geschlossen');
    gleich(401, api()->bearbeite(anfrage('GET', '/ich', null, $cookies))->status, 'auch nach Wiederaufnahme neu anmelden');
});

test('csrf: ändernde Anfragen brauchen X-Lernapp und JSON', function (): void {
    $api = api();
    $cookies = anmelden($api);
    $body = ['datensaetze' => []];
    gleich(403, $api->bearbeite(anfrage('POST', '/sync', $body, $cookies, ['x-lernapp' => null]))->status, 'ohne Header');
    gleich(403, $api->bearbeite(anfrage('POST', '/sync', $body, $cookies, ['x-lernapp' => '0']))->status, 'falscher Wert');
    gleich(403, $api->bearbeite(anfrage('POST', '/sync', json_encode($body), $cookies, ['content-type' => 'text/plain']))->status, 'text/plain');
    gleich(403, $api->bearbeite(anfrage('POST', '/sync', 'datensaetze=1', $cookies, ['content-type' => 'application/x-www-form-urlencoded']))->status, 'Formular');
    gleich(200, $api->bearbeite(anfrage('POST', '/sync', json_encode($body), $cookies, ['content-type' => 'application/json; charset=utf-8']))->status, 'JSON mit charset');
    gleich(403, $api->bearbeite(anfrage('DELETE', '/daten', null, $cookies, ['x-lernapp' => null]))->status, 'DELETE ohne Header');
    gleich(403, $api->bearbeite(anfrage('POST', '/auth/abmelden', null, $cookies, ['x-lernapp' => null]))->status, 'Abmelden ohne Header');
    gleich(403, $api->bearbeite(anfrage('POST', '/test/anmelden', ['email' => 'anna@example.com'], [], ['x-lernapp' => null]))->status, 'Test-Login ohne Header');
    gleich(200, $api->bearbeite(anfrage('GET', '/ich', null, $cookies))->status, 'Sitzung noch gültig');
});

test('abmelden: Sitzung und Cookie weg, 204', function (): void {
    $api = api();
    $cookies = anmelden($api);
    $andere = anmelden($api); // zweites Gerät derselben Person
    $a = $api->bearbeite(anfrage('POST', '/auth/abmelden', null, $cookies));
    gleich(204, $a->status);
    gleich('', $a->body);
    gleich('', $a->cookie('lernapp_sitzung'));
    gleich(401, $api->bearbeite(anfrage('GET', '/ich', null, $cookies))->status, 'abgemeldet');
    gleich(200, $api->bearbeite(anfrage('GET', '/ich', null, $andere))->status, 'anderes Gerät bleibt angemeldet');
    gleich(204, $api->bearbeite(anfrage('POST', '/auth/abmelden'))->status, 'ohne Sitzung ebenfalls 204');
});

test('cookie: über https mit __Host-Präfix, Path=/, Secure, ohne Domain', function (): void {
    $api = api();
    $https = $api->bearbeite(anfrage('POST', '/test/anmelden', ['email' => 'anna@example.com'], [], [], [], 'cli-server', true));
    $zeile = $https->cookies[0];
    wahr(str_starts_with($zeile, '__Host-lernapp_sitzung='), $zeile);
    wahr(str_contains($zeile, '; Path=/;') && str_contains($zeile, '; Secure') && !str_contains($zeile, 'Domain='), $zeile);
    $token = (string) $https->cookie('__Host-lernapp_sitzung');
    gleich(200, $api->bearbeite(anfrage('GET', '/ich', null, ['__Host-lernapp_sitzung' => $token], [], [], 'cli-server', true))->status, 'mit Präfix');
    // Ein Cookie ohne Präfix (z. B. von einer anderen Subdomain untergeschoben) gilt über https nicht.
    gleich(401, $api->bearbeite(anfrage('GET', '/ich', null, ['lernapp_sitzung' => $token], [], [], 'cli-server', true))->status, 'ohne Präfix');

    // Ohne Testmodus immer mit Präfix, auch das Löschen
    $s = new Lernapp\Sitzungen(Testlauf::pdo(), testKonfig(['testmodus' => false]));
    gleich('__Host-lernapp_sitzung', $s->cookieName(anfrage('GET', '/ich')));
    wahr(str_starts_with($s->loeschCookie(anfrage('GET', '/ich')), '__Host-lernapp_sitzung=; Path=/;'), 'Löschen mit Präfix');
});

test('sitzung: absolute Höchstdauer 365 Tage, auch bei gleitender Verlängerung', function (): void {
    $api = api();
    $pdo = Testlauf::pdo();
    $setze = static function (string $token, int $erstelltVor, int $zuletztVor) use ($pdo): void {
        $pdo->prepare('UPDATE phptest_sitzungen SET erstellt_am = ?, zuletzt_genutzt = ?, ablauf = ? WHERE token_hash = ?')->execute([
            gmdate('Y-m-d H:i:s', time() - $erstelltVor), gmdate('Y-m-d H:i:s', time() - $zuletztVor),
            gmdate('Y-m-d H:i:s', time() + 30 * 86400), hash('sha256', $token),
        ]);
    };
    $alt = anmelden($api);
    $setze($alt['lernapp_sitzung'], 366 * 86400, 60);
    gleich(401, $api->bearbeite(anfrage('GET', '/ich', null, $alt))->status, 'älter als 365 Tage');

    $fast = anmelden($api, 'ben@example.com');
    $setze($fast['lernapp_sitzung'], 364 * 86400, 7200);
    $a = $api->bearbeite(anfrage('GET', '/ich', null, $fast));
    gleich(200, $a->status);
    $ablauf = $pdo->prepare('SELECT ablauf, erstellt_am FROM phptest_sitzungen WHERE token_hash = ?');
    $ablauf->execute([hash('sha256', $fast['lernapp_sitzung'])]);
    $z = $ablauf->fetch();
    wahr(strtotime($z['ablauf'] . ' UTC') <= strtotime($z['erstellt_am'] . ' UTC') + 365 * 86400, 'Ablauf gedeckelt: ' . $z['ablauf']);
    preg_match('/Max-Age=(\d+)/', $a->cookies[0], $m);
    wahr((int) $m[1] <= 86400 + 5, 'Cookie Max-Age gedeckelt: ' . $m[1]);

    // Aufräumen entfernt Sitzungen über der Höchstdauer
    anmelden($api);
    $rest = $pdo->prepare('SELECT COUNT(*) FROM phptest_sitzungen WHERE token_hash = ?');
    $rest->execute([hash('sha256', $alt['lernapp_sitzung'])]);
    gleich(0, (int) $rest->fetchColumn(), 'zu alte Sitzung gelöscht');
});

test('abmelden-ueberall: alle Sitzungen der Person weg, fremde bleiben, CSRF-geschützt', function (): void {
    $api = api();
    $a1 = anmelden($api);
    $a2 = anmelden($api);
    $ben = anmelden($api, 'ben@example.com');
    gleich(403, $api->bearbeite(anfrage('POST', '/auth/abmelden-ueberall', null, $a1, ['x-lernapp' => null]))->status, 'ohne X-Lernapp');
    gleich(200, $api->bearbeite(anfrage('GET', '/ich', null, $a1))->status, 'nach 403 noch angemeldet');
    $r = $api->bearbeite(anfrage('POST', '/auth/abmelden-ueberall', null, $a1));
    gleich(204, $r->status);
    gleich('', $r->cookie('lernapp_sitzung'), 'Cookie gelöscht');
    gleich(401, $api->bearbeite(anfrage('GET', '/ich', null, $a1))->status, 'dieses Gerät');
    gleich(401, $api->bearbeite(anfrage('GET', '/ich', null, $a2))->status, 'anderes Gerät');
    gleich(200, $api->bearbeite(anfrage('GET', '/ich', null, $ben))->status, 'andere Person bleibt');
    gleich(401, $api->bearbeite(anfrage('POST', '/auth/abmelden-ueberall', null, $a1))->status, 'ohne Sitzung');
    gleich(405, $api->bearbeite(anfrage('GET', '/auth/abmelden-ueberall', null, $ben))->status, 'nur POST');
});

test('daten löschen: beendet die übrigen Sitzungen der Person, die eigene bleibt', function (): void {
    $api = api();
    $eigen = anmelden($api);
    $handy = anmelden($api);
    $ben = anmelden($api, 'ben@example.com');
    gleich(204, $api->bearbeite(anfrage('DELETE', '/daten', null, $eigen))->status);
    gleich(200, $api->bearbeite(anfrage('GET', '/ich', null, $eigen))->status, 'eigene Sitzung');
    gleich(401, $api->bearbeite(anfrage('GET', '/ich', null, $handy))->status, 'anderes Gerät abgemeldet');
    gleich(200, $api->bearbeite(anfrage('GET', '/ich', null, $ben))->status, 'andere Person bleibt');
});

test('konto: X-Lernapp-Konto muss zur Sitzung passen (409 anderes-konto)', function (): void {
    $api = api();
    $anna = anmelden($api);
    $kontoAnna = Lernapp\Sitzungen::kontoKennung('test:anna@example.com');
    $kontoBen = Lernapp\Sitzungen::kontoKennung('test:ben@example.com');
    gleich(32, strlen($kontoAnna));
    wahr($kontoAnna !== $kontoBen, 'Kennungen verschieden');
    $falsch = $api->bearbeite(anfrage('POST', '/sync', ['datensaetze' => [ds('lektion', 'l', ['id' => 'l'])]], $anna, ['x-lernapp-konto' => $kontoBen]));
    gleich(409, $falsch->status);
    gleich('anderes-konto', $falsch->daten()['fehler']);
    gleich(409, $api->bearbeite(anfrage('GET', '/sync', null, $anna, ['x-lernapp-konto' => $kontoBen]))->status, 'GET');
    gleich(409, $api->bearbeite(anfrage('DELETE', '/daten', null, $anna, ['x-lernapp-konto' => $kontoBen]))->status, 'DELETE');
    gleich([], holen($api, $anna)['datensaetze'], 'nichts angenommen');
    gleich(200, $api->bearbeite(anfrage('POST', '/sync', ['datensaetze' => []], $anna, ['x-lernapp-konto' => $kontoAnna]))->status, 'richtiges Konto');
    gleich(200, $api->bearbeite(anfrage('GET', '/sync', null, $anna))->status, 'ohne Header wie bisher');
});
