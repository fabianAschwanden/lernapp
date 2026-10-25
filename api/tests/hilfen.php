<?php

declare(strict_types=1);

use Lernapp\Anfrage;
use Lernapp\Antwort;
use Lernapp\Api;
use Lernapp\Konfiguration;

require dirname(__DIR__) . '/lib/alle.php';

/** Sammelt und startet die Tests. */
final class Testlauf
{
    /** @var array<string, callable> */
    public static array $tests = [];
    public static int $pruefungen = 0;
    private static ?\PDO $pdo = null;
    /** @var resource|null */
    private static $mockProzess = null;
    private static int $mockPort = 0;

    public static function alle(string $filter): int
    {
        $ok = 0;
        $fehler = [];
        foreach (self::$tests as $name => $test) {
            if ($filter !== '' && !str_contains($name, $filter)) {
                continue;
            }
            try {
                self::schemaNeu();
                $test();
                $ok++;
                echo '.';
            } catch (\Throwable $t) {
                $fehler[$name] = $t;
                echo 'F';
            }
        }
        self::mockStoppen();
        echo "\n\n";
        foreach ($fehler as $name => $t) {
            echo "FEHLER: $name\n  " . get_class($t) . ': ' . $t->getMessage() . "\n  " . $t->getFile() . ':' . $t->getLine() . "\n";
            foreach (array_slice($t->getTrace(), 0, 3) as $f) {
                echo '    ' . ($f['file'] ?? '?') . ':' . ($f['line'] ?? '?') . "\n";
            }
        }
        $anzahl = $ok + count($fehler);
        echo "$anzahl Tests, $ok bestanden, " . count($fehler) . ' fehlgeschlagen, ' . self::$pruefungen . " Prüfungen.\n";
        return $fehler === [] && $anzahl > 0 ? 0 : 1;
    }

    public static function pdo(): \PDO
    {
        return self::$pdo ??= Lernapp\verbinde(testKonfig());
    }

    /** Alle Tabellen mit Test-Präfix löschen und Migrationen neu ausführen. */
    public static function schemaNeu(): void
    {
        $pdo = self::pdo();
        $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
        foreach (['phptest_', 'phpleer_'] as $praefix) {
            $stmt = $pdo->prepare('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE ?');
            $stmt->execute([str_replace('_', '\_', $praefix) . '%']);
            foreach ($stmt->fetchAll(\PDO::FETCH_COLUMN) as $tabelle) {
                $pdo->exec("DROP TABLE `$tabelle`");
            }
        }
        $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
        (new Lernapp\Migrationen($pdo, testKonfig(), MIGRATIONEN))->ausfuehren();
    }

    /** Startet einmalig den gemockten Google-Token-Endpunkt (php -S) und liefert seine URL. */
    public static function mockUrl(): string
    {
        if (self::$mockProzess === null) {
            $sock = stream_socket_server('tcp://127.0.0.1:0');
            $name = stream_socket_get_name($sock, false);
            fclose($sock);
            self::$mockPort = (int) substr((string) $name, strrpos((string) $name, ':') + 1);
            self::$mockProzess = proc_open(
                [PHP_BINARY, '-S', '127.0.0.1:' . self::$mockPort, __DIR__ . '/google-mock.php'],
                [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']],
                $pipes,
            );
            warteAufPort(self::$mockPort);
        }
        return 'http://127.0.0.1:' . self::$mockPort . '/token';
    }

    private static function mockStoppen(): void
    {
        if (is_resource(self::$mockProzess)) {
            proc_terminate(self::$mockProzess);
            proc_close(self::$mockProzess);
        }
    }
}

const MIGRATIONEN = __DIR__ . '/../migrationen';
const CLIENT_ID = 'client-123.apps.googleusercontent.com';
const CLIENT_SECRET = 'secret-xyz';
const BASIS = 'http://localhost:4321';

function test(string $name, callable $f): void
{
    Testlauf::$tests[$name] = $f;
}

function gleich(mixed $erwartet, mixed $ist, string $was = ''): void
{
    Testlauf::$pruefungen++;
    if ($erwartet !== $ist) {
        throw new \RuntimeException(($was !== '' ? "$was: " : '') . 'erwartet ' . var_export($erwartet, true) . ', erhalten ' . var_export($ist, true));
    }
}

function wahr(bool $bedingung, string $was): void
{
    Testlauf::$pruefungen++;
    if (!$bedingung) {
        throw new \RuntimeException('nicht erfüllt: ' . $was);
    }
}

function warteAufPort(int $port): void
{
    for ($i = 0; $i < 100; $i++) {
        $s = @fsockopen('127.0.0.1', $port, $errno, $errstr, 0.1);
        if ($s !== false) {
            fclose($s);
            return;
        }
        usleep(50_000);
    }
    throw new \RuntimeException("Port $port antwortet nicht");
}

/** @param array<string, mixed> $ueberschreiben */
function testKonfig(array $ueberschreiben = []): Konfiguration
{
    return Konfiguration::ausArray($ueberschreiben + [
        'db_dsn' => getenv('LERNAPP_TEST_DB_DSN') ?: 'mysql:host=127.0.0.1;port=3307;dbname=lernapp_test;charset=utf8mb4',
        'db_user' => getenv('LERNAPP_TEST_DB_USER') ?: 'lernapp',
        'db_password' => getenv('LERNAPP_TEST_DB_PASSWORD') ?: 'lernapp',
        'tabellen_praefix' => 'phptest_',
        'google_client_id' => CLIENT_ID,
        'google_client_secret' => CLIENT_SECRET,
        'basis_url' => BASIS,
        'erlaubte_emails' => [' Anna@Example.com ', 'ben@example.com'],
        'deploy_token' => 'deploy-test-token',
        'testmodus' => true,
    ]);
}

/** @param array<string, mixed> $ueberschreiben */
function api(array $ueberschreiben = []): Api
{
    return new Api(testKonfig($ueberschreiben), static fn (): \PDO => Testlauf::pdo(), MIGRATIONEN);
}

/**
 * Anfrage bauen. $body als Array wird JSON mit passenden Headern; ändernde Methoden
 * bekommen X-Lernapp: 1, ausser $header setzt ihn anders.
 *
 * @param array<string, string> $cookies
 * @param array<string, string> $header
 * @param array<string, string> $query
 */
function anfrage(
    string $methode,
    string $pfad,
    mixed $body = null,
    array $cookies = [],
    array $header = [],
    array $query = [],
    string $sapi = 'cli-server',
    bool $https = false,
): Anfrage {
    $roh = '';
    if (is_array($body)) {
        $roh = json_encode($body, JSON_THROW_ON_ERROR);
        $header += ['content-type' => 'application/json'];
    } elseif (is_string($body)) {
        $roh = $body;
    }
    if (in_array($methode, ['POST', 'PUT', 'DELETE'], true)) {
        $header += ['x-lernapp' => '1'];
    }
    $header = array_filter(array_change_key_case($header), static fn ($w): bool => $w !== null);
    return new Anfrage($methode, $pfad, $query, $header, $roh, $cookies, $https, $sapi);
}

/** Meldet eine Person über /test/anmelden an und liefert die Cookies für weitere Anfragen. */
function anmelden(Api $api, string $email = 'anna@example.com'): array
{
    $a = $api->bearbeite(anfrage('POST', '/test/anmelden', ['email' => $email, 'name' => 'Test']));
    gleich(200, $a->status, 'Anmeldung ' . $email);
    return ['lernapp_sitzung' => (string) $a->cookie('lernapp_sitzung')];
}

/** Sync-Datensatz für POST /api/sync. */
function ds(string $art, string $schluessel, mixed $daten, string $zeit = '2026-10-01T10:00:00.000Z', bool $geloescht = false): array
{
    return ['art' => $art, 'schluessel' => $schluessel, 'daten' => $daten, 'geaendertAm' => $zeit, 'geloescht' => $geloescht];
}

/** POST /api/sync; die (zufällige) «epoche» ist aus dem JSON-Körper entfernt, siehe hochladenRoh(). */
function hochladen(Api $api, array $cookies, array $datensaetze): Antwort
{
    $a = hochladenRoh($api, $cookies, $datensaetze);
    if ($a->status === 200) {
        $d = $a->daten();
        unset($d['epoche']);
        $a->body = json_encode($d, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
    return $a;
}

function hochladenRoh(Api $api, array $cookies, array $datensaetze): Antwort
{
    return $api->bearbeite(anfrage('POST', '/sync', ['datensaetze' => $datensaetze], $cookies));
}

/** GET /api/sync ohne «epoche», siehe holenRoh(). */
function holen(Api $api, array $cookies, int $seit = 0, ?int $limit = null): array
{
    $d = holenRoh($api, $cookies, $seit, $limit);
    unset($d['epoche']);
    return $d;
}

function holenRoh(Api $api, array $cookies, int $seit = 0, ?int $limit = null): array
{
    $query = ['seit' => (string) $seit] + ($limit === null ? [] : ['limit' => (string) $limit]);
    $a = $api->bearbeite(anfrage('GET', '/sync', null, $cookies, [], $query));
    gleich(200, $a->status, 'GET /sync');
    return $a->daten();
}

/** Aktuelle Schema-Version laut Migrationsdateien. */
function schemaVersion(): int
{
    return count(glob(MIGRATIONEN . '/[0-9][0-9][0-9]-*.sql') ?: []);
}

/** id_token ohne gültige Signatur (die API prüft sie bewusst nicht, siehe google.php). */
function jwt(array $claims): string
{
    return Lernapp\base64urlKodieren('{"alg":"RS256","typ":"JWT"}') . '.'
        . Lernapp\base64urlKodieren(json_encode($claims, JSON_THROW_ON_ERROR)) . '.c2lnbmF0dXI';
}
