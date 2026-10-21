import { LEKTION, expect, test } from './hilfen';

/**
 * Läuft nur im Projekt «offline» (Service Worker erlaubt): Nach dem ersten
 * Besuch hat der Angular-Service-Worker App, Lektionen und Bilder im Cache,
 * die App lädt also auch ohne Netz.
 */
test('App lädt nach dem ersten Besuch auch offline', async ({ page, context }) => {
  test.setTimeout(90_000);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Was lernst du heute?' })).toBeVisible();

  // Warten, bis der Service Worker aktiv ist und die Seite kontrolliert
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 })
    .toBe(true);

  // … und den Prefetch (App, Lektionen, Bilder) abgeschlossen hat
  await expect
    .poll(
      async () => {
        const status = await page.evaluate(async () => (await fetch('ngsw/state')).text());
        return /Driver state: NORMAL/.test(status) && !/Latest manifest hash: none/.test(status);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
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

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Was lernst du heute?' })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(LEKTION.titel) }).first()).toBeVisible();

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
