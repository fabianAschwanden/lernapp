import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, oeffne, pruefeKeinHorizontalesScrollen, spieleRunde, test } from './hilfen';

/** Geschichte Prüfung 1: Werte aus der Datei, damit Inhaltsänderungen keine Tests brechen. */
const GE = JSON.parse(
  readFileSync(join(__dirname, '..', 'public', 'lektionen', 'geschichte-pruefung-1.json'), 'utf-8'),
) as {
  id: string;
  titel: string;
  lernziele: { id: string; thema: string; bilder?: unknown[] }[];
  fragen: unknown[];
};
const THEMEN = [...new Set(GE.lernziele.map((l) => l.thema))];
const ANZAHL_BILDER = GE.lernziele.reduce((s, l) => s + (l.bilder?.length ?? 0), 0);
const TITEL = new RegExp(GE.titel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

test.describe('Lektion Geschichte 1', () => {
  test('erscheint auf der Startseite im Fach Geschichte und öffnet sich', async ({ page }) => {
    await oeffne(page, '/');
    await expect(page.getByText('Geschichte', { exact: true }).first()).toBeVisible();
    const karte = page.getByRole('link', { name: TITEL }).filter({ has: page.getByRole('progressbar') });
    await expect(karte.getByText(`${GE.lernziele.length} Lernziele`)).toBeVisible();
    await expect(karte.getByText(`${GE.fragen.length} Fragen`)).toBeVisible();
    await karte.click();
    await expect(page.getByRole('heading', { level: 1, name: GE.titel })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Üben: / })).toHaveCount(GE.lernziele.length);
    await pruefeKeinHorizontalesScrollen(page, 'Lektionsübersicht Geschichte 1');
  });

  test('Lernzettel: alle Lernziele, alle Abbildungen laden', async ({ page, beobachtung }) => {
    await oeffne(page, `/lektion/${GE.id}/lernzettel`);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(THEMEN);
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(GE.lernziele.length);
    const bilder = page.getByRole('figure').getByRole('img');
    await expect(bilder).toHaveCount(ANZAHL_BILDER);
    for (let i = 0; i < ANZAHL_BILDER; i++) {
      const bild = bilder.nth(i);
      await bild.scrollIntoViewIfNeeded();
      await expect
        .poll(() => bild.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0), {
          message: `Bild ${i + 1} geladen`,
        })
        .toBe(true);
    }
    expect(beobachtung.antworten.filter((a) => a.status >= 400)).toEqual([]);
    await pruefeKeinHorizontalesScrollen(page, 'Lernzettel Geschichte 1');
  });

  test('Quellenanalyse üben: eine Runde zum Lernziel «AQUA»', async ({ page }) => {
    await oeffne(page, `/lektion/${GE.id}/lernen?modus=lernziel&lz=lz-aqua`);
    await spieleRunde(page);
    await expect(page.getByRole('heading', { name: 'Runde geschafft!' })).toBeVisible();
  });
});
