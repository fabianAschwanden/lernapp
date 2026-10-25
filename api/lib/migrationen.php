<?php

declare(strict_types=1);

namespace Lernapp;

use PDO;

/**
 * Führt api/migrationen/NNN-*.sql der Reihe nach aus, jede höchstens einmal
 * (Buch in <praefix>schema). Mehrfaches Aufrufen ist unschädlich; ein Sperrname
 * pro Präfix verhindert parallele Läufe.
 */
final class Migrationen
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly Konfiguration $k,
        private readonly string $verzeichnis,
    ) {
    }

    /** @return array<int, string> Nummer => Pfad, aufsteigend */
    public function dateien(): array
    {
        $dateien = [];
        foreach (glob($this->verzeichnis . '/*.sql') ?: [] as $pfad) {
            if (preg_match('/^(\d{3})-[a-z0-9-]+\.sql$/', basename($pfad), $m) === 1) {
                $dateien[(int) $m[1]] = $pfad;
            }
        }
        ksort($dateien);
        return $dateien;
    }

    /** Höchste Nummer unter den Migrationsdateien. */
    public function erwarteteVersion(): int
    {
        $dateien = $this->dateien();
        return $dateien === [] ? 0 : (int) array_key_last($dateien);
    }

    /** Aktuell angewendete Schema-Version (0, wenn noch nichts migriert ist). */
    public function aktuelleVersion(): int
    {
        $tabelle = $this->k->tabelle('schema');
        $vorhanden = $this->pdo->prepare('SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?');
        $vorhanden->execute([$tabelle]);
        if ((int) $vorhanden->fetchColumn() === 0) {
            return 0;
        }
        return (int) $this->pdo->query("SELECT COALESCE(MAX(version), 0) FROM `$tabelle`")->fetchColumn();
    }

    /** @return int Schema-Version nach dem Lauf */
    public function ausfuehren(): int
    {
        $sperre = $this->k->praefix . 'migration';
        $stmt = $this->pdo->prepare('SELECT GET_LOCK(?, 30)');
        $stmt->execute([$sperre]);
        if ((int) $stmt->fetchColumn() !== 1) {
            throw new \RuntimeException('Migrationssperre nicht erhalten.');
        }
        try {
            $tabelle = $this->k->tabelle('schema');
            $this->pdo->exec("CREATE TABLE IF NOT EXISTS `$tabelle` (
                version INT UNSIGNED NOT NULL,
                angewendet_am DATETIME NOT NULL,
                PRIMARY KEY (version)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");

            $aktuell = $this->aktuelleVersion();
            foreach ($this->dateien() as $nummer => $pfad) {
                if ($nummer <= $aktuell) {
                    continue;
                }
                foreach (self::anweisungen((string) file_get_contents($pfad), $this->k->praefix) as $sql) {
                    $this->pdo->exec($sql);
                }
                $eintrag = $this->pdo->prepare("INSERT INTO `$tabelle` (version, angewendet_am) VALUES (?, ?)");
                $eintrag->execute([$nummer, gmdate('Y-m-d H:i:s')]);
                $aktuell = $nummer;
            }
            return $aktuell;
        } finally {
            $this->pdo->prepare('SELECT RELEASE_LOCK(?)')->execute([$sperre]);
        }
    }

    /**
     * Zerlegt eine Migrationsdatei in Anweisungen: Kommentarzeilen («-- …») weg,
     * {{praefix}} ersetzen, an «;» am Zeilenende trennen.
     *
     * @return list<string>
     */
    public static function anweisungen(string $sql, string $praefix): array
    {
        $zeilen = array_filter(
            preg_split('/\R/', $sql) ?: [],
            static fn (string $z): bool => !str_starts_with(ltrim($z), '--'),
        );
        $text = str_replace('{{praefix}}', $praefix, implode("\n", $zeilen));
        $teile = preg_split('/;\s*(?:\n|$)/', $text) ?: [];
        return array_values(array_filter(array_map('trim', $teile), static fn (string $t): bool => $t !== ''));
    }
}
