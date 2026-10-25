<?php

/*
 * Vorlage für die Konfiguration der Lernapp-API. Nie echte Werte einchecken!
 *
 * Produktion: Der Deploy erzeugt die Datei aus GitHub-Secrets und lädt sie nach
 * ~/private/lernapp/config.php (ausserhalb des Webroots).
 * Lokal: Kopie als api/config.lokal.php (gitignored), Pfad per Umgebungsvariable:
 *   LERNAPP_CONFIG=api/config.lokal.php php -S localhost:8080 scripts/php-router.php
 */

return [
    // PDO-DSN der MariaDB (Hostpoint: Host nur aus Webprozessen erreichbar)
    'db_dsn' => 'mysql:host=DB-HOST;dbname=DB-NAME;charset=utf8mb4',
    'db_user' => 'DB-BENUTZER',
    'db_password' => 'DB-PASSWORT',
    // Alle Tabellen bekommen dieses Präfix (die Datenbank kann geteilt sein).
    'tabellen_praefix' => 'lernapp_',

    // Google Cloud Console → OAuth-Client «Webanwendung»,
    // Weiterleitungs-URI: <basis_url>/api/auth/google/callback
    'google_client_id' => 'CLIENT-ID.apps.googleusercontent.com',
    'google_client_secret' => 'CLIENT-SECRET',
    'basis_url' => 'https://lernapp.urinet.ch',

    // Nur diese Google-Adressen dürfen sich anmelden (bei jeder Anfrage geprüft,
    // Gross-/Kleinschreibung egal). Auch als Text mit Komma/Zeilenumbruch möglich.
    'erlaubte_emails' => [
        'person@example.com',
    ],

    // Token für POST /api/admin/migrieren (z. B. openssl rand -hex 32). Leer = gesperrt.
    'deploy_token' => '',

    // Nur lokal/E2E: Secure-Cookie auch über http, POST /api/test/anmelden unter «php -S».
    // In Produktion immer false.
    'testmodus' => false,
    // Nur im Testmodus wirksam: anderer Token-Endpunkt (gemockter Google-Login in den Tests).
    // 'google_token_url' => 'http://127.0.0.1:8099/token',
];
