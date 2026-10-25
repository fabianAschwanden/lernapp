<?php

declare(strict_types=1);

// Lädt alle Bausteine der API (index.php und Tests).
require __DIR__ . '/antwort.php';
require __DIR__ . '/konfiguration.php';
require __DIR__ . '/db.php';
require __DIR__ . '/sitzung.php';
require __DIR__ . '/google.php';
require __DIR__ . '/sync.php';
require __DIR__ . '/migrationen.php';
require __DIR__ . '/router.php';
