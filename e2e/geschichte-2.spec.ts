import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, oeffne, pruefeKeinHorizontalesScrollen, spieleRunde, test } from './hilfen';

const GESCHICHTE = JSON.parse(
  readFileSync(join(__dirname, '..', 'public', 'lektionen', 'geschichte-pruefung-2.json'), 'utf-8'),
) as {
  id: string;
  titel: string;
  lernziele: { id: string; thema: string; text: string }[];
  fragen: unknown[];
};
const THEMEN = [...new Set(GESCHICHTE.lernziele.map((lz) => lz.thema))];

const titelMuster = new RegExp(GESCHICHTE.titel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

test.describe('Lektion Geschichte: Prüfung 2', () => {
  test('erscheint im Fach Geschichte und öffnet alle Lernziele', async ({ page }) => {
    await oeffne(page, '/');
    await expect(page.getByText('Geschichte', { exact: true }).first()).toBeVisible();
    const karte = page
      .getByRole('link', { name: titelMuster })
      .filter({ has: page.getByRole('progressbar') });
    await expect(karte.getByText(`${GESCHICHTE.lernziele.length} Lernziele`)).toBeVisible();
    await expect(karte.getByText(`${GESCHICHTE.fragen.length} Fragen`)).toBeVisible();
    await karte.click();
    await expect(page.getByRole('heading', { level: 1, name: GESCHICHTE.titel })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Üben: / })).toHaveCount(
      GESCHICHTE.lernziele.length,
    );
    await pruefeKeinHorizontalesScrollen(page, 'Lektionsübersicht Geschichte Prüfung 2');
  });

  test('Lernzettel deckt alle Themen und Lernziele ab', async ({ page }) => {
    await oeffne(page, `/lektion/${GESCHICHTE.id}/lernzettel`);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText(THEMEN);
    for (const lernziel of GESCHICHTE.lernziele) {
      const titel = page.getByRole('heading', { level: 3, name: lernziel.text, exact: true });
      await titel.scrollIntoViewIfNeeded();
      await expect(titel).toBeVisible();
    }
    await expect(page.getByRole('link', { name: /^Dazu üben: / })).toHaveCount(
      GESCHICHTE.lernziele.length,
    );
    await pruefeKeinHorizontalesScrollen(page, 'Lernzettel Geschichte Prüfung 2');
  });

  test('Kurzfassung verknüpft jeden Themenabschnitt mit seinem Lernziel', async ({ page }) => {
    await oeffne(page, `/lektion/${GESCHICHTE.id}/kurzfassung`);
    await expect(
      page.getByRole('heading', { level: 1, name: `Kurzfassung – ${GESCHICHTE.titel}` }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([
      'Zur Prüfung',
      ...THEMEN,
      'Prüfungs-Check',
    ]);
    await expect(page.getByRole('heading', { level: 4 })).toHaveCount(GESCHICHTE.lernziele.length);
    for (const lernziel of GESCHICHTE.lernziele) {
      const abschnitt = page.getByRole('region', { name: lernziel.thema, exact: true });
      await expect(abschnitt.getByText(lernziel.text, { exact: false })).toBeVisible();
      await expect(
        abschnitt.getByRole('link', { name: `Üben: ${lernziel.text}`, exact: true }),
      ).toHaveAttribute(
        'href',
        `/lektion/${GESCHICHTE.id}/lernen?modus=lernziel&lz=${lernziel.id}`,
      );
    }
    await pruefeKeinHorizontalesScrollen(page, 'Kurzfassung Geschichte Prüfung 2');
  });

  test('eine Lernrunde zum markierten Schwerpunkt Humanismus ist spielbar', async ({ page }) => {
    await oeffne(page, `/lektion/${GESCHICHTE.id}/lernen?modus=lernziel&lz=lz-humanismus`);
    await spieleRunde(page);
    await expect(page.getByRole('heading', { name: 'Runde geschafft!' })).toBeVisible();
  });
});
