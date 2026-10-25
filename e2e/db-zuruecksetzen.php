<?php

declare(strict_types=1);

/*
 * Löscht vor einem E2E-Lauf alle Tabellen mit dem Präfix e2e_ in der Test-Datenbank
 * (e2e/global-setup.ts). Das Schema legt danach POST /api/admin/migrieren neu an.
 */

$k = require __DIR__ . '/config.e2e.php';
$pdo = new PDO($k['db_dsn'], $k['db_user'], $k['db_password'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$stmt = $pdo->prepare('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE ?');
$stmt->execute([str_replace('_', '\_', $k['tabellen_praefix']) . '%']);
$tabellen = $stmt->fetchAll(PDO::FETCH_COLUMN);
if ($tabellen !== []) {
    $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
    $pdo->exec('DROP TABLE ' . implode(', ', array_map(static fn ($t) => '`' . $t . '`', $tabellen)));
}
echo 'E2E-Datenbank zurückgesetzt (' . count($tabellen) . " Tabellen gelöscht).\n";
