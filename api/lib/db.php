<?php

declare(strict_types=1);

namespace Lernapp;

use PDO;

/** Verbindung zur MariaDB: Ausnahmen, echte Prepared Statements, utf8mb4, Zeitzone UTC. */
function verbinde(Konfiguration $k): PDO
{
    $pdo = new PDO($k->dbDsn, $k->dbUser, $k->dbPassword, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
        PDO::ATTR_STRINGIFY_FETCHES => false,
        PDO::ATTR_TIMEOUT => 10,
    ]);
    $pdo->exec("SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci, time_zone = '+00:00'");
    return $pdo;
}

/** Jetzt als DATETIME(3)-Text in UTC. */
function jetztDb(): string
{
    return (new \DateTimeImmutable('now', new \DateTimeZone('UTC')))->format('Y-m-d H:i:s.v');
}

/** Zeitpunkt in Sekunden ab jetzt als DATETIME-Text in UTC. */
function inSekundenDb(int $sekunden): string
{
    return gmdate('Y-m-d H:i:s', time() + $sekunden);
}

/**
 * Führt eine Funktion in einer Transaktion aus; bei Ausnahme Rollback. Bei einem Deadlock
 * oder einer Sperr-Zeitüberschreitung (InnoDB-Lücken-Sperren zwischen gleichzeitigen
 * Anfragen verschiedener Personen) wird die ganze Transaktion bis zu dreimal wiederholt —
 * die Arbeit muss deshalb alles, was sie braucht, innerhalb der Transaktion neu lesen.
 */
function inTransaktion(PDO $pdo, callable $arbeit, int $versuche = 4): mixed
{
    for ($versuch = 1; ; $versuch++) {
        $pdo->beginTransaction();
        try {
            $ergebnis = $arbeit();
            $pdo->commit();
            return $ergebnis;
        } catch (\Throwable $t) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            if ($versuch >= $versuche || !istSperrKonflikt($t)) {
                throw $t;
            }
            usleep(random_int(5_000, 30_000) * $versuch);
        }
    }
}

/** Deadlock (1213, SQLSTATE 40001) oder Lock wait timeout (1205): Wiederholen hilft. */
function istSperrKonflikt(\Throwable $t): bool
{
    if (!$t instanceof \PDOException) {
        return false;
    }
    $treiberCode = (int) ($t->errorInfo[1] ?? 0);
    return $t->getCode() === '40001' || in_array($treiberCode, [1205, 1213], true);
}
