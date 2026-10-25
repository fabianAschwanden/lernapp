<?php

declare(strict_types=1);

/*
 * Testläufer für die PHP-API (ohne Composer/PHPUnit).
 *
 *   scripts/test-db.sh            # MariaDB 10.11 in Docker auf Port 3307
 *   php api/tests/laufen.php      # alle Tests
 *   php api/tests/laufen.php sync # nur Tests, deren Name «sync» enthält
 *
 * Datenbank über LERNAPP_TEST_DB_DSN / LERNAPP_TEST_DB_USER / LERNAPP_TEST_DB_PASSWORD
 * (Standard: der Container aus scripts/test-db.sh). Die Tests nutzen das Tabellenpräfix
 * «phptest_» und legen das Schema vor jedem Test neu an.
 */

error_reporting(E_ALL);
ini_set('display_errors', '1');
// Erwartete error_log-Meldungen der API ausblenden (LERNAPP_TEST_LOG=1 zeigt sie).
if (getenv('LERNAPP_TEST_LOG') === false) {
    ini_set('error_log', PHP_OS_FAMILY === 'Windows' ? 'NUL' : '/dev/null');
}

require __DIR__ . '/hilfen.php';

$filter = $argv[1] ?? '';
foreach (glob(__DIR__ . '/*-test.php') ?: [] as $datei) {
    require $datei;
}

exit(Testlauf::alle($filter));
