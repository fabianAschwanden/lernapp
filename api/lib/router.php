<?php

declare(strict_types=1);

namespace Lernapp;

use PDO;

/**
 * Die API: nimmt eine Anfrage entgegen, liefert eine Antwort. Kein globaler Zustand,
 * damit die Tests sie direkt aufrufen können.
 *
 * Schutz: Alle Endpunkte ausser status/auth/test/admin verlangen eine gültige Sitzung
 * und eine freigegebene Adresse. Ändernde Anfragen verlangen «X-Lernapp: 1» und (mit
 * Körper) Content-Type application/json — ein fremdes Formular oder <img> kann beides
 * nicht setzen (CSRF). Keine CORS-Header.
 */
final class Api
{
    private ?PDO $pdo = null;

    /** @param \Closure(Konfiguration): PDO $pdoFabrik */
    public function __construct(
        private readonly Konfiguration $k,
        private readonly \Closure $pdoFabrik,
        private readonly string $migrationsVerzeichnis,
    ) {
    }

    public function pdo(): PDO
    {
        return $this->pdo ??= ($this->pdoFabrik)($this->k);
    }

    public function bearbeite(Anfrage $a): Antwort
    {
        try {
            return $this->route($a);
        } catch (HttpFehler $f) {
            $antwort = $f->alsAntwort();
            if ($f->status === 401 && isset($a->cookies[$this->sitzungen()->cookieName($a)])) {
                $antwort->cookies[] = $this->sitzungen()->loeschCookie($a);
            }
            return $antwort;
        } catch (\Throwable $t) {
            error_log('lernapp: ' . $a->methode . ' ' . $a->pfad . ': ' . get_class($t) . ': ' . $t->getMessage()
                . ' in ' . $t->getFile() . ':' . $t->getLine());
            return Antwort::fehler(500, 'server', 'Interner Fehler. Bitte versuch es später noch einmal.');
        }
    }

    private function route(Anfrage $a): Antwort
    {
        $pfad = $a->pfad === '/' ? '/' : rtrim($a->pfad, '/');
        $m = $a->methode;

        switch ($pfad) {
            case '/status':
                $this->methode($m, 'GET');
                return $this->status();

            case '/auth/google/start':
                $this->methode($m, 'GET');
                return $this->google()->start($a);

            case '/auth/google/callback':
                $this->methode($m, 'GET');
                return $this->google()->callback($a);

            case '/auth/abmelden':
                $this->methode($m, 'POST');
                $this->pruefeCsrf($a);
                $this->sitzungen()->abmelden($a);
                $antwort = Antwort::leer();
                $antwort->cookies[] = $this->sitzungen()->loeschCookie($a);
                return $antwort;

            case '/auth/abmelden-ueberall':
                $this->methode($m, 'POST');
                $this->pruefeCsrf($a);
                $s = $this->sitzungen()->pruefe($a);
                $this->sitzungen()->abmeldenUeberall($s->benutzerId);
                $antwort = Antwort::leer();
                $antwort->cookies[] = $this->sitzungen()->loeschCookie($a);
                return $antwort;

            case '/ich':
                $this->methode($m, 'GET');
                $s = $this->sitzungen()->pruefe($a);
                return $this->mitSitzung($s, Antwort::json(['email' => $s->email, 'name' => $s->name, 'konto' => $s->konto]));

            case '/sync':
                $this->methode($m, 'GET', 'POST');
                if ($m === 'POST') {
                    $this->pruefeCsrf($a);
                }
                $s = $this->sitzungen()->pruefe($a);
                $this->pruefeKonto($a, $s);
                $sync = new Sync($this->pdo(), $this->k);
                return $this->mitSitzung($s, $m === 'GET'
                    ? $sync->holen($s->benutzerId, $a)
                    : Antwort::json($sync->hochladen($s->benutzerId, $a)));

            case '/daten':
                $this->methode($m, 'DELETE');
                $this->pruefeCsrf($a);
                $s = $this->sitzungen()->pruefe($a);
                $this->pruefeKonto($a, $s);
                (new Sync($this->pdo(), $this->k))->allesLoeschen($s->benutzerId);
                // Die übrigen Geräte abmelden (z. B. ein verlorenes Handy), die eigene Sitzung bleibt.
                $this->sitzungen()->andereBeenden($s->benutzerId, $s->tokenHash);
                return $this->mitSitzung($s, Antwort::leer());

            case '/admin/migrieren':
                $this->methode($m, 'POST');
                return $this->migrieren($a);

            case '/test/anmelden':
                if (!$this->testAnmeldungErlaubt($a)) {
                    throw new HttpFehler(404, 'nicht-gefunden', 'Diese Adresse gibt es nicht.');
                }
                $this->methode($m, 'POST');
                $this->pruefeCsrf($a);
                return $this->testAnmelden($a);
        }
        throw new HttpFehler(404, 'nicht-gefunden', 'Diese Adresse gibt es nicht.');
    }

    private function methode(string $methode, string ...$erlaubt): void
    {
        if (!in_array($methode, $erlaubt, true)) {
            throw new HttpFehler(405, 'methode', 'Diese Methode ist hier nicht erlaubt.');
        }
    }

    /** CSRF-Schutz für ändernde Anfragen. */
    private function pruefeCsrf(Anfrage $a): void
    {
        if (($a->header('x-lernapp') ?? '') !== '1') {
            throw new HttpFehler(403, 'csrf', 'Anfrage abgelehnt (Header X-Lernapp fehlt).');
        }
        if ($a->laenge() > 0) {
            $typ = strtolower(trim(explode(';', $a->header('content-type') ?? '', 2)[0]));
            if ($typ !== 'application/json') {
                throw new HttpFehler(403, 'csrf', 'Anfrage abgelehnt (Content-Type muss application/json sein).');
            }
        }
    }

    /**
     * Schickt das Gerät mit «X-Lernapp-Konto» mit, für welches Konto es Daten hat, muss die
     * Sitzung zu genau diesem Konto gehören — sonst landeten Daten eines veralteten Tabs
     * (andere Person inzwischen angemeldet) im falschen Konto.
     */
    private function pruefeKonto(Anfrage $a, Sitzung $s): void
    {
        $konto = $a->header('x-lernapp-konto') ?? '';
        if ($konto !== '' && !hash_equals($s->konto, $konto)) {
            throw new HttpFehler(409, 'anderes-konto', 'In diesem Browser ist inzwischen ein anderes Konto angemeldet.');
        }
    }

    private function mitSitzung(Sitzung $s, Antwort $antwort): Antwort
    {
        if ($s->cookieErneuert !== null) {
            $antwort->cookies[] = $s->cookieErneuert;
        }
        return $antwort;
    }

    private function sitzungen(): Sitzungen
    {
        return new Sitzungen(fn (): PDO => $this->pdo(), $this->k);
    }

    private function google(): GoogleLogin
    {
        return new GoogleLogin($this->k, $this->sitzungen());
    }

    private function migrationen(): Migrationen
    {
        return new Migrationen($this->pdo(), $this->k, $this->migrationsVerzeichnis);
    }

    /** GET /api/status → {ok, schema}; 503, wenn die DB fehlt oder das Schema veraltet ist. */
    private function status(): Antwort
    {
        try {
            $migrationen = $this->migrationen();
            $schema = $migrationen->aktuelleVersion();
            $ok = $schema >= $migrationen->erwarteteVersion();
        } catch (\Throwable $t) {
            error_log('lernapp: Status: Datenbank nicht erreichbar: ' . $t->getMessage());
            return Antwort::json(['ok' => false, 'schema' => null, 'fehler' => 'datenbank', 'meldung' => 'Datenbank nicht erreichbar.'], 503);
        }
        if (!$ok) {
            return Antwort::json(['ok' => false, 'schema' => $schema, 'fehler' => 'schema', 'meldung' => 'Datenbankschema ist nicht aktuell.'], 503);
        }
        return Antwort::json(['ok' => true, 'schema' => $schema]);
    }

    /**
     * POST /api/admin/migrieren mit «Authorization: Bearer <deploy_token>».
     * Bewusst ohne X-Lernapp-Pflicht: kein Cookie im Spiel, also kein CSRF möglich.
     */
    private function migrieren(Anfrage $a): Antwort
    {
        $erwartet = $this->k->deployToken;
        $kopf = $a->header('authorization') ?? '';
        $token = preg_match('/^Bearer\s+(\S+)\s*$/i', $kopf, $treffer) === 1 ? $treffer[1] : '';
        if ($erwartet === '' || $token === '' || !hash_equals($erwartet, $token)) {
            throw new HttpFehler(403, 'nicht-berechtigt', 'Kein gültiges Deploy-Token.');
        }
        return Antwort::json(['schema' => $this->migrationen()->ausfuehren()]);
    }

    /** Nur im Testmodus und nur unter dem eingebauten PHP-Server (php -S). */
    private function testAnmeldungErlaubt(Anfrage $a): bool
    {
        $sapiOk = PHP_SAPI === 'cli-server' || (PHP_SAPI === 'cli' && $a->sapi === 'cli-server');
        return $this->k->testmodus === true && $sapiOk;
    }

    /** POST /api/test/anmelden {email, name} — wie der Google-Login, inkl. Allowlist (E2E). */
    private function testAnmelden(Anfrage $a): Antwort
    {
        $daten = json_decode($a->body, true);
        $email = is_array($daten) && is_string($daten['email'] ?? null) ? Konfiguration::normalisiereEmail($daten['email']) : '';
        $name = is_array($daten) && is_string($daten['name'] ?? null) && trim($daten['name']) !== '' ? $daten['name'] : $email;
        if ($email === '' || !str_contains($email, '@') || strlen($email) > 200) {
            throw new HttpFehler(400, 'ungueltig', 'E-Mail-Adresse fehlt.');
        }
        if (!$this->k->istErlaubt($email)) {
            throw new HttpFehler(403, 'nicht-freigegeben', 'Deine Google-Adresse ist für die Lernapp nicht freigegeben.');
        }
        $sitzung = $this->sitzungen()->anmelden($a, 'test:' . $email, $email, $name);
        $antwort = Antwort::json(['email' => $email, 'name' => $name, 'konto' => $sitzung['konto']]);
        $antwort->cookies[] = $sitzung['cookie'];
        return $antwort;
    }
}

/** Einstieg für index.php: Konfiguration laden, Anfrage bearbeiten, Antwort senden. */
function hauptprogramm(string $apiVerzeichnis): void
{
    $pfad = Konfiguration::suchePfad($apiVerzeichnis);
    try {
        if ($pfad === null) {
            throw new \RuntimeException('Keine Konfiguration gefunden (LERNAPP_CONFIG oder ~/private/lernapp/config.php).');
        }
        $k = Konfiguration::ausDatei($pfad);
    } catch (\Throwable $t) {
        error_log('lernapp: ' . $t->getMessage());
        Antwort::fehler(503, 'konfiguration', 'Die Lernapp ist noch nicht eingerichtet.')->senden();
        return;
    }
    $api = new Api($k, \Closure::fromCallable('Lernapp\verbinde'), $apiVerzeichnis . '/migrationen');
    $api->bearbeite(Anfrage::ausGlobals())->senden();
}
