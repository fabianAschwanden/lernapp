<?php

/*
 * Konfiguration der API für die E2E-Tests (playwright.config.ts setzt LERNAPP_CONFIG auf diese
 * Datei). Enthält keine Geheimnisse: Test-Datenbank aus scripts/test-db.sh, eigenes Präfix e2e_,
 * Testmodus an (POST /api/test/anmelden, nur unter «php -S»).
 *
 * Freigegebene Adressen: Jede Testperson ist eine Datei <adresse> im Verzeichnis
 * LERNAPP_E2E_ERLAUBT (legt e2e/hilfen.ts an). Die Datei wird bei jeder Anfrage neu gelesen,
 * so bekommt jeder Test eine eigene Person, und ein Test kann die Freigabe wieder entziehen.
 */

$erlaubt = [];
$verzeichnis = getenv('LERNAPP_E2E_ERLAUBT') ?: '';
if ($verzeichnis !== '' && is_dir($verzeichnis)) {
    foreach (scandir($verzeichnis) ?: [] as $datei) {
        if (preg_match('/^[a-z0-9._-]+@example\.com$/', $datei) === 1) {
            $erlaubt[] = $datei;
        }
    }
}

return [
    'db_dsn' => getenv('LERNAPP_TEST_DB_DSN') ?: 'mysql:host=127.0.0.1;port=3307;dbname=lernapp_test;charset=utf8mb4',
    'db_user' => getenv('LERNAPP_TEST_DB_USER') ?: 'lernapp',
    'db_password' => getenv('LERNAPP_TEST_DB_PASSWORD') ?: 'lernapp',
    'tabellen_praefix' => 'e2e_',
    'google_client_id' => 'e2e-test.apps.googleusercontent.com',
    'google_client_secret' => 'e2e-kein-geheimnis',
    'basis_url' => 'http://127.0.0.1:4321',
    'erlaubte_emails' => $erlaubt,
    // Gleicher Wert wie DEPLOY_TOKEN in e2e/global-setup.ts (nur lokal, kein Geheimnis)
    'deploy_token' => 'e2e-deploy-token-nur-fuer-lokale-tests',
    'testmodus' => true,
];
