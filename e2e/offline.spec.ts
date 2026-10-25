import { Page } from '@playwright/test';

import {
  ANZAHL_FRAGEN,
  LEKTION,
  RUECKMELDUNG,
  beantworte,
  expect,
  meldeAn,
  oeffne,
  test,
} from './hilfen';

/**
 * Läuft nur im Projekt «offline» (Service Worker erlaubt): Nach dem ersten
 * Besuch (mit Anmeldung) hat der Angular-Service-Worker App, Lektionen und Bilder
 * im Cache, die App lädt also auch ohne Netz — und /api/* bleibt beim Server.
 */

/** Wartet, bis der Service Worker die Seite kontrolliert und den Prefetch abgeschlossen hat. */
async function warteAufServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 })
    .toBe(true);
  await expect
    .poll(
      async () => {
        const status = await page.evaluate(async () => (await fetch('ngsw/state')).text());
        return /Driver state: NORMAL/.test(status) && !/Latest manifest hash: none/.test(status);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
}

/** Hinweis im Kopf (Link zu den Einstellungen); ein eigenes Banner gibt es nicht mehr. */
const offlineChip = (page: Page) => page.getByRole('link', { name: 'Offline' });

test('App lädt nach dem ersten Besuch auch offline', async ({ page, context, beobachtung }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Was lernst du heute?' })).toBeVisible();

  // Service Worker aktiv, Prefetch (App, Lektionen, Bilder) abgeschlossen
  await warteAufServiceWorker(page);
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const namen = await caches.keys();
          let anzahl = 0;
          for (const n of namen.filter((x) => x.includes(':assets:lektionen:'))) {
            anzahl += (await (await caches.open(n)).keys()).length;
          }
          return anzahl;
        }),
      { timeout: 30_000, message: 'Lektionen und Bilder im Cache' },
    )
    .toBeGreaterThan(10);

  // Ohne Netz scheitern die API-Aufrufe (der Service Worker antwortet mit 504) — erwartet.
  beobachtung.erlaubt.push(/\/api\//);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Was lernst du heute?' })).toBeVisible();
  await expect(offlineChip(page)).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(LEKTION.titel) }).first()).toBeVisible();
  // Der Chip vergrössert den Kopf nicht (--kopf-hoehe rechnet mit fester Höhe).
  expect((await page.getByRole('banner').boundingBox())?.height).toBe(59);

  // Lazy geladene Bildschirme und Bilder kommen ebenfalls aus dem Cache
  await page.goto(`/lektion/${LEKTION.id}/lernzettel?lz=lz-eva`);
  await expect(
    page.getByRole('heading', { level: 1, name: `Lernzettel – ${LEKTION.titel}` }),
  ).toBeVisible();
  const bild = page
    .getByRole('region', { name: /^EVA-Prinzip/ })
    .getByRole('img')
    .first();
  await bild.scrollIntoViewIfNeeded();
  await expect
    .poll(() => bild.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
    .toBe(true);

  await page.goto(`/lektion/${LEKTION.id}/lernen`);
  await expect(page.getByRole('article')).toBeVisible();

  await context.setOffline(false);
});

test('offline gelernt: Änderung kommt nach dem Wiederverbinden auf den Server', async ({
  page,
  context,
  browser,
  beobachtung,
  konto,
}) => {
  test.setTimeout(90_000);
  await oeffne(page, '/');
  await warteAufServiceWorker(page);

  beobachtung.erlaubt.push(/\/api\//);
  await context.setOffline(true);
  await page.reload();
  await expect(offlineChip(page)).toBeVisible();
  await page.goto(`/lektion/${LEKTION.id}/lernen`);
  const karte = page.getByRole('article');
  await beantworte(karte, 'ueben');
  await expect(karte.getByText(RUECKMELDUNG)).toBeVisible();
  await expect(offlineChip(page)).toBeVisible();

  await context.setOffline(false);
  await expect(offlineChip(page)).toBeHidden({ timeout: 15_000 });
  await oeffne(page, '/einstellungen');
  await expect(page.getByText('Alles synchronisiert', { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  // Ein zweites Gerät derselben Person sieht den Lernstand
  const b = await browser.newContext({ serviceWorkers: 'block' });
  await meldeAn(b, konto!);
  const seiteB = await b.newPage();
  await oeffne(seiteB, `/lektion/${LEKTION.id}`);
  await expect(
    seiteB.getByRole('link', { name: new RegExp(`^Lernen ${ANZAHL_FRAGEN - 1} neu`) }),
  ).toBeVisible();
  await b.close();
});

test('Service Worker lässt /api/auth/* beim Server (keine index.html)', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  await oeffne(page, '/');
  await warteAufServiceWorker(page);

  // Rückruf ohne gültigen Zustand: Der Server leitet auf die Anmeldeseite mit Fehler um
  // (angemeldet geht es von dort gleich weiter zur Startseite). Käme index.html aus dem
  // Cache, wäre das Dokument /api/auth/google/callback selbst.
  const rueckruf = await page.goto('/api/auth/google/callback?code=x&state=gefaelscht');
  expect(rueckruf?.url()).toBe('http://127.0.0.1:4321/anmelden?fehler=abgebrochen');
  expect(rueckruf?.request().redirectedFrom()?.url()).toContain('/api/auth/google/callback');

  // Start: 302 zu Google (hier abgefangen, kein echter Aufruf)
  await context.route('https://accounts.google.com/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<h1>Google (Attrappe)</h1>' }),
  );
  await page.goto('/api/auth/google/start?zurueck=%2Feinstellungen');
  await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\//);
  const ziel = new URL(page.url());
  expect(ziel.searchParams.get('client_id')).toBe('e2e-test.apps.googleusercontent.com');
  expect(ziel.searchParams.get('redirect_uri')).toBe(
    'http://127.0.0.1:4321/api/auth/google/callback',
  );
  expect(ziel.searchParams.get('code_challenge_method')).toBe('S256');
});
