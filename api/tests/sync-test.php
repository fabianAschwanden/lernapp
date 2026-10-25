<?php

declare(strict_types=1);

use Lernapp\Sync;

test('sync: ohne Sitzung 401', function (): void {
    $api = api();
    gleich(401, $api->bearbeite(anfrage('GET', '/sync'))->status);
    gleich(401, $api->bearbeite(anfrage('POST', '/sync', ['datensaetze' => []]))->status);
    gleich(401, $api->bearbeite(anfrage('DELETE', '/daten'))->status);
});

test('sync: hochladen und holen, Daten unverändert (inkl. leerer Objekte, Unicode, 1.0)', function (): void {
    $api = api();
    $c = anmelden($api);
    $lektion = ['id' => 'l1', 'titel' => 'Zellatmung – «Grundlagen»', 'leer' => new stdClass(), 'liste' => [], 'zahl' => 1.0, 'tief' => ['a' => ['b' => [1, 2, null, true]]], 'pfad' => 'bilder/a.svg'];
    $r = hochladen($api, $c, [
        ds('lektion', 'l1', $lektion, '2026-10-01T10:00:00.123Z'),
        ds('fortschritt', 'l1::f1', ['fach' => 2], '2026-10-01T12:00:00.5+02:00'),
        ds('einstellung', 'einstellungen', ['rundenGroesse' => 7]),
    ]);
    gleich(200, $r->status);
    gleich(['version' => 3, 'angenommen' => 3, 'abgelehnt' => []], $r->daten());

    $roh = $api->bearbeite(anfrage('GET', '/sync', null, $c, [], ['seit' => '0']));
    wahr(str_contains($roh->body, '"leer":{}') && str_contains($roh->body, '"zahl":1,') && str_contains($roh->body, '«Grundlagen»'), 'JSON-Treue: ' . substr($roh->body, 0, 300));
    $g = $roh->daten();
    gleich(3, $g['version']);
    gleich(false, $g['mehr']);
    gleich(3, count($g['datensaetze']));
    gleich(['art' => 'lektion', 'schluessel' => 'l1', 'daten' => json_decode(json_encode($lektion), true), 'geaendertAm' => '2026-10-01T10:00:00.123Z', 'geloescht' => false, 'version' => 1], $g['datensaetze'][0]);
    gleich('2026-10-01T10:00:00.500Z', $g['datensaetze'][1]['geaendertAm'], 'Zeitzone nach UTC');
    gleich(['rundenGroesse' => 7], $g['datensaetze'][2]['daten'], 'Einstellungen');
    gleich(['version' => 3, 'datensaetze' => [], 'mehr' => false], holen($api, $c, 3), 'nichts Neues');
});

test('sync: last write wins, Gleichstand behält Serverstand', function (): void {
    $api = api();
    $c = anmelden($api);
    hochladen($api, $c, [ds('fortschritt', 'k', ['fach' => 1], '2026-10-01T10:00:00.000Z')]);

    $alt = hochladen($api, $c, [ds('fortschritt', 'k', ['fach' => 9], '2026-10-01T09:59:59.999Z')])->daten();
    gleich(['version' => 1, 'angenommen' => 0, 'abgelehnt' => [['art' => 'fortschritt', 'schluessel' => 'k', 'grund' => 'veraltet',
        'datensatz' => ['art' => 'fortschritt', 'schluessel' => 'k', 'daten' => ['fach' => 1], 'geaendertAm' => '2026-10-01T10:00:00.000Z', 'geloescht' => false, 'version' => 1]]]], $alt, 'älter');
    $gleich = hochladen($api, $c, [ds('fortschritt', 'k', ['fach' => 8], '2026-10-01T12:00:00.000+02:00')])->daten();
    gleich(0, $gleich['angenommen'], 'gleicher Zeitpunkt (andere Zone)');
    gleich('veraltet', $gleich['abgelehnt'][0]['grund']);
    $neu = hochladen($api, $c, [ds('fortschritt', 'k', ['fach' => 3], '2026-10-01T10:00:00.001Z')])->daten();
    gleich(['version' => 2, 'angenommen' => 1, 'abgelehnt' => []], $neu, 'neuer');

    $g = holen($api, $c);
    gleich(1, count($g['datensaetze']));
    gleich(['fach' => 3], $g['datensaetze'][0]['daten']);
    gleich(2, $g['version']);

    // Im selben Paket zweimal derselbe Schlüssel: der neuere gewinnt
    $paket = hochladen($api, $c, [
        ds('fortschritt', 'k', ['fach' => 5], '2026-10-02T10:00:00.000Z'),
        ds('fortschritt', 'k', ['fach' => 4], '2026-10-02T09:00:00.000Z'),
    ])->daten();
    gleich(1, $paket['angenommen']);
    gleich(['fach' => 5], holen($api, $c)['datensaetze'][0]['daten']);
});

test('sync: Grabsteine bleiben erhalten und werden ausgeliefert', function (): void {
    $api = api();
    $c = anmelden($api);
    hochladen($api, $c, [ds('lektion', 'eigene', ['id' => 'eigene'])]);
    $r = hochladen($api, $c, [
        ds('lektion', 'eigene', ['wird' => 'ignoriert'], '2026-10-03T10:00:00.000Z', true),
        ['art' => 'pruefung', 'schluessel' => 'nie-gesehen', 'geaendertAm' => '2026-10-03T10:00:00.000Z', 'geloescht' => true],
    ])->daten();
    gleich(['version' => 3, 'angenommen' => 2, 'abgelehnt' => []], $r);
    $g = holen($api, $c, 1);
    gleich([
        ['art' => 'lektion', 'schluessel' => 'eigene', 'daten' => null, 'geaendertAm' => '2026-10-03T10:00:00.000Z', 'geloescht' => true, 'version' => 2],
        ['art' => 'pruefung', 'schluessel' => 'nie-gesehen', 'daten' => null, 'geaendertAm' => '2026-10-03T10:00:00.000Z', 'geloescht' => true, 'version' => 3],
    ], $g['datensaetze']);
    $db = Testlauf::pdo()->query("SELECT daten FROM phptest_datensaetze WHERE schluessel = 'eigene'")->fetchColumn();
    gleich(null, $db, 'daten in DB null');

    // Wiederbelebung durch neuere Änderung
    hochladen($api, $c, [ds('lektion', 'eigene', ['id' => 'neu'], '2026-10-04T10:00:00.000Z')]);
    $zurueck = holen($api, $c, 3)['datensaetze'];
    gleich(false, $zurueck[0]['geloescht']);
    gleich(['id' => 'neu'], $zurueck[0]['daten']);
});

test('sync: Versionen monoton, seit filtert, Paging mit limit', function (): void {
    $api = api();
    $c = anmelden($api);
    $alle = [];
    for ($i = 1; $i <= 7; $i++) {
        $alle[] = ds('fortschritt', "k$i", ['i' => $i]);
    }
    gleich(7, hochladen($api, $c, $alle)->daten()['version']);
    // k2 ändern → bekommt Version 8, rückt ans Ende
    hochladen($api, $c, [ds('fortschritt', 'k2', ['i' => 22], '2026-10-05T10:00:00.000Z')]);

    $seiten = [];
    $seit = 0;
    $gesehen = [];
    do {
        $g = holen($api, $c, $seit, 3);
        $seiten[] = count($g['datensaetze']);
        foreach ($g['datensaetze'] as $d) {
            $gesehen[] = $d['schluessel'];
        }
        wahr($g['version'] > $seit || $g['datensaetze'] === [], 'Fortschritt beim Paging');
        $seit = $g['version'];
    } while ($g['mehr']);
    gleich([3, 3, 1], $seiten, 'Seitengrössen');
    gleich(['k1', 'k3', 'k4', 'k5', 'k6', 'k7', 'k2'], $gesehen, 'nach Version sortiert, k2 zuletzt');
    gleich([1, 3, 4], array_column(holen($api, $c, 0, 3)['datensaetze'], 'version'), 'Version je Datensatz');
    gleich(8, $seit, 'Endversion');

    $erste = holen($api, $c, 0, 3);
    gleich(true, $erste['mehr']);
    gleich(4, $erste['version'], 'bei mehr: Version des letzten Datensatzes (k1=1, k3=3, k4=4)');

    gleich(8, count(holen($api, $c, 0, 9999)['datensaetze']) + 1, 'limit wird auf 500 begrenzt, alle 7 kommen');
    gleich(400, $api->bearbeite(anfrage('GET', '/sync', null, $c, [], ['seit' => '-1']))->status, 'negatives seit');
    gleich(400, $api->bearbeite(anfrage('GET', '/sync', null, $c, [], ['limit' => 'x']))->status, 'limit kein Int');
});

test('sync: zwei Personen sind getrennt', function (): void {
    $api = api();
    $anna = anmelden($api, 'anna@example.com');
    $ben = anmelden($api, 'ben@example.com');
    hochladen($api, $anna, [ds('lektion', 'gleich', ['von' => 'anna']), ds('einstellung', 'einstellungen', 1)]);
    $b = hochladen($api, $ben, [ds('lektion', 'gleich', ['von' => 'ben'], '2026-09-01T00:00:00.000Z')])->daten();
    gleich(['version' => 1, 'angenommen' => 1, 'abgelehnt' => []], $b, 'eigene Version, kein LWW gegen Anna');
    $gb = holen($api, $ben);
    gleich(1, count($gb['datensaetze']));
    gleich(['von' => 'ben'], $gb['datensaetze'][0]['daten']);
    $ga = holen($api, $anna);
    gleich(2, count($ga['datensaetze']));
    gleich(['von' => 'anna'], $ga['datensaetze'][0]['daten']);

    gleich(204, $api->bearbeite(anfrage('DELETE', '/daten', null, $ben))->status);
    gleich(false, holen($api, $anna)['datensaetze'][0]['geloescht'], 'Löschen von Ben trifft Anna nicht');
});

test('sync: Validierung und Grössenlimits', function (): void {
    $api = api();
    $c = anmelden($api);
    $gross = str_repeat('x', 5 * 1024 * 1024); // + Anführungszeichen > 5 MB
    $grenze = str_repeat('y', 5 * 1024 * 1024 - 2); // genau 5 MB als JSON-Text
    $r = hochladen($api, $c, [
        ds('quatsch', 'a', 1),
        ds('lektion', '', 1),
        ds('lektion', str_repeat('ä', 201), 1),
        ds('lektion', str_repeat('ä', 200), 1),
        ds('lektion', 'z', 1, '2026-10-01 10:00:00'),
        ds('lektion', 'z2', 1, '2026-02-30T10:00:00.000Z'),
        ['art' => 'lektion', 'schluessel' => 'ohne-daten', 'geaendertAm' => '2026-10-01T10:00:00.000Z', 'geloescht' => false],
        ds('lektion', 'null-daten', null),
        ds('lektion', 'gross', $gross),
        'kein-objekt',
        ds('einstellung', 'anthropicApiKey', 'sk-ant-x'),
        ds('einstellung', 'konto', null, '2026-10-01T10:00:00.000Z', true),
    ])->daten();
    gleich(1, $r['angenommen'], 'nur 200×ä');
    gleich(1, hochladen($api, $c, [ds('lektion', 'grenze', $grenze)])->daten()['angenommen'], 'genau 5 MB');
    gleich(
        ['art-ungueltig', 'schluessel-ungueltig', 'schluessel-ungueltig', 'zeitstempel-ungueltig', 'zeitstempel-ungueltig', 'daten-ungueltig', 'daten-ungueltig', 'zu-gross', 'ungueltig', 'schluessel-ungueltig', 'schluessel-ungueltig'],
        array_column($r['abgelehnt'], 'grund'),
    );
    gleich('quatsch', $r['abgelehnt'][0]['art']);
    gleich(['art' => 'einstellung', 'schluessel' => 'anthropicApiKey', 'grund' => 'schluessel-ungueltig'], $r['abgelehnt'][9], 'gerätebezogene Einstellung');

    $zuGross = $api->bearbeite(anfrage('POST', '/sync', '{"datensaetze":[' . str_repeat(' ', 8 * 1024 * 1024) . ']}', $c, ['content-type' => 'application/json']));
    gleich(413, $zuGross->status, 'Anfrage > 8 MB');
    gleich('zu-gross', $zuGross->daten()['fehler']);
    gleich(400, $api->bearbeite(anfrage('POST', '/sync', '{kaputt', $c, ['content-type' => 'application/json']))->status, 'kein JSON');
    gleich(400, $api->bearbeite(anfrage('POST', '/sync', ['etwas' => []], $c))->status, 'ohne datensaetze');
    gleich(400, $api->bearbeite(anfrage('POST', '/sync', [1, 2], $c))->status, 'Liste statt Objekt');
});

test('sync: Antwort von GET begrenzt die Grösse (mehr=true)', function (): void {
    $api = api();
    $c = anmelden($api);
    $teil = str_repeat('z', 1536 * 1024);
    for ($i = 1; $i <= 3; $i++) {
        hochladen($api, $c, [ds('lektion', "g$i", $teil)]);
    }
    hochladen($api, $c, [ds('lektion', 'riesig', str_repeat('r', 3 * 1024 * 1024))]);
    $seit = 0;
    foreach ([1, 2, 3, 4] as $erwartet) {
        $g = holen($api, $c, $seit);
        gleich(1, count($g['datensaetze']), "höchstens ~2 MB pro Antwort (Seite $erwartet)");
        gleich($erwartet, $g['version']);
        gleich($erwartet < 4, $g['mehr'], "mehr auf Seite $erwartet");
        $seit = $g['version'];
    }
    gleich('riesig', $g['datensaetze'][0]['schluessel'], 'ein Datensatz über dem Limit kommt trotzdem, allein');
});

test('sync: Stempel weit in der Zukunft oder vor 2000 werden angenommen und als korrigiert gemeldet', function (): void {
    $api = api();
    $c = anmelden($api);
    $r = hochladen($api, $c, [
        ds('lektion', 'zukunft', 1, '2099-01-01T00:00:00.000Z'),
        ds('lektion', 'alt', 2, '1999-12-31T23:59:59.000Z'),
        ds('lektion', 'normal', 3, '2026-10-01T10:00:00.000Z'),
    ])->daten();
    gleich(3, $r['angenommen']);
    gleich(['zukunft', 'alt'], array_column($r['korrigiert'], 'schluessel'));
    foreach ($r['korrigiert'] as $k) {
        wahr(abs(strtotime($k['geaendertAm']) - time()) < 120, 'auf jetzt gesetzt: ' . $k['geaendertAm']);
    }
    $g = holen($api, $c);
    gleich($r['korrigiert'][0]['geaendertAm'], $g['datensaetze'][0]['geaendertAm'], 'gespeicherter Stempel = gemeldeter');
    wahr(!isset(hochladen($api, $c, [ds('lektion', 'normal2', 1)])->daten()['korrigiert']), 'ohne Korrektur kein Feld');
});

test('sync: «veraltet» liefert den Serverstand mit (Grösse begrenzt)', function (): void {
    $api = api();
    $c = anmelden($api);
    hochladen($api, $c, [
        ds('lektion', 'l1', ['id' => 'l1', 'leer' => new stdClass()], '2026-10-02T10:00:00.000Z'),
        ds('pruefung', 'p1', null, '2026-10-02T10:00:00.000Z', true),
    ]);
    $r = hochladenRoh($api, $c, [
        ds('lektion', 'l1', ['id' => 'alt'], '2026-10-01T10:00:00.000Z'),
        ds('pruefung', 'p1', ['id' => 'p1'], '2026-10-01T10:00:00.000Z'),
    ]);
    wahr(str_contains($r->body, '"leer":{}'), 'leeres Objekt bleibt Objekt: ' . $r->body);
    $d = $r->daten();
    gleich(0, $d['angenommen']);
    gleich(['art' => 'lektion', 'schluessel' => 'l1', 'daten' => ['id' => 'l1', 'leer' => []], 'geaendertAm' => '2026-10-02T10:00:00.000Z', 'geloescht' => false, 'version' => 1], $d['abgelehnt'][0]['datensatz']);
    gleich(['art' => 'pruefung', 'schluessel' => 'p1', 'daten' => null, 'geaendertAm' => '2026-10-02T10:00:00.000Z', 'geloescht' => true, 'version' => 2], $d['abgelehnt'][1]['datensatz'], 'Grabstein');

    // Mehr als ~2 MB Serverstände: der Rest kommt ohne «datensatz» (Gerät holt dann regulär)
    $gross = str_repeat('g', 1200 * 1024);
    hochladen($api, $c, [ds('lektion', 'a', $gross, '2026-10-03T10:00:00.000Z'), ds('lektion', 'b', $gross, '2026-10-03T10:00:00.000Z')]);
    $r = hochladen($api, $c, [ds('lektion', 'a', 1), ds('lektion', 'b', 1)])->daten();
    gleich(['veraltet', 'veraltet'], array_column($r['abgelehnt'], 'grund'));
    gleich($gross, $r['abgelehnt'][0]['datensatz']['daten']);
    wahr(!isset($r['abgelehnt'][1]['datensatz']), 'zweiter ohne datensatz');
});

test('sync: Epoche und Erkennung einer zurückgesetzten Datenbank', function (): void {
    $api = api();
    $c = anmelden($api);
    $hoch = hochladenRoh($api, $c, [ds('lektion', 'a', 1), ds('lektion', 'b', 2)])->daten();
    $g = holenRoh($api, $c);
    wahr(preg_match('/^[0-9a-f]{16}$/', $g['epoche']) === 1, 'Epoche: ' . $g['epoche']);
    gleich($g['epoche'], $hoch['epoche'], 'POST nennt dieselbe Epoche');
    wahr(!isset($g['zurueckgesetzt']), 'normal ohne zurueckgesetzt');
    $ben = anmelden($api, 'ben@example.com');
    wahr(holenRoh($api, $ben)['epoche'] !== $g['epoche'], 'jede Person eigene Epoche');

    // Gerät kennt Version 800, Server hat (nach Wiederherstellung) nur 2
    $z = holenRoh($api, $c, 800);
    gleich(['version' => 2, 'epoche' => $g['epoche'], 'datensaetze' => [], 'mehr' => false, 'zurueckgesetzt' => true], $z);
    gleich(false, isset(holenRoh($api, $c, 2)['zurueckgesetzt']), 'seit = Version ist kein Rücksprung');
});

test('daten löschen: alles wird Grabstein mit neuer Version, Konto bleibt', function (): void {
    $api = api();
    $c = anmelden($api);
    hochladen($api, $c, [
        ds('lektion', 'a', 1),
        ds('fortschritt', 'b', 2),
        ds('pruefung', 'c', 3, '2026-10-01T10:00:00.000Z', true),
        ds('rueckmeldung', 'd', 4, gmdate('Y-m-d\TH:i:s.000\Z', time() + 3600)), // leicht in der Zukunft
    ]);
    gleich(204, $api->bearbeite(anfrage('DELETE', '/daten', null, $c))->status);
    $g = holen($api, $c, 4);
    gleich(['a', 'b', 'd'], array_column($g['datensaetze'], 'schluessel'), 'nur bisher lebende, neue Versionen');
    gleich([true, true, true], array_column($g['datensaetze'], 'geloescht'));
    gleich([null, null, null], array_column($g['datensaetze'], 'daten'));
    gleich(7, $g['version']);
    wahr($g['datensaetze'][2]['geaendertAm'] > gmdate('Y-m-d\TH:i:s', time() + 3599), 'Grabstein jünger als Zukunfts-Zeitstempel');
    gleich(200, $api->bearbeite(anfrage('GET', '/ich', null, $c))->status, 'Konto und Sitzung bleiben');
    // Ein Gerät, das offline noch eine ältere Änderung hatte, überschreibt die Löschung nicht.
    $alt = hochladen($api, $c, [ds('lektion', 'a', 1, '2026-10-01T11:00:00.000Z')])->daten();
    gleich('veraltet', $alt['abgelehnt'][0]['grund'] ?? null);
    gleich(204, $api->bearbeite(anfrage('DELETE', '/daten', null, $c))->status, 'zweimal löschen');
    gleich(7, holen($api, $c, 0)['version'], 'nichts mehr zu löschen, Version gleich');
});

test('zeitstempel: Formate und Zukunft', function (): void {
    gleich('2026-10-25 08:15:00.123', Sync::zeitstempel('2026-10-25T08:15:00.123Z'));
    gleich('2026-10-25 08:15:00.000', Sync::zeitstempel('2026-10-25T10:15:00+02:00'));
    gleich('2026-10-25 08:15:00.123', Sync::zeitstempel('2026-10-25T08:15:00.123456789Z'));
    gleich(null, Sync::zeitstempel('2026-10-25T08:15:00'), 'ohne Zone');
    $korrigiert = null;
    $alt = Sync::zeitstempel('1999-12-31T23:59:59Z', $korrigiert);
    wahr($alt !== null && $alt > '2026', 'vor 2000 → jetzt: ' . $alt);
    gleich(true, $korrigiert, 'vor 2000 korrigiert');
    Sync::zeitstempel('2026-10-25T08:15:00.123Z', $korrigiert);
    gleich(false, $korrigiert, 'normal nicht korrigiert');
    gleich(null, Sync::zeitstempel(1729843200));
    $zukunft = Sync::zeitstempel('2099-01-01T00:00:00.000Z');
    wahr($zukunft !== null && $zukunft < '2027', 'ferne Zukunft auf jetzt gekürzt: ' . $zukunft);
    Sync::zeitstempel('2099-01-01T00:00:00.000Z', $korrigiert);
    gleich(true, $korrigiert, 'Zukunft korrigiert');
    gleich('2026-10-25T08:15:00.123Z', Sync::zeitAusDb('2026-10-25 08:15:00.123'));
});

test('sync: derselbe Stand erneut gesendet ist kein «veraltet» und keine neue Version', function (): void {
    $api = api();
    $c = anmelden($api);
    $ds = ds('lektion', 'l1', ['id' => 'l1', 'titel' => 'Ä'], '2026-10-01T10:00:00.000Z');
    gleich(['version' => 1, 'angenommen' => 1, 'abgelehnt' => []], hochladen($api, $c, [$ds])->daten());
    // Antwort ging verloren, Gerät sendet dasselbe noch einmal
    gleich(['version' => 1, 'angenommen' => 0, 'abgelehnt' => []], hochladen($api, $c, [$ds])->daten(), 'Wiederholung');
    // Gleicher Zeitpunkt, anderer Inhalt: Serverstand gewinnt
    $anders = hochladen($api, $c, [ds('lektion', 'l1', ['id' => 'l1', 'titel' => 'B'], '2026-10-01T10:00:00.000Z')])->daten();
    gleich('veraltet', $anders['abgelehnt'][0]['grund'] ?? null, 'anderer Inhalt');
    // Grabstein zweimal
    $grab = ds('lektion', 'l1', null, '2026-10-01T11:00:00.000Z', true);
    gleich(1, hochladen($api, $c, [$grab])->daten()['angenommen']);
    gleich(['version' => 2, 'angenommen' => 0, 'abgelehnt' => []], hochladen($api, $c, [$grab])->daten(), 'Grabstein wiederholt');
});
