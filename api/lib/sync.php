<?php

declare(strict_types=1);

namespace Lernapp;

use PDO;

/**
 * Synchronisation der Datensätze einer Person.
 *
 * Jeder Datensatz ist (art, schluessel) → JSON-Wert. Konflikte entscheidet «last write wins»
 * nach geaendertAm; bei Gleichstand bleibt der Serverstand. Gelöschte Datensätze bleiben als
 * Grabstein (daten null) erhalten, damit andere Geräte die Löschung sehen. Jede angenommene
 * Änderung erhält eine neue, pro Person monoton steigende Version (benutzer.sync_version).
 */
final class Sync
{
    public const ARTEN = ['lektion', 'fortschritt', 'pruefung', 'rueckmeldung', 'einstellung'];
    /** Erlaubte Schlüssel der Art «einstellung» (wie SYNC_EINSTELLUNGEN im Client). */
    public const EINSTELLUNGEN = ['einstellungen'];
    /** Zeitstempel weiter als so viele Sekunden in der Zukunft (oder vor 2000) werden auf «jetzt» gesetzt. */
    private const ZUKUNFT_TOLERANZ = 24 * 3600;
    private const JSON_FLAGS = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_THROW_ON_ERROR;

    public function __construct(
        private readonly PDO $pdo,
        private readonly Konfiguration $k,
    ) {
    }

    /**
     * GET /api/sync?seit=&limit= — Datensätze mit version > seit, aufsteigend.
     *
     * «version» ist die Server-Version der Person; ist «mehr» true, ist es die Version des
     * letzten gelieferten Datensatzes — der nächste Aufruf nimmt sie als «seit».
     * Jeder Datensatz trägt zusätzlich seine eigene «version». «epoche» wechselt, wenn die
     * Datenbank zurückgesetzt wurde (Wiederherstellung aus einem Backup); ist «seit» grösser
     * als die Server-Version, kommt «zurueckgesetzt»: true — das Gerät gleicht dann alles neu ab.
     */
    public function holen(int $benutzerId, Anfrage $a): Antwort
    {
        $seit = self::ganzzahl($a->query['seit'] ?? null, 0);
        $limit = min(Grenzen::SYNC_LIMIT_MAX, max(1, self::ganzzahl($a->query['limit'] ?? null, Grenzen::SYNC_LIMIT_MAX)));
        $tabelle = $this->k->tabelle('datensaetze');

        $this->pdo->exec('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
        try {
            $v = $this->pdo->prepare('SELECT sync_version, sync_epoche FROM `' . $this->k->tabelle('benutzer') . '` WHERE id = ?');
            $v->execute([$benutzerId]);
            $benutzer = $v->fetch() ?: ['sync_version' => 0, 'sync_epoche' => ''];
            $serverVersion = (int) $benutzer['sync_version'];
            $epoche = (string) $benutzer['sync_epoche'];
            if ($seit > $serverVersion) {
                $this->pdo->exec('COMMIT');
                return Antwort::jsonRoh('{"version":' . $serverVersion . ',"epoche":' . json_encode($epoche, self::JSON_FLAGS)
                    . ',"datensaetze":[],"mehr":false,"zurueckgesetzt":true}');
            }

            // Erst nur Grössen lesen, damit eine Antwort nicht Hunderte Megabyte umfasst.
            $groessen = $this->pdo->prepare(
                "SELECT version, COALESCE(LENGTH(daten), 0) AS bytes FROM `$tabelle`
                  WHERE benutzer_id = ? AND version > ? ORDER BY version LIMIT ?"
            );
            $groessen->bindValue(1, $benutzerId, PDO::PARAM_INT);
            $groessen->bindValue(2, $seit, PDO::PARAM_INT);
            $groessen->bindValue(3, $limit + 1, PDO::PARAM_INT);
            $groessen->execute();
            $bis = $seit;
            $anzahl = 0;
            $summe = 0;
            $mehr = false;
            foreach ($groessen->fetchAll() as $zeile) {
                $bytes = (int) $zeile['bytes'];
                if ($anzahl >= $limit || ($anzahl > 0 && $summe + $bytes > Grenzen::SYNC_ANTWORT_MAX_BYTES)) {
                    $mehr = true;
                    break;
                }
                $anzahl++;
                $summe += $bytes;
                $bis = (int) $zeile['version'];
            }

            $teile = [];
            if ($anzahl > 0) {
                $stmt = $this->pdo->prepare(
                    "SELECT art, schluessel, daten, geaendert_am, geloescht, version FROM `$tabelle`
                      WHERE benutzer_id = ? AND version > ? AND version <= ? ORDER BY version"
                );
                $stmt->execute([$benutzerId, $seit, $bis]);
                while (($z = $stmt->fetch()) !== false) {
                    $geloescht = (int) $z['geloescht'] === 1;
                    // daten ist bereits gültiges JSON (so gespeichert) und wird unverändert eingesetzt.
                    $teile[] = '{"art":' . json_encode((string) $z['art'], self::JSON_FLAGS)
                        . ',"schluessel":' . json_encode((string) $z['schluessel'], self::JSON_FLAGS)
                        . ',"daten":' . ($geloescht || $z['daten'] === null ? 'null' : (string) $z['daten'])
                        . ',"geaendertAm":' . json_encode(self::zeitAusDb((string) $z['geaendert_am']), self::JSON_FLAGS)
                        . ',"geloescht":' . ($geloescht ? 'true' : 'false')
                        . ',"version":' . (int) $z['version'] . '}';
                }
            }
            $this->pdo->exec('COMMIT');
        } catch (\Throwable $t) {
            $this->pdo->exec('ROLLBACK');
            throw $t;
        }

        $version = $mehr ? $bis : max($serverVersion, $bis);
        return Antwort::jsonRoh(
            '{"version":' . $version . ',"epoche":' . json_encode($epoche, self::JSON_FLAGS)
            . ',"datensaetze":[' . implode(',', $teile) . '],"mehr":' . ($mehr ? 'true' : 'false') . '}'
        );
    }

    /**
     * POST /api/sync — nimmt Änderungen entgegen.
     *
     * «veraltet» trägt den Serverstand als «datensatz» (Format wie bei GET) mit, solange die
     * mitgelieferten Daten SYNC_ANTWORT_MAX_BYTES nicht übersteigen — das Gerät übernimmt ihn
     * gezielt, statt alles neu zu holen. «korrigiert» nennt angenommene Datensätze, deren
     * Zeitstempel der Server ersetzt hat (Geräteuhr weit in der Zukunft oder vor 2000).
     *
     * @return array{version: int, epoche: string, angenommen: int, abgelehnt: list<array<string, mixed>>, korrigiert?: list<array{art: string, schluessel: string, geaendertAm: string}>}
     */
    public function hochladen(int $benutzerId, Anfrage $a): array
    {
        if ($a->laenge() > Grenzen::ANFRAGE_MAX_BYTES) {
            throw new HttpFehler(413, 'zu-gross', 'Die Anfrage ist grösser als 8 MB. Bitte in kleineren Paketen senden.');
        }
        try {
            $body = json_decode($a->body, false, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new HttpFehler(400, 'ungueltig', 'Die Anfrage ist kein gültiges JSON.');
        }
        if (!$body instanceof \stdClass || !isset($body->datensaetze) || !is_array($body->datensaetze)) {
            throw new HttpFehler(400, 'ungueltig', 'Es fehlt die Liste «datensaetze».');
        }
        if (count($body->datensaetze) > Grenzen::DATENSAETZE_PRO_ANFRAGE_MAX) {
            throw new HttpFehler(413, 'zu-gross', 'Zu viele Datensätze in einer Anfrage (höchstens 1000).');
        }

        $abgelehnt = [];
        $gueltig = [];
        foreach ($body->datensaetze as $eintrag) {
            $ergebnis = self::pruefeDatensatz($eintrag);
            if (is_string($ergebnis['grund'] ?? null)) {
                $abgelehnt[] = ['art' => $ergebnis['art'], 'schluessel' => $ergebnis['schluessel'], 'grund' => $ergebnis['grund']];
            } else {
                $gueltig[] = $ergebnis;
            }
        }

        $tabelle = $this->k->tabelle('datensaetze');
        $benutzer = $this->k->tabelle('benutzer');
        [$version, $epoche, $angenommen, $veraltet, $korrigiert] = inTransaktion($this->pdo, function () use ($benutzerId, $gueltig, $tabelle, $benutzer): array {
            $sperre = $this->pdo->prepare("SELECT sync_version, sync_epoche FROM `$benutzer` WHERE id = ? FOR UPDATE");
            $sperre->execute([$benutzerId]);
            $zeile = $sperre->fetch() ?: ['sync_version' => 0, 'sync_epoche' => ''];
            $version = (int) $zeile['sync_version'];
            $start = $version;
            $mitgeliefert = 0;
            $korrigiert = [];

            $lesen = $this->pdo->prepare("SELECT geaendert_am, daten, geloescht, version FROM `$tabelle` WHERE benutzer_id = ? AND art = ? AND schluessel = ? FOR UPDATE");
            $schreiben = $this->pdo->prepare(
                "INSERT INTO `$tabelle` (benutzer_id, art, schluessel, daten, geaendert_am, geloescht, version)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE daten = VALUES(daten), geaendert_am = VALUES(geaendert_am),
                                         geloescht = VALUES(geloescht), version = VALUES(version)"
            );
            $veraltet = [];
            foreach ($gueltig as $d) {
                $lesen->execute([$benutzerId, $d['art'], $d['schluessel']]);
                $bestehend = $lesen->fetch();
                $lesen->closeCursor();
                if ($bestehend !== false) {
                    $vergleich = strcmp((string) $bestehend['geaendert_am'], $d['geaendertAm']);
                    // Derselbe Stand noch einmal (z. B. Antwort ging unterwegs verloren, Gerät sendet
                    // erneut): schon vorhanden, nichts zu tun — kein «veraltet», sonst holte das Gerät
                    // unnötig alles neu.
                    if ($vergleich === 0 && (bool) $bestehend['geloescht'] === $d['geloescht']
                        && ($d['geloescht'] || $bestehend['daten'] === $d['daten'])) {
                        continue;
                    }
                    // Sonst gewinnt bei Gleichstand der Serverstand.
                    if ($vergleich >= 0) {
                        $eintrag = ['art' => $d['art'], 'schluessel' => $d['schluessel'], 'grund' => 'veraltet'];
                        $datensatz = self::serverstand($d['art'], $d['schluessel'], $bestehend);
                        $bytes = strlen((string) ($bestehend['daten'] ?? ''));
                        if ($datensatz !== null && $mitgeliefert + $bytes <= Grenzen::SYNC_ANTWORT_MAX_BYTES) {
                            $mitgeliefert += $bytes;
                            $eintrag['datensatz'] = $datensatz;
                        }
                        $veraltet[] = $eintrag;
                        continue;
                    }
                }
                $version++;
                $schreiben->execute([
                    $benutzerId, $d['art'], $d['schluessel'], $d['daten'], $d['geaendertAm'], $d['geloescht'] ? 1 : 0, $version,
                ]);
                if ($d['korrigiert']) {
                    $korrigiert[] = ['art' => $d['art'], 'schluessel' => $d['schluessel'], 'geaendertAm' => self::zeitAusDb($d['geaendertAm'])];
                }
            }
            if ($version !== $start) {
                $this->pdo->prepare("UPDATE `$benutzer` SET sync_version = ? WHERE id = ?")->execute([$version, $benutzerId]);
            }
            return [$version, (string) $zeile['sync_epoche'], $version - $start, $veraltet, $korrigiert];
        });

        $antwort = ['version' => $version, 'epoche' => $epoche, 'angenommen' => $angenommen, 'abgelehnt' => array_merge($abgelehnt, $veraltet)];
        if ($korrigiert !== []) {
            $antwort['korrigiert'] = $korrigiert;
        }
        return $antwort;
    }

    /**
     * Gespeicherter Stand eines Datensatzes im Format von GET /api/sync; null, wenn die
     * Daten in der DB kein gültiges JSON sind (dann holt das Gerät ihn regulär).
     *
     * @param array<string, mixed> $zeile
     * @return array<string, mixed>|null
     */
    private static function serverstand(string $art, string $schluessel, array $zeile): ?array
    {
        $geloescht = (int) $zeile['geloescht'] === 1;
        $daten = null;
        if (!$geloescht && $zeile['daten'] !== null) {
            try {
                // Objekte als stdClass: «{}» bleibt ein Objekt.
                $daten = json_decode((string) $zeile['daten'], false, 512, JSON_THROW_ON_ERROR);
            } catch (\JsonException) {
                return null;
            }
        }
        return [
            'art' => $art,
            'schluessel' => $schluessel,
            'daten' => $daten,
            'geaendertAm' => self::zeitAusDb((string) $zeile['geaendert_am']),
            'geloescht' => $geloescht,
            'version' => (int) $zeile['version'],
        ];
    }

    /**
     * DELETE /api/daten — macht alle Datensätze der Person zu Grabsteinen (neue Versionen),
     * damit auch andere Geräte die Löschung nachziehen. Das Konto bleibt.
     */
    public function allesLoeschen(int $benutzerId): void
    {
        $tabelle = $this->k->tabelle('datensaetze');
        $benutzer = $this->k->tabelle('benutzer');
        inTransaktion($this->pdo, function () use ($benutzerId, $tabelle, $benutzer): void {
            $sperre = $this->pdo->prepare("SELECT sync_version FROM `$benutzer` WHERE id = ? FOR UPDATE");
            $sperre->execute([$benutzerId]);
            $this->pdo->prepare('SET @lernapp_v := ?')->execute([(int) $sperre->fetchColumn()]);
            // Zeitstempel: jetzt, mindestens aber 1 ms nach dem bisherigen — der Grabstein gewinnt überall.
            $this->pdo->prepare(
                "UPDATE `$tabelle`
                    SET daten = NULL, geloescht = 1,
                        geaendert_am = GREATEST(?, geaendert_am + INTERVAL 1000 MICROSECOND),
                        version = (@lernapp_v := @lernapp_v + 1)
                  WHERE benutzer_id = ? AND geloescht = 0
                  ORDER BY version"
            )->execute([jetztDb(), $benutzerId]);
            $this->pdo->prepare("UPDATE `$benutzer` SET sync_version = @lernapp_v WHERE id = ?")->execute([$benutzerId]);
        });
    }

    /**
     * Prüft einen hochgeladenen Datensatz.
     *
     * @return array{art: string, schluessel: string, daten: ?string, geaendertAm: string, geloescht: bool, korrigiert: bool}
     *       | array{art: mixed, schluessel: mixed, grund: string}
     */
    public static function pruefeDatensatz(mixed $e): array
    {
        if (!$e instanceof \stdClass) {
            return ['art' => null, 'schluessel' => null, 'grund' => 'ungueltig'];
        }
        $art = $e->art ?? null;
        $schluessel = $e->schluessel ?? null;
        $kennung = ['art' => is_scalar($art) ? $art : null, 'schluessel' => is_scalar($schluessel) ? $schluessel : null];

        if (!is_string($art) || !in_array($art, self::ARTEN, true)) {
            return $kennung + ['grund' => 'art-ungueltig'];
        }
        if (!is_string($schluessel) || $schluessel === '' || !mb_check_encoding($schluessel, 'UTF-8')
            || mb_strlen($schluessel) > Grenzen::SCHLUESSEL_MAX_ZEICHEN) {
            return $kennung + ['grund' => 'schluessel-ungueltig'];
        }
        // Gerätebezogene Werte (API-Schlüssel, Konto-Marker …) gehören nie auf den Server.
        if ($art === 'einstellung' && !in_array($schluessel, self::EINSTELLUNGEN, true)) {
            return $kennung + ['grund' => 'schluessel-ungueltig'];
        }
        $korrigiert = false;
        $zeit = self::zeitstempel($e->geaendertAm ?? null, $korrigiert);
        if ($zeit === null) {
            return $kennung + ['grund' => 'zeitstempel-ungueltig'];
        }
        $geloescht = ($e->geloescht ?? false) === true;
        $daten = null;
        if (!$geloescht) {
            if (!property_exists($e, 'daten') || $e->daten === null) {
                return $kennung + ['grund' => 'daten-ungueltig'];
            }
            try {
                $daten = json_encode($e->daten, self::JSON_FLAGS);
            } catch (\JsonException) {
                return $kennung + ['grund' => 'daten-ungueltig'];
            }
            if (strlen($daten) > Grenzen::DATEN_MAX_BYTES) {
                return $kennung + ['grund' => 'zu-gross'];
            }
        }
        return ['art' => $art, 'schluessel' => $schluessel, 'daten' => $daten, 'geaendertAm' => $zeit, 'geloescht' => $geloescht, 'korrigiert' => $korrigiert];
    }

    /**
     * ISO-8601-Zeitstempel (mit Zone, z. B. «2026-10-25T08:15:00.123Z») → DATETIME(3)-Text in UTC.
     * Null bei ungültigem Format. Weiter als 24 h in der Zukunft oder vor 2000 (Geräteuhr
     * falsch gestellt) wird auf jetzt gesetzt; $korrigiert meldet das.
     */
    public static function zeitstempel(mixed $wert, ?bool &$korrigiert = null): ?string
    {
        if (!is_string($wert) || preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/', $wert) !== 1) {
            return null;
        }
        // Mehr als Mikrosekunden kann DateTime nicht lesen.
        $wert = preg_replace('/(\.\d{6})\d+/', '$1', $wert) ?? $wert;
        try {
            $zeit = new \DateTimeImmutable($wert);
        } catch (\Exception) {
            return null;
        }
        $fehler = \DateTimeImmutable::getLastErrors();
        if ($fehler !== false && ($fehler['warning_count'] > 0 || $fehler['error_count'] > 0)) {
            return null; // z. B. 2026-02-30
        }
        $utc = new \DateTimeZone('UTC');
        $zeit = $zeit->setTimezone($utc);
        $korrigiert = (int) $zeit->format('Y') < 2000 || $zeit->getTimestamp() > time() + self::ZUKUNFT_TOLERANZ;
        if ($korrigiert) {
            $zeit = new \DateTimeImmutable('now', $utc);
        }
        return $zeit->format('Y-m-d H:i:s.v');
    }

    /** DATETIME(3)-Text aus der DB → ISO mit ms und «Z». */
    public static function zeitAusDb(string $db): string
    {
        $zeit = \DateTimeImmutable::createFromFormat('Y-m-d H:i:s.v', $db, new \DateTimeZone('UTC'))
            ?: \DateTimeImmutable::createFromFormat('Y-m-d H:i:s', $db, new \DateTimeZone('UTC'));
        return $zeit === false ? $db : $zeit->format('Y-m-d\TH:i:s.v\Z');
    }

    private static function ganzzahl(?string $wert, int $standard): int
    {
        if ($wert === null || $wert === '') {
            return $standard;
        }
        if (preg_match('/^\d{1,18}$/', $wert) !== 1) {
            throw new HttpFehler(400, 'ungueltig', 'Parameter muss eine ganze Zahl ≥ 0 sein.');
        }
        return (int) $wert;
    }
}
