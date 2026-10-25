<?php

declare(strict_types=1);

/*
 * Einstieg der Lernapp-API. Apache leitet /api/* hierher (deploy/htaccess),
 * lokal scripts/php-router.php («php -S»). Aufbau: lib/router.php.
 */

ini_set('display_errors', '0');

require __DIR__ . '/lib/alle.php';

Lernapp\hauptprogramm(__DIR__);
