<?php

declare(strict_types=1);

namespace Lernapp;

/**
 * Anmeldung mit Google (OpenID Connect, Authorization Code Flow mit PKCE S256, state und nonce).
 *
 * Der Login-Zustand (state, PKCE-Verifier, nonce, Rücksprungziel, Ablauf nach 10 Minuten)
 * liegt nicht in der Datenbank, sondern in einem mit HMAC-SHA256 signierten HttpOnly-Cookie
 * «__Host-lernapp_login» (im Testmodus über http ohne Präfix: «lernapp_login»). So kann
 * niemand ohne Anmeldung die geteilte Datenbank füllen, und der Zustand ist an den Browser
 * gebunden, der den Login gestartet hat (schützt vor untergeschobenen Logins). Der Schlüssel
 * ist aus dem Client-Secret abgeleitet. Einmalig ist der Zustand, weil der Callback das
 * Cookie löscht und Google jeden Code nur einmal einlöst.
 *
 * Signatur des id_token: Er kommt direkt per TLS (Zertifikatsprüfung an) vom Token-Endpunkt
 * https://oauth2.googleapis.com/token als Antwort auf unseren eigenen, mit dem Client-Secret
 * authentisierten Code-Tausch. Laut OpenID Connect Core 1.0, Abschnitt 3.1.3.7 Punkt 6, darf
 * dann die TLS-Server-Authentisierung die Signaturprüfung ersetzen. Geprüft werden iss, aud,
 * exp, nonce und email_verified.
 */
final class GoogleLogin
{
    private const ZUSTAND_DAUER = 600;
    /** Längstes Rücksprungziel; hält das Login-Cookie sicher unter 4 KB. */
    public const ZURUECK_MAX = 512;
    private const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
    private const AUSSTELLER = ['accounts.google.com', 'https://accounts.google.com'];

    public function __construct(
        private readonly Konfiguration $k,
        private readonly Sitzungen $sitzungen,
    ) {
    }

    public function redirectUri(): string
    {
        return $this->k->basisUrl . '/api/auth/google/callback';
    }

    /** Name des Login-Cookies: mit __Host-Präfix (verlangt Secure und Path=/), sobald es Secure ist. */
    public function loginCookieName(Anfrage $a): string
    {
        return $this->sitzungen->cookieSicher($a) ? '__Host-lernapp_login' : 'lernapp_login';
    }

    private function konfiguriert(): bool
    {
        return $this->k->googleClientId !== '' && $this->k->googleClientSecret !== '' && $this->k->basisUrl !== '';
    }

    /** GET /api/auth/google/start?zurueck=… */
    public function start(Anfrage $a): Antwort
    {
        if (!$this->konfiguriert()) {
            error_log('lernapp: Google-Login nicht konfiguriert (google_client_id/-secret/basis_url fehlen).');
            return Antwort::weiterleitung('/anmelden?fehler=fehler');
        }

        $zurueck = self::pruefeZurueck($a->query['zurueck'] ?? null);
        $state = zufallsToken(32);
        $verifier = zufallsToken(48);
        $nonce = zufallsToken(24);
        $zustand = $this->versiegeln([
            's' => $state,
            'v' => $verifier,
            'n' => $nonce,
            'z' => $zurueck,
            'e' => time() + self::ZUSTAND_DAUER,
        ]);

        $ziel = self::AUTH_URL . '?' . http_build_query([
            'response_type' => 'code',
            'client_id' => $this->k->googleClientId,
            'redirect_uri' => $this->redirectUri(),
            'scope' => 'openid email profile',
            'state' => $state,
            'nonce' => $nonce,
            'code_challenge' => base64urlKodieren(hash('sha256', $verifier, true)),
            'code_challenge_method' => 'S256',
            'prompt' => 'select_account',
        ], '', '&', PHP_QUERY_RFC3986);

        $antwort = Antwort::weiterleitung($ziel);
        $antwort->cookies[] = cookieZeile($this->loginCookieName($a), $zustand, self::ZUSTAND_DAUER, '/', $this->sitzungen->cookieSicher($a));
        return $antwort;
    }

    /** GET /api/auth/google/callback?code=…&state=… */
    public function callback(Anfrage $a): Antwort
    {
        $antwort = $this->callbackZiel($a);
        // Name und Pfad wie beim Setzen, sonst bleibt das Cookie liegen.
        $antwort->cookies[] = cookieZeile($this->loginCookieName($a), '', 0, '/', $this->sitzungen->cookieSicher($a));
        return $antwort;
    }

    private function callbackZiel(Anfrage $a): Antwort
    {
        $fehler = fn (string $code): Antwort => Antwort::weiterleitung('/anmelden?fehler=' . $code);

        if (isset($a->query['error'])) {
            // z. B. access_denied: Person hat bei Google abgebrochen
            return $fehler($a->query['error'] === 'access_denied' ? 'abgebrochen' : 'fehler');
        }
        if (!$this->konfiguriert()) {
            return $fehler('fehler');
        }
        $state = $a->query['state'] ?? '';
        $code = $a->query['code'] ?? '';
        if ($state === '' || $code === '' || strlen($state) > 200 || strlen($code) > 2048) {
            return $fehler('abgebrochen');
        }

        $zustand = $this->zustandEinloesen($state, $a->cookies[$this->loginCookieName($a)] ?? '');
        if ($zustand === null) {
            return $fehler('abgebrochen');
        }

        try {
            $idToken = $this->tauscheCode($code, $zustand['code_verifier']);
            $claims = $this->pruefeIdToken($idToken, $zustand['nonce']);
        } catch (\Throwable $t) {
            error_log('lernapp: Google-Login fehlgeschlagen: ' . $t->getMessage());
            return $fehler('fehler');
        }

        if (!$this->k->istErlaubt($claims['email'])) {
            return $fehler('nicht-freigegeben');
        }

        $sitzung = $this->sitzungen->anmelden($a, $claims['sub'], $claims['email'], $claims['name']);
        $antwort = Antwort::weiterleitung($zustand['zurueck']);
        $antwort->cookies[] = $sitzung['cookie'];
        return $antwort;
    }

    /** Schlüssel für die Signatur des Login-Zustands, aus dem Client-Secret abgeleitet. */
    private function schluessel(): string
    {
        return hash_hmac('sha256', 'lernapp-login-zustand', $this->k->googleClientSecret, true);
    }

    /** @param array<string, mixed> $daten */
    private function versiegeln(array $daten): string
    {
        $nutzlast = base64urlKodieren(json_encode($daten, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES));
        return $nutzlast . '.' . base64urlKodieren(hash_hmac('sha256', $nutzlast, $this->schluessel(), true));
    }

    /**
     * Prüft das Login-Cookie (Signatur, Ablauf, state). Null, wenn es fehlt, verändert,
     * abgelaufen oder nicht zu diesem state gehört.
     *
     * @return array{code_verifier: string, nonce: string, zurueck: string}|null
     */
    private function zustandEinloesen(string $state, string $cookie): ?array
    {
        $teile = explode('.', $cookie);
        if (count($teile) !== 2 || $teile[0] === '') {
            return null;
        }
        [$nutzlast, $signatur] = $teile;
        $erwartet = base64urlKodieren(hash_hmac('sha256', $nutzlast, $this->schluessel(), true));
        if (!hash_equals($erwartet, $signatur)) {
            return null;
        }
        $roh = base64urlDekodieren($nutzlast);
        $d = $roh === null ? null : json_decode($roh, true);
        if (!is_array($d) || !is_string($d['s'] ?? null) || !is_string($d['v'] ?? null)
            || !is_string($d['n'] ?? null) || !is_string($d['z'] ?? null) || !is_int($d['e'] ?? null)) {
            return null;
        }
        if ($d['e'] <= time() || !hash_equals($d['s'], $state)) {
            return null;
        }
        return [
            'code_verifier' => $d['v'],
            'nonce' => $d['n'],
            'zurueck' => self::pruefeZurueck($d['z']),
        ];
    }

    /** Tauscht den Code beim Token-Endpunkt gegen das id_token (curl, TLS-Prüfung an). */
    private function tauscheCode(string $code, string $verifier): string
    {
        $ch = curl_init($this->k->googleTokenUrl());
        if ($ch === false) {
            throw new \RuntimeException('curl_init fehlgeschlagen');
        }
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => http_build_query([
                'code' => $code,
                'client_id' => $this->k->googleClientId,
                'client_secret' => $this->k->googleClientSecret,
                'redirect_uri' => $this->redirectUri(),
                'grant_type' => 'authorization_code',
                'code_verifier' => $verifier,
            ], '', '&', PHP_QUERY_RFC3986),
            CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded', 'Accept: application/json'],
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | ($this->k->testmodus ? CURLPROTO_HTTP : 0),
        ]);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $curlFehler = curl_error($ch);
        if (!is_string($body)) {
            throw new \RuntimeException('Token-Endpunkt nicht erreichbar: ' . $curlFehler);
        }
        if ($status !== 200) {
            throw new \RuntimeException('Token-Endpunkt antwortet mit HTTP ' . $status);
        }
        $daten = json_decode($body, true);
        if (!is_array($daten) || !isset($daten['id_token']) || !is_string($daten['id_token'])) {
            throw new \RuntimeException('Antwort des Token-Endpunkts ohne id_token');
        }
        return $daten['id_token'];
    }

    /**
     * Prüft die Claims des id_token (Signatur siehe Klassenkommentar).
     *
     * @return array{sub: string, email: string, name: string}
     */
    public function pruefeIdToken(string $idToken, string $nonce): array
    {
        $teile = explode('.', $idToken);
        if (count($teile) !== 3) {
            throw new \RuntimeException('id_token ist kein JWT');
        }
        $roh = base64urlDekodieren($teile[1]);
        $c = $roh === null ? null : json_decode($roh, true);
        if (!is_array($c)) {
            throw new \RuntimeException('id_token-Inhalt unlesbar');
        }
        if (!in_array($c['iss'] ?? null, self::AUSSTELLER, true)) {
            throw new \RuntimeException('id_token: falscher Aussteller');
        }
        $aud = $c['aud'] ?? null;
        $audOk = is_string($aud)
            ? hash_equals($this->k->googleClientId, $aud)
            : (is_array($aud) && in_array($this->k->googleClientId, $aud, true)
                && ($c['azp'] ?? $this->k->googleClientId) === $this->k->googleClientId);
        if (!$audOk) {
            throw new \RuntimeException('id_token: falsche Zielgruppe (aud)');
        }
        if (!is_int($c['exp'] ?? null) || $c['exp'] < time() - 60) {
            throw new \RuntimeException('id_token abgelaufen');
        }
        if (!is_string($c['nonce'] ?? null) || !hash_equals($nonce, $c['nonce'])) {
            throw new \RuntimeException('id_token: nonce stimmt nicht');
        }
        $verifiziert = $c['email_verified'] ?? false;
        if ($verifiziert !== true && $verifiziert !== 'true') {
            throw new \RuntimeException('id_token: E-Mail-Adresse nicht bestätigt');
        }
        $sub = $c['sub'] ?? null;
        $email = $c['email'] ?? null;
        if (!is_string($sub) || $sub === '' || strlen($sub) > 255 || !is_string($email) || !str_contains($email, '@')) {
            throw new \RuntimeException('id_token: sub oder email fehlt');
        }
        $name = is_string($c['name'] ?? null) && trim($c['name']) !== '' ? $c['name'] : $email;
        return ['sub' => $sub, 'email' => $email, 'name' => $name];
    }

    /**
     * Rücksprungziel nach dem Login: nur relative Pfade, die mit «/» beginnen und nicht mit
     * «//» oder «/\» (sonst springt der Browser auf eine fremde Domain). Sonst «/».
     */
    public static function pruefeZurueck(mixed $zurueck): string
    {
        if (!is_string($zurueck) || $zurueck === '' || strlen($zurueck) > self::ZURUECK_MAX) {
            return '/';
        }
        if ($zurueck[0] !== '/' || str_starts_with($zurueck, '//') || str_contains($zurueck, '\\')) {
            return '/';
        }
        if (preg_match('/[\x00-\x20\x7f]/', $zurueck) === 1) {
            return '/';
        }
        return $zurueck;
    }
}
