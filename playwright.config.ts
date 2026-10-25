import { defineConfig } from '@playwright/test';

import { BASIS_URL, ERLAUBT_VERZEICHNIS, PORT } from './e2e/umgebung';

/**
 * E2E-Tests gegen den Produktions-Build (dist/lernapp/browser) samt PHP-API: «php -S» mit
 * scripts/php-router.php (wie Apache mit deploy/htaccess), Konfiguration e2e/config.e2e.php
 * (Testmodus, Tabellen e2e_* in der MariaDB aus scripts/test-db.sh). e2e/global-setup.ts
 * startet die Datenbank und legt das Schema neu an; jeder Test meldet sich über
 * POST /api/test/anmelden als eigene Person an (e2e/hilfen.ts).
 *
 * Der Service Worker ist in den normalen Projekten blockiert; nur das Projekt «offline»
 * lässt ihn zu.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: BASIS_URL,
    locale: 'de-CH',
    timezoneId: 'Europe/Zurich',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'handy',
      testIgnore: /offline\.spec\.ts/,
      use: {
        browserName: 'chromium',
        viewport: { width: 360, height: 740 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 2,
      },
    },
    {
      name: 'pc',
      testIgnore: /offline\.spec\.ts/,
      use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } },
    },
    {
      // Service Worker erlaubt: App muss nach dem ersten Besuch offline laden.
      name: 'offline',
      testMatch: /offline\.spec\.ts/,
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 800 },
        serviceWorkers: 'allow',
      },
    },
  ],
  webServer: {
    // -q: ohne Zeile pro Anfrage. Mehrere PHP-Prozesse, sonst bedient «php -S» alle
    // Test-Worker nacheinander.
    command: `npx ng build && php -q -d post_max_size=16M -d memory_limit=256M -S 127.0.0.1:${PORT} scripts/php-router.php`,
    url: BASIS_URL,
    env: {
      LERNAPP_CONFIG: 'e2e/config.e2e.php',
      LERNAPP_E2E_ERLAUBT: ERLAUBT_VERZEICHNIS,
      PHP_CLI_SERVER_WORKERS: '8',
    },
    reuseExistingServer: !process.env['CI'],
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
