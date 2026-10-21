import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, oeffne, pruefeKeinHorizontalesScrollen, spieleRunde, test } from './hilfen';

/** Zweite mitgelieferte Lektion: Werte aus der Datei, damit Inhaltsänderungen keine Tests brechen. */
const BIO = JSON.parse(
  readFileSync(join(__dirname, '..', 'public', 'lektionen', 'biologie-pruefung-1.json'), 'utf-8'),
) as {
  id: string;
  titel: string;
  lernziele: { id: string; thema: string; bilder?: unknown[] }[];
  fragen: unknown[];
};
const THEMEN = [...new Set(BIO.lernziele.map((l) => l.thema))];
const ANZAHL_BILDER = BIO.lernziele.reduce((s, l) => s + (l.bilder?.length ?? 0), 0);

test.describe('Lektion Biologie', () => {
  test('erscheint auf der Startseite im Fach Biologie und öffnet sich', async ({ page }) => {
    await oeffne(page, '/');
    await expect(page.getByText('Biologie', { exact: true }).first()).toBeVisible();
    const karte = page
      .getByRole('link', { name: new RegExp(BIO.titel) })
      .filter({ has: page.getByRole('progressbar') });
    await expect(karte.getByText(`${BIO.lernziele.length} Lernziele`)).toBeVisible();
    await expect(karte.getByText(`${BIO.fragen.length} Fragen`)).toBeVisible();
    await karte.click();
    await expect(page.getByRole('heading', { level: 1, name: BIO.titel })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Üben: / })).toHaveCount(BIO.lernziele.length);
    await pruefeKeinHorizontalesScrollen(page, 'Lektionsübersicht Biologie');
  });

  test('Lernzettel: alle Lernziele, alle Abbildungen laden', async ({ page, beobachtung }) => {
    await oeffne(page, `/lektion/${BIO.id}/lernzettel`);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(THEMEN);
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(BIO.lernziele.length);
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
    await pruefeKeinHorizontalesScrollen(page, 'Lernzettel Biologie');
  });

  test('Beschriften üben: eine Runde zum Lernziel «Abbildung beschriften»', async ({ page }) => {
    await oeffne(page, `/lektion/${BIO.id}/lernen?modus=lernziel&lz=lz-bau-beschriften`);
    await spieleRunde(page);
    await expect(page.getByRole('heading', { name: 'Runde geschafft!' })).toBeVisible();
  });
});
