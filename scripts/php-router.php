<?php

declare(strict_types=1);

/*
 * Router für den eingebauten PHP-Server — lokal und für die E2E-Tests dasselbe Verhalten
 * wie Apache mit deploy/htaccess:
 *   /api, /api/*            → api/index.php
 *   vorhandene Datei        → ausliefern (aus dist/lernapp/browser bzw. LERNAPP_WEBROOT)
 *   Pfad mit Dateiendung    → 404
 *   sonst                   → index.html (SPA-Fallback)
 *
 *   npx ng build
 *   LERNAPP_CONFIG=api/config.lokal.php php -S localhost:8080 scripts/php-router.php
 */

$pfad = rawurldecode((string) (parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?? '/'));

if ($pfad === '/api' || str_starts_with($pfad, '/api/')) {
    require dirname(__DIR__) . '/api/index.php';
    return true;
}

$webroot = getenv('LERNAPP_WEBROOT') ?: dirname(__DIR__) . '/dist/lernapp/browser';
$wurzel = realpath($webroot);
if ($wurzel === false) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Kein Build gefunden: $webroot (zuerst «npx ng build»).\n";
    return true;
}

$typen = [
    'html' => 'text/html; charset=utf-8',
    'js' => 'text/javascript; charset=utf-8',
    'mjs' => 'text/javascript; charset=utf-8',
    'css' => 'text/css; charset=utf-8',
    'json' => 'application/json; charset=utf-8',
    'webmanifest' => 'application/manifest+json; charset=utf-8',
    'svg' => 'image/svg+xml',
    'png' => 'image/png',
    'jpg' => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'webp' => 'image/webp',
    'gif' => 'image/gif',
    'ico' => 'image/x-icon',
    'woff2' => 'font/woff2',
    'woff' => 'font/woff',
    'txt' => 'text/plain; charset=utf-8',
    'map' => 'application/json; charset=utf-8',
    'wasm' => 'application/wasm',
    'pdf' => 'application/pdf',
];

$ausliefern = static function (string $datei, int $status = 200) use ($typen): bool {
    $endung = strtolower(pathinfo($datei, PATHINFO_EXTENSION));
    http_response_code($status);
    header('Content-Type: ' . ($typen[$endung] ?? 'application/octet-stream'));
    header('Content-Length: ' . (string) filesize($datei));
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: no-cache');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') {
        readfile($datei);
    }
    return true;
};

$kandidat = realpath($wurzel . $pfad);
$innerhalb = $kandidat !== false && ($kandidat === $wurzel || str_starts_with($kandidat, $wurzel . DIRECTORY_SEPARATOR));
// Punktdateien nie ausliefern (wie auf Apache).
$punktdatei = preg_match('#/\.#', $pfad) === 1;

if ($innerhalb && !$punktdatei && is_file($kandidat)) {
    return $ausliefern($kandidat);
}
if ($innerhalb && is_dir($kandidat) && is_file($kandidat . '/index.html')) {
    return $ausliefern($kandidat . '/index.html');
}
if ($punktdatei || pathinfo($pfad, PATHINFO_EXTENSION) !== '') {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo "Nicht gefunden\n";
    return true;
}
return $ausliefern($wurzel . '/index.html');
