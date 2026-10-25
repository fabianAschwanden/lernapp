<?php

declare(strict_types=1);

namespace Lernapp;

/**
 * Konfiguration der API: eine PHP-Datei, die ein Array zurückgibt (Vorlage: api/config.beispiel.php).
 *
 * Gesucht wird in dieser Reihenfolge:
 *   1. Umgebungsvariable LERNAPP_CONFIG (lokal, Tests, E2E)
 *   2. das erste private/lernapp/config.php oberhalb des Webroots — auf Hostpoint liegt die API
 *      unter /home/<konto>/www/<verzeichnis>/api, die Konfiguration unter /home/<konto>/private/
 *   3. ${HOME}/private/lernapp/config.php
 */
final class Konfiguration
{
    /** @var list<string> klein geschrieben, getrimmt */
    public readonly array $erlaubteEmails;

    /** @param array<mixed>|string $erlaubteEmails Liste oder Text (Komma/Leerraum getrennt) */
    public function __construct(
        public readonly string $dbDsn,
        public readonly string $dbUser,
        public readonly string $dbPassword,
        public readonly string $praefix,
        public readonly string $googleClientId,
        public readonly string $googleClientSecret,
        public readonly string $basisUrl,
        array|string $erlaubteEmails,
        public readonly string $deployToken,
        public readonly bool $testmodus,
        /** Nur im Testmodus wirksam (gemockter Token-Endpunkt). */
        public readonly ?string $googleTokenUrlTest = null,
    ) {
        if (preg_match('/^[A-Za-z0-9_]{0,32}$/', $praefix) !== 1) {
            throw new \InvalidArgumentException('tabellen_praefix darf nur Buchstaben, Ziffern und _ enthalten.');
        }
        $this->erlaubteEmails = self::normalisiereListe($erlaubteEmails);
    }

    public static function suchePfad(string $apiVerzeichnis): ?string
    {
        $env = getenv('LERNAPP_CONFIG');
        if (is_string($env) && $env !== '') {
            return $env;
        }
        // Webroot kann beliebig tief unter www/ liegen (z. B. www/lernapp.urinet.ch oder
        // www/urinet.ch/lernapp): aufwärts das erste private/lernapp/config.php suchen.
        $kandidaten = [];
        for ($ordner = dirname($apiVerzeichnis), $i = 0; $i < 6; $ordner = dirname($ordner), $i++) {
            $kandidaten[] = $ordner . '/private/lernapp/config.php';
            if (dirname($ordner) === $ordner) {
                break;
            }
        }
        $home = getenv('HOME');
        if (is_string($home) && $home !== '') {
            $kandidaten[] = rtrim($home, '/') . '/private/lernapp/config.php';
        }
        foreach ($kandidaten as $pfad) {
            if (is_file($pfad)) {
                return $pfad;
            }
        }
        return null;
    }

    public static function ausDatei(string $pfad): self
    {
        if (!is_file($pfad) || !is_readable($pfad)) {
            throw new \RuntimeException('Konfigurationsdatei nicht lesbar: ' . $pfad);
        }
        $werte = require $pfad;
        if (!is_array($werte)) {
            throw new \RuntimeException('Konfigurationsdatei liefert kein Array: ' . $pfad);
        }
        return self::ausArray($werte);
    }

    /** @param array<string, mixed> $w */
    public static function ausArray(array $w): self
    {
        $text = static fn (string $schluessel, string $standard = ''): string =>
            is_scalar($w[$schluessel] ?? null) ? trim((string) $w[$schluessel]) : $standard;

        $emails = $w['erlaubte_emails'] ?? [];
        if (!is_array($emails) && !is_string($emails)) {
            $emails = [];
        }

        return new self(
            dbDsn: $text('db_dsn'),
            dbUser: $text('db_user'),
            // Passwort nicht trimmen
            dbPassword: is_scalar($w['db_password'] ?? null) ? (string) $w['db_password'] : '',
            praefix: $text('tabellen_praefix', 'lernapp_'),
            googleClientId: $text('google_client_id'),
            googleClientSecret: $text('google_client_secret'),
            basisUrl: rtrim($text('basis_url'), '/'),
            erlaubteEmails: $emails,
            deployToken: $text('deploy_token'),
            // Nur ein echtes true schaltet den Testmodus ein.
            testmodus: ($w['testmodus'] ?? false) === true,
            googleTokenUrlTest: isset($w['google_token_url']) && is_string($w['google_token_url']) ? $w['google_token_url'] : null,
        );
    }

    /**
     * Liste aus Array oder Text (Komma, Semikolon, Leerraum getrennt), klein geschrieben, ohne Leereinträge.
     *
     * @param array<mixed>|string $liste
     * @return list<string>
     */
    public static function normalisiereListe(array|string $liste): array
    {
        $eintraege = is_string($liste) ? (preg_split('/[\s,;]+/', $liste) ?: []) : $liste;
        $ergebnis = [];
        foreach ($eintraege as $eintrag) {
            if (!is_string($eintrag)) {
                continue;
            }
            $email = self::normalisiereEmail($eintrag);
            if ($email !== '') {
                $ergebnis[$email] = true;
            }
        }
        return array_keys($ergebnis);
    }

    public static function normalisiereEmail(string $email): string
    {
        return strtolower(trim($email));
    }

    public function istErlaubt(string $email): bool
    {
        $email = self::normalisiereEmail($email);
        return $email !== '' && in_array($email, $this->erlaubteEmails, true);
    }

    /** Tabellenname mit Präfix. */
    public function tabelle(string $name): string
    {
        return $this->praefix . $name;
    }

    public function googleTokenUrl(): string
    {
        if ($this->testmodus && $this->googleTokenUrlTest !== null && $this->googleTokenUrlTest !== '') {
            return $this->googleTokenUrlTest;
        }
        return 'https://oauth2.googleapis.com/token';
    }
}
