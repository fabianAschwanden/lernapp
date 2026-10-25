<?php

declare(strict_types=1);

namespace Lernapp;

use PDO;

/** Angemeldete Person einer Anfrage. */
final class Sitzung
{
    public function __construct(
        public readonly int $benutzerId,
        public readonly string $email,
        public readonly string $name,
        public readonly string $tokenHash,
        /** Stabile Kennung des Kontos für die Geräte (siehe Sitzungen::kontoKennung). */
        public readonly string $konto,
        /** Neue Set-Cookie-Zeile, wenn die Sitzung gleitend verlängert wurde. */
        public readonly ?string $cookieErneuert = null,
    ) {
    }
}

/**
 * Sitzungen: Cookie «__Host-lernapp_sitzung» (im Testmodus über http ohne Präfix:
 * «lernapp_sitzung») mit 32 Byte Zufall (base64url), in der DB nur dessen SHA-256.
 * Das Präfix __Host- verlangt Secure, Path=/ und kein Domain-Attribut — so kann keine
 * andere Subdomain von urinet.ch ein eigenes Sitzungs-Cookie unterschieben.
 *
 * 90 Tage gültig, bei Gebrauch gleitend verlängert (höchstens einmal pro Stunde
 * geschrieben), aber nie über 365 Tage ab der Anmeldung hinaus. Die Allowlist wird bei
 * jeder Anfrage geprüft.
 */
final class Sitzungen
{
    public const DAUER = 90 * 24 * 3600;
    /** Absolute Höchstdauer ab der Anmeldung, unabhängig vom gleitenden Verlängern. */
    public const MAX_DAUER = 365 * 24 * 3600;
    public const ERNEUERN_NACH = 3600;

    private ?PDO $verbindung = null;

    /** @param PDO|\Closure(): PDO $pdoQuelle Verbindung oder Fabrik (erst bei Bedarf verbinden) */
    public function __construct(
        private readonly PDO|\Closure $pdoQuelle,
        private readonly Konfiguration $k,
    ) {
    }

    private function pdo(): PDO
    {
        return $this->verbindung ??= $this->pdoQuelle instanceof PDO ? $this->pdoQuelle : ($this->pdoQuelle)();
    }

    /** Secure-Flag: immer, ausser im Testmodus über unverschlüsseltes http (lokal). */
    public function cookieSicher(Anfrage $a): bool
    {
        return !($this->k->testmodus && !$a->https);
    }

    /** Name des Sitzungs-Cookies: mit __Host-Präfix, sobald es Secure ist. */
    public function cookieName(Anfrage $a): string
    {
        return $this->cookieSicher($a) ? '__Host-lernapp_sitzung' : 'lernapp_sitzung';
    }

    public function loeschCookie(Anfrage $a): string
    {
        return cookieZeile($this->cookieName($a), '', 0, '/', $this->cookieSicher($a));
    }

    /**
     * Stabile, nicht geheime Kennung eines Kontos für die Geräte: bleibt gleich, wenn sich
     * die Google-Adresse ändert, und unterscheidet zwei Personen sicher.
     */
    public static function kontoKennung(string $googleSub): string
    {
        return substr(hash('sha256', 'lernapp-konto:' . $googleSub), 0, 32);
    }

    /**
     * Legt die Person an bzw. aktualisiert sie (per google_sub) und eröffnet eine Sitzung.
     * Die Allowlist muss vorher geprüft sein.
     *
     * @return array{cookie: string, benutzerId: int, konto: string}
     */
    public function anmelden(Anfrage $a, string $googleSub, string $email, string $name): array
    {
        $b = $this->k->tabelle('benutzer');
        $s = $this->k->tabelle('sitzungen');
        $jetzt = gmdate('Y-m-d H:i:s');
        $email = Konfiguration::normalisiereEmail($email);
        $name = mb_substr(trim($name), 0, 200);

        $stmt = $this->pdo()->prepare(
            "INSERT INTO `$b` (google_sub, email, name, sync_version, sync_epoche, erstellt_am, letzte_anmeldung)
             VALUES (?, ?, ?, 0, ?, ?, ?)
             ON DUPLICATE KEY UPDATE email = VALUES(email), name = VALUES(name), letzte_anmeldung = VALUES(letzte_anmeldung)"
        );
        $stmt->execute([$googleSub, $email, $name, bin2hex(random_bytes(8)), $jetzt, $jetzt]);
        $id = $this->pdo()->prepare("SELECT id FROM `$b` WHERE google_sub = ?");
        $id->execute([$googleSub]);
        $benutzerId = (int) $id->fetchColumn();

        // Anmeldungen sind selten (Google + Allowlist), hier aufzuräumen kostet nichts.
        $this->aufraeumen();

        $token = zufallsToken(32);
        $this->pdo()->prepare(
            "INSERT INTO `$s` (token_hash, benutzer_id, erstellt_am, ablauf, zuletzt_genutzt) VALUES (?, ?, ?, ?, ?)"
        )->execute([hash('sha256', $token), $benutzerId, $jetzt, inSekundenDb(self::DAUER), $jetzt]);

        return [
            'cookie' => cookieZeile($this->cookieName($a), $token, self::DAUER, '/', $this->cookieSicher($a)),
            'benutzerId' => $benutzerId,
            'konto' => self::kontoKennung($googleSub),
        ];
    }

    /**
     * Prüft das Sitzungs-Cookie und die Allowlist.
     *
     * @throws HttpFehler 401 nicht-angemeldet | nicht-freigegeben
     */
    public function pruefe(Anfrage $a): Sitzung
    {
        $hash = $this->tokenHash($a);
        if ($hash === null) {
            throw new HttpFehler(401, 'nicht-angemeldet', 'Bitte melde dich an.');
        }
        $s = $this->k->tabelle('sitzungen');
        $b = $this->k->tabelle('benutzer');
        $stmt = $this->pdo()->prepare(
            "SELECT s.benutzer_id, s.zuletzt_genutzt, s.erstellt_am, b.email, b.name, b.google_sub
               FROM `$s` s JOIN `$b` b ON b.id = s.benutzer_id
              WHERE s.token_hash = ? AND s.ablauf > ? AND s.erstellt_am > ?"
        );
        $stmt->execute([$hash, gmdate('Y-m-d H:i:s'), self::aeltesteErstellung()]);
        $zeile = $stmt->fetch();
        if ($zeile === false) {
            throw new HttpFehler(401, 'nicht-angemeldet', 'Bitte melde dich an.');
        }
        if (!$this->k->istErlaubt((string) $zeile['email'])) {
            // Von der Allowlist entfernt: Zugang sofort weg, alle Sitzungen der Person schliessen.
            $this->abmeldenUeberall((int) $zeile['benutzer_id']);
            throw new HttpFehler(401, 'nicht-freigegeben', 'Deine Google-Adresse ist für die Lernapp nicht freigegeben.');
        }

        $cookie = null;
        $zuletzt = strtotime((string) $zeile['zuletzt_genutzt'] . ' UTC');
        if ($zuletzt === false || $zuletzt < time() - self::ERNEUERN_NACH) {
            $erstellt = strtotime((string) $zeile['erstellt_am'] . ' UTC');
            $grenze = ($erstellt === false ? time() : $erstellt) + self::MAX_DAUER;
            $neu = min(time() + self::DAUER, $grenze);
            $this->pdo()->prepare("UPDATE `$s` SET ablauf = ?, zuletzt_genutzt = ? WHERE token_hash = ?")
                ->execute([gmdate('Y-m-d H:i:s', $neu), gmdate('Y-m-d H:i:s'), $hash]);
            $name = $this->cookieName($a);
            $cookie = cookieZeile($name, (string) $a->cookies[$name], $neu - time(), '/', $this->cookieSicher($a));
        }

        return new Sitzung(
            (int) $zeile['benutzer_id'],
            (string) $zeile['email'],
            (string) $zeile['name'],
            $hash,
            self::kontoKennung((string) $zeile['google_sub']),
            $cookie,
        );
    }

    /** Löscht die Sitzung des Cookies (falls vorhanden). */
    public function abmelden(Anfrage $a): void
    {
        $hash = $this->tokenHash($a);
        if ($hash !== null) {
            $this->pdo()->prepare('DELETE FROM `' . $this->k->tabelle('sitzungen') . '` WHERE token_hash = ?')->execute([$hash]);
        }
    }

    /** Beendet alle Sitzungen der Person (auf allen Geräten). */
    public function abmeldenUeberall(int $benutzerId): void
    {
        $this->pdo()->prepare('DELETE FROM `' . $this->k->tabelle('sitzungen') . '` WHERE benutzer_id = ?')->execute([$benutzerId]);
    }

    /** Beendet alle Sitzungen der Person ausser der angegebenen. */
    public function andereBeenden(int $benutzerId, string $tokenHash): void
    {
        $this->pdo()->prepare('DELETE FROM `' . $this->k->tabelle('sitzungen') . '` WHERE benutzer_id = ? AND token_hash <> ?')
            ->execute([$benutzerId, $tokenHash]);
    }

    /** Entfernt abgelaufene Sitzungen und solche über der Höchstdauer. */
    public function aufraeumen(): void
    {
        $this->pdo()->prepare('DELETE FROM `' . $this->k->tabelle('sitzungen') . '` WHERE ablauf <= ? OR erstellt_am <= ?')
            ->execute([gmdate('Y-m-d H:i:s'), self::aeltesteErstellung()]);
    }

    private static function aeltesteErstellung(): string
    {
        return gmdate('Y-m-d H:i:s', time() - self::MAX_DAUER);
    }

    private function tokenHash(Anfrage $a): ?string
    {
        $token = $a->cookies[$this->cookieName($a)] ?? '';
        // 32 Byte base64url = 43 Zeichen
        if (preg_match('/^[A-Za-z0-9_-]{43}$/', $token) !== 1) {
            return null;
        }
        return hash('sha256', $token);
    }
}
