import { Page } from '@playwright/test';

import {
  FIXTURE_ALLE_TYPEN,
  LEKTION,
  beantworte,
  frageTyp,
  expect,
  fixtureAlleTypen,
  importiereLektion,
  oeffne,
  setzeEinstellung,
  test,
} from './hilfen';

/**
 * Beantwortet alle Fragen der laufenden Prüfung und blättert dabei vorwärts.
 * Mit `auslassen` bleibt die erste Frage dieses Typs unbeantwortet.
 */
async function beantworteAlle(
  page: Page,
  anzahl: number,
  auslassen?: string,
): Promise<Set<string>> {
  const typen = new Set<string>();
  let ausgelassen = false;
  for (let i = 0; i < anzahl; i++) {
    await expect(page.getByText(`Frage ${i + 1} von ${anzahl}`)).toBeVisible();
    const karte = page.getByRole('article');
    const typ = await frageTyp(karte);
    const offen = !ausgelassen && typ === auslassen;
    if (offen) ausgelassen = true;
    else typen.add(await beantworte(karte, 'pruefung'));
    // Fragenübersicht zeigt den Stand
    const knopf = `Frage ${i + 1}, ${offen ? 'offen' : 'beantwortet'}`;
    await expect(
      page
        .getByRole('navigation', { name: 'Fragenübersicht' })
        .getByRole('button', { name: knopf }),
    ).toBeVisible();
    if (i < anzahl - 1) await page.getByRole('button', { name: 'Weiter →' }).click();
  }
  return typen;
}

/** Selbstkorrektur (falls offene Fragen dabei waren) und Auswertung. Liefert die Note als Text. */
async function korrigiereUndWerteAus(
  page: Page,
): Promise<{ note: string; selbstkorrigiert: boolean }> {
  const selbstkorrektur = page.getByRole('heading', { level: 1, name: 'Selbstkorrektur' });
  const auswertung = page.getByRole('heading', { level: 1, name: 'Auswertung' });
  await expect(selbstkorrektur.or(auswertung)).toBeVisible();
  const selbstkorrigiert = await selbstkorrektur.isVisible();
  if (selbstkorrigiert) {
    const anzeigen = page.getByRole('button', { name: 'Auswertung anzeigen' });
    await expect(anzeigen).toBeDisabled();
    for (const karte of await page.getByRole('article').all()) {
      await expect(karte.getByText('Musterlösung')).toBeVisible();
      await karte.getByRole('button', { name: 'Gewusst', exact: true }).click();
    }
    await expect(anzeigen).toBeEnabled();
    await anzeigen.click();
  }
  await expect(auswertung).toBeVisible();
  const ergebnis = page.getByRole('region', { name: 'Ergebnis' });
  await expect(ergebnis).toContainText(/Genügend|Ungenügend/);
  const note = /Note\s*([1-6](?:\.\d+)?)/.exec(await ergebnis.innerText())?.[1];
  expect(note, 'Note 1–6 sichtbar').toBeDefined();
  const zahl = Number(note);
  expect(zahl).toBeGreaterThanOrEqual(1);
  expect(zahl).toBeLessThanOrEqual(6);
  await expect(page.getByRole('heading', { name: 'Punkte pro Lernziel' })).toBeVisible();
  return { note: note!, selbstkorrigiert };
}

test.describe('Probeprüfung', () => {
  test('mit 5 Fragen komplett: antworten, abgeben, Note, Verlauf', async ({ page }) => {
    await setzeEinstellung(page, 'Anzahl Fragen', 5);
    await oeffne(page, `/lektion/${LEKTION.id}`);
    await page
      .getByRole('navigation', { name: 'Lernen' })
      .getByRole('link', { name: /^Probeprüfung/ })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Probeprüfung' })).toBeVisible();
    await expect(page.getByText('5 Fragen', { exact: true })).toBeVisible();
    await expect(page.getByText(/Zeitlimit 30 Minuten/)).toBeVisible();

    await page.getByRole('button', { name: 'Probeprüfung starten' }).click();
    await expect(page.getByRole('timer')).toBeVisible();
    await beantworteAlle(page, 5);
    await expect(page.getByText('5 von 5 Fragen beantwortet')).toBeVisible();
    await page.getByRole('button', { name: 'Abgeben', exact: true }).click();

    const { note } = await korrigiereUndWerteAus(page);

    // Alle Fragen lassen sich in der Auswertung aufklappen
    await expect(page.getByRole('form')).toHaveCount(0);
    await page.getByText('1.', { exact: true }).click();
    await expect(page.getByRole('form')).toBeVisible();

    // Ergebnis im Verlauf der Lektionsübersicht
    await page.getByRole('link', { name: 'Zur Lektion' }).click();
    await expect(page).toHaveURL(`/lektion/${LEKTION.id}`);
    await expect(page.getByRole('heading', { name: 'Probeprüfungen' })).toBeVisible();
    const eintrag = page
      .getByRole('listitem')
      .filter({ hasText: /Punkte/ })
      .filter({ hasText: /Note/ });
    await expect(eintrag).toHaveCount(1);
    await expect(eintrag).toContainText(`/ 5 Punkte`);
    // Verlauf zeigt die auf halbe Noten gerundete Note mit einer Nachkommastelle
    await expect(eintrag).toContainText(`Note ${Number(note).toFixed(1)}`);

    // … und bleibt nach dem Neuladen
    await page.reload();
    await expect(page.getByRole('listitem').filter({ hasText: /Punkte/ })).toHaveCount(1);
  });

  test('alle Fragetypen, unbeantwortete Frage, Selbstkorrektur und Schutz vor Verlassen', async ({
    page,
  }) => {
    await importiereLektion(page, FIXTURE_ALLE_TYPEN, fixtureAlleTypen.titel);
    await setzeEinstellung(page, 'Anzahl Fragen', 8);
    await setzeEinstellung(page, 'Zeit in Minuten', 0);
    await oeffne(page, `/lektion/${fixtureAlleTypen.id}/pruefung`);
    await expect(page.getByText('Ohne Zeitlimit.')).toBeVisible();
    await page.getByRole('button', { name: 'Probeprüfung starten' }).click();
    await expect(page.getByRole('timer')).toHaveCount(0);

    // Verlassen während der Prüfung fragt nach (Dialog wird abgelehnt → bleibt)
    let dialog = '';
    page.once('dialog', (d) => {
      dialog = d.message();
      void d.dismiss();
    });
    await page.getByRole('link', { name: 'Lernapp – zur Startseite' }).click();
    await expect.poll(() => dialog).toContain('Die Probeprüfung läuft noch');
    await expect(page).toHaveURL(`/lektion/${fixtureAlleTypen.id}/pruefung`);

    // Die Zahlenfrage auslassen, alle anderen Typen beantworten
    const typen = await beantworteAlle(page, 8, 'zahl');
    expect([...typen].sort()).toEqual(
      [
        'einfachwahl',
        'mehrfachwahl',
        'kurzantwort',
        'offen',
        'reihenfolge',
        'wahrfalsch',
        'zuordnen',
      ].sort(),
    );

    // Zurückblättern behält die Antwort
    await page.getByRole('button', { name: /^Frage 1, / }).click();
    await expect(page.getByText('Frage 1 von 8')).toBeVisible();

    await page.getByRole('button', { name: 'Abgeben', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toContainText(
      'Eine Frage ist noch nicht beantwortet.',
    );
    await page.getByRole('button', { name: 'Ja, abgeben' }).click();

    // Die offene Frage wird selbst korrigiert
    const { selbstkorrigiert } = await korrigiereUndWerteAus(page);
    expect(selbstkorrigiert).toBe(true);
    await expect(page.getByText('Nicht beantwortet')).toHaveCount(1);

    await page.getByRole('link', { name: 'Zur Lektion' }).click();
    await expect(page.getByRole('heading', { name: 'Probeprüfungen' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: /\/ 8 Punkte/ })).toHaveCount(1);
  });
});
