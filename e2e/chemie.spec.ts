import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, oeffne, pruefeKeinHorizontalesScrollen, spieleRunde, test } from './hilfen';

/** Werte aus der Datei, damit Inhaltsänderungen keine Tests brechen. */
const CHEMIE = JSON.parse(
  readFileSync(join(__dirname, '..', 'public', 'lektionen', 'chemie-pruefung-1.json'), 'utf-8'),
) as {
  id: string;
  titel: string;
  lernziele: { id: string; thema: string; text: string; bilder?: unknown[] }[];
  fragen: unknown[];
};
const THEMEN = [...new Set(CHEMIE.lernziele.map((lz) => lz.thema))];
const ANZAHL_BILDER = CHEMIE.lernziele.reduce((s, lz) => s + (lz.bilder?.length ?? 0), 0);
const titelMuster = new RegExp(CHEMIE.titel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

test.describe('Lektion Chemie: Prüfung 1', () => {
  test('erscheint im Fach Chemie und öffnet alle Lernziele', async ({ page }) => {
    await oeffne(page, '/');
    await expect(page.getByText('Chemie', { exact: true }).first()).toBeVisible();
    const karte = page
      .getByRole('link', { name: titelMuster })
      .filter({ has: page.getByRole('progressbar') });
    await expect(karte.getByText(`${CHEMIE.lernziele.length} Lernziele`)).toBeVisible();
    await expect(karte.getByText(`${CHEMIE.fragen.length} Fragen`)).toBeVisible();
    await karte.click();
    await expect(page.getByRole('heading', { level: 1, name: CHEMIE.titel })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Üben: / })).toHaveCount(CHEMIE.lernziele.length);
    await pruefeKeinHorizontalesScrollen(page, 'Lektionsübersicht Chemie');
  });

  test('Lernzettel: alle Themen, alle Abbildungen laden', async ({ page, beobachtung }) => {
    await oeffne(page, `/lektion/${CHEMIE.id}/lernzettel`);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(THEMEN);
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(CHEMIE.lernziele.length);
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
    await pruefeKeinHorizontalesScrollen(page, 'Lernzettel Chemie');
  });

  test('Kurzfassung hat einen Abschnitt pro Thema', async ({ page }) => {
    await oeffne(page, `/lektion/${CHEMIE.id}/kurzfassung`);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'Zur Prüfung',
      ...THEMEN,
      'Prüfungs-Check',
    ]);
    await pruefeKeinHorizontalesScrollen(page, 'Kurzfassung Chemie');
  });

  test('eine Lernrunde zur typischen Prüfungsaufgabe ist spielbar', async ({ page }) => {
    await oeffne(page, `/lektion/${CHEMIE.id}/lernen?modus=lernziel&lz=lz-schmelz-siedetemperatur`);
    await spieleRunde(page);
    await expect(page.getByRole('heading', { name: 'Runde geschafft!' })).toBeVisible();
  });
});
