import { defineConfig } from '@playwright/test';

/**
 * E2E-Tests gegen den Produktions-Build (dist/lernapp/browser), ausgeliefert
 * von scripts/statisch-servieren.mjs. Der Service Worker ist in den normalen
 * Projekten blockiert; nur das Projekt «offline» lässt ihn zu.
 */
const PORT = 4321;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
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
    command: `npx ng build && node scripts/statisch-servieren.mjs dist/lernapp/browser ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env['CI'],
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
