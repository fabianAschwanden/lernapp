<?php

declare(strict_types=1);

namespace Lernapp;

/**
 * HTTP-Anfrage als einfaches Wertobjekt. index.php baut sie aus den Superglobals,
 * die Tests bauen sie direkt — so läuft die ganze API ohne Webserver testbar.
 */
final class Anfrage
{
    /**
     * @param array<string, string> $query
     * @param array<string, string> $header Namen klein geschrieben
     * @param array<string, string> $cookies
     */
    public function __construct(
        public readonly string $methode,
        public readonly string $pfad,
        public readonly array $query = [],
        public readonly array $header = [],
        public readonly string $body = '',
        public readonly array $cookies = [],
        public readonly bool $https = true,
        public readonly string $sapi = 'tests',
    ) {
    }

    public static function ausGlobals(): self
    {
        $header = [];
        foreach ($_SERVER as $name => $wert) {
            if (is_string($wert) && str_starts_with((string) $name, 'HTTP_')) {
                $header[strtolower(str_replace('_', '-', substr((string) $name, 5)))] = $wert;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $header['content-type'] = (string) $_SERVER['CONTENT_TYPE'];
        }
        if (isset($_SERVER['CONTENT_LENGTH'])) {
            $header['content-length'] = (string) $_SERVER['CONTENT_LENGTH'];
        }
        // Apache mit PHP-FPM reicht «Authorization» je nach Konfiguration nur so weiter.
        if (!isset($header['authorization']) && isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
            $header['authorization'] = (string) $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
        }
        if (!isset($header['authorization']) && function_exists('getallheaders')) {
            foreach (getallheaders() as $name => $wert) {
                if (strtolower((string) $name) === 'authorization') {
                    $header['authorization'] = (string) $wert;
                }
            }
        }

        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
        $pfad = (string) (parse_url($uri, PHP_URL_PATH) ?? '/');
        $pfad = rawurldecode($pfad);
        if ($pfad === '/api' || str_starts_with($pfad, '/api/')) {
            $pfad = substr($pfad, 4);
        }
        if ($pfad === '') {
            $pfad = '/';
        }

        $query = [];
        foreach ($_GET as $name => $wert) {
            if (is_string($wert)) {
                $query[(string) $name] = $wert;
            }
        }
        $cookies = [];
        foreach ($_COOKIE as $name => $wert) {
            if (is_string($wert)) {
                $cookies[(string) $name] = $wert;
            }
        }

        $https = (!empty($_SERVER['HTTPS']) && strtolower((string) $_SERVER['HTTPS']) !== 'off')
            || (string) ($_SERVER['SERVER_PORT'] ?? '') === '443';

        // Den Körper nur lesen, wenn er die Grenze nicht sprengt.
        $laenge = (int) ($header['content-length'] ?? 0);
        $body = $laenge > Grenzen::ANFRAGE_MAX_BYTES ? '' : (string) file_get_contents('php://input', false, null, 0, Grenzen::ANFRAGE_MAX_BYTES + 1);

        return new self(
            strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            $pfad,
            $query,
            $header,
            $body,
            $cookies,
            $https,
            PHP_SAPI,
        );
    }

    public function header(string $name): ?string
    {
        return $this->header[strtolower($name)] ?? null;
    }

    /** Deklarierte oder tatsächliche Länge des Körpers in Bytes. */
    public function laenge(): int
    {
        return max(strlen($this->body), (int) ($this->header('content-length') ?? 0));
    }
}

/** Grenzwerte der API (siehe Vertrag). */
final class Grenzen
{
    public const ANFRAGE_MAX_BYTES = 8 * 1024 * 1024;
    public const DATEN_MAX_BYTES = 5 * 1024 * 1024;
    public const SCHLUESSEL_MAX_ZEICHEN = 200;
    public const SYNC_LIMIT_MAX = 500;
    /**
     * Höchstens so viele Bytes `daten` pro Antwort von GET /api/sync (mindestens ein Datensatz).
     * Klein genug, dass eine Seite auch im langsamen Mobilnetz im Zeitlimit des Geräts ankommt.
     */
    public const SYNC_ANTWORT_MAX_BYTES = 2 * 1024 * 1024;
    public const DATENSAETZE_PRO_ANFRAGE_MAX = 1000;
}

final class Antwort
{
    /** @var list<string> */
    public array $cookies = [];

    /** @param array<string, string> $header */
    public function __construct(
        public int $status = 200,
        public array $header = [],
        public string $body = '',
    ) {
    }

    public static function json(mixed $daten, int $status = 200): self
    {
        $body = json_encode($daten, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        return new self($status, ['Content-Type' => 'application/json; charset=utf-8'], $body);
    }

    /** JSON-Antwort aus bereits kodiertem Text (spart bei grossen Sync-Antworten das Umkodieren). */
    public static function jsonRoh(string $json, int $status = 200): self
    {
        return new self($status, ['Content-Type' => 'application/json; charset=utf-8'], $json);
    }

    public static function fehler(int $status, string $code, string $meldung): self
    {
        return self::json(['fehler' => $code, 'meldung' => $meldung], $status);
    }

    public static function leer(int $status = 204): self
    {
        return new self($status);
    }

    public static function weiterleitung(string $ziel): self
    {
        return new self(302, ['Location' => $ziel]);
    }

    /** Dekodierter JSON-Körper (für Tests). */
    public function daten(): mixed
    {
        return $this->body === '' ? null : json_decode($this->body, true, 512, JSON_THROW_ON_ERROR);
    }

    /** Wert eines gesetzten Cookies (für Tests); null, wenn nicht gesetzt. */
    public function cookie(string $name): ?string
    {
        foreach ($this->cookies as $zeile) {
            if (str_starts_with($zeile, $name . '=')) {
                return rawurldecode(explode(';', substr($zeile, strlen($name) + 1), 2)[0]);
            }
        }
        return null;
    }

    public function senden(): void
    {
        http_response_code($this->status);
        header('X-Content-Type-Options: nosniff');
        header('Cache-Control: no-store');
        header('Referrer-Policy: no-referrer');
        foreach ($this->header as $name => $wert) {
            header($name . ': ' . $wert);
        }
        foreach ($this->cookies as $zeile) {
            header('Set-Cookie: ' . $zeile, false);
        }
        if ($this->status !== 204 && $this->status !== 302) {
            echo $this->body;
        }
    }
}

/** Bricht eine Anfrage mit einer Fehlerantwort {fehler, meldung} ab. */
final class HttpFehler extends \RuntimeException
{
    public function __construct(
        public readonly int $status,
        public readonly string $fehlerCode,
        string $meldung,
    ) {
        parent::__construct($meldung);
    }

    public function alsAntwort(): Antwort
    {
        return Antwort::fehler($this->status, $this->fehlerCode, $this->getMessage());
    }
}

/**
 * Baut eine Set-Cookie-Zeile.
 *
 * @param int $maxAlter Sekunden; 0 löscht das Cookie
 */
function cookieZeile(string $name, string $wert, int $maxAlter, string $pfad, bool $sicher): string
{
    $teile = [$name . '=' . rawurlencode($wert), 'Path=' . $pfad, 'Max-Age=' . max(0, $maxAlter)];
    if ($maxAlter <= 0) {
        $teile[] = 'Expires=Thu, 01 Jan 1970 00:00:00 GMT';
    } else {
        $teile[] = 'Expires=' . gmdate('D, d M Y H:i:s', time() + $maxAlter) . ' GMT';
    }
    if ($sicher) {
        $teile[] = 'Secure';
    }
    $teile[] = 'HttpOnly';
    $teile[] = 'SameSite=Lax';
    return implode('; ', $teile);
}

/** 32 Byte Zufall, base64url ohne Auffüllzeichen. */
function zufallsToken(int $bytes = 32): string
{
    return base64urlKodieren(random_bytes($bytes));
}

function base64urlKodieren(string $roh): string
{
    return rtrim(strtr(base64_encode($roh), '+/', '-_'), '=');
}

function base64urlDekodieren(string $text): ?string
{
    if ($text === '' || preg_match('/^[A-Za-z0-9_-]+$/', $text) !== 1) {
        return null;
    }
    $roh = base64_decode(strtr($text, '-_', '+/') . str_repeat('=', (4 - strlen($text) % 4) % 4), true);
    return $roh === false ? null : $roh;
}
