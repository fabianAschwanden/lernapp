import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Page } from '@playwright/test';

import {
  FIXTURE_ALLE_TYPEN,
  expect,
  fixtureAlleTypen,
  importiereLektion,
  oeffne,
  pruefeKeinHorizontalesScrollen,
  test,
} from './hilfen';

/** Mitgelieferte Lektionen laut index.json (die Kurzfassung wird zur Laufzeit vom Server gelesen). */
const MITGELIEFERT = (
  JSON.parse(readFileSync(join(__dirname, '..', 'public', 'lektionen', 'index.json'), 'utf-8')) as {
    lektionen: string[];
  }
).lektionen.map((datei) => datei.replace(/\.json$/, ''));

/** Anzahl Abschnitte wie auf der Seite: Zeilen mit genau «## Titel». */
function anzahlAbschnitte(kurzfassung: string): number {
  return kurzfassung.split(/\r?\n/).filter((z) => /^##\s+\S/.test(z)).length;
}

/** Titel der Abschnitte (ohne Markdown-Zeichen, wie die Seite sie zeigt). */
function abschnittTitel(kurzfassung: string): string[] {
  return kurzfassung
    .split(/\r?\n/)
    .filter((z) => /^##\s+\S/.test(z))
    .map((z) =>
      z
        .replace(/^##\s+/, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2')
        .replace(/`([^`]+)`/g, '$1')
        .trim(),
    );
}

/** Kurzfassung-Abschnitte: Regionen mit eigener h2 (Tabellen-Regionen haben keine). */
function abschnitte(page: Page) {
  return page.getByRole('region').filter({ has: page.getByRole('heading', { level: 2 }) });
}

/**
 * Öffnet die Kurzfassung aus der Lektionsübersicht und prüft Aufbau,
 * Sprungmarken, Druckbild und horizontales Scrollen.
 */
async function pruefeKurzfassung(page: Page, id: string, titel: string, kurzfassung: string) {
  await oeffne(page, `/lektion/${id}`);
  const link = page.getByRole('link', { name: /^Kurzfassung/ });
  await expect(link).toContainText(/alles Wichtige zum Durchlesen · ca\. \d+ Min\./);
  await link.click();
  await expect(page).toHaveURL(`/lektion/${id}/kurzfassung`);
  await expect(page).toHaveTitle('Kurzfassung');
  await expect(
    page.getByRole('heading', { level: 1, name: `Kurzfassung – ${titel}` }),
  ).toBeVisible();
  await expect(page.getByText(/^ca\. \d+ Min\. Lesezeit$/)).toBeVisible();

  const n = anzahlAbschnitte(kurzfassung);
  expect(n, 'Kurzfassung hat «## »-Abschnitte').toBeGreaterThan(0);
  await expect(abschnitte(page)).toHaveCount(n);
  const titelListe = abschnittTitel(kurzfassung);
  for (const [i, t] of titelListe.entries()) {
    await expect(abschnitte(page).nth(i).getByRole('heading', { level: 2 })).toHaveText(t);
  }
  await pruefeKeinHorizontalesScrollen(page, `/lektion/${id}/kurzfassung`);

  // Sprungmarken: eine pro Abschnitt, die letzte springt zum letzten Abschnitt
  if (n > 1) {
    const sprung = page.getByRole('navigation', { name: 'Abschnitte' }).getByRole('button');
    await expect(sprung).toHaveCount(n);
    await sprung.last().click();
    const ziel = page.getByRole('heading', { level: 2, name: titelListe[n - 1], exact: true });
    await expect(ziel).toBeInViewport();
    await expect(ziel).toBeFocused();
  }

  // Weiterlernen unten
  const weiter = page.getByRole('navigation', { name: 'Weiterlernen' });
  await expect(weiter.getByRole('link', { name: 'Lernzettel (ausführlich)' })).toBeVisible();
  await expect(weiter.getByRole('link', { name: 'Jetzt üben' })).toBeVisible();
  await expect(weiter.getByRole('link', { name: 'Probeprüfung' })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await pruefeKeinHorizontalesScrollen(page, `/lektion/${id}/kurzfassung (unten)`);

  // Druckbild: keine Knöpfe und Sprungmarken, Abschnitte bleiben
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Drucken' })).toBeHidden();
  await expect(weiter).toBeHidden();
  await expect(abschnitte(page).first()).toBeVisible();
  await page.emulateMedia({ media: 'screen' });

  // Lernzettel verweist zurück auf die Kurzfassung
  await weiter.getByRole('link', { name: 'Lernzettel (ausführlich)' }).click();
  await expect(page).toHaveURL(`/lektion/${id}/lernzettel`);
  await page.getByRole('link', { name: 'Zur Kurzfassung' }).click();
  await expect(page).toHaveURL(`/lektion/${id}/kurzfassung`);
}

/** Lektion ohne Kurzfassung: Meldung mit Links statt Abschnitten, kein Eintrag in der Übersicht. */
async function pruefeOhneKurzfassung(page: Page, id: string) {
  await oeffne(page, `/lektion/${id}`);
  await expect(page.getByRole('link', { name: /^Kurzfassung/ })).toHaveCount(0);
  await oeffne(page, `/lektion/${id}/kurzfassung`);
  await expect(
    page.getByRole('heading', { level: 2, name: 'Noch keine Kurzfassung' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: 'Zum Lernzettel' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Kurzfassung schreiben' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Drucken' })).toHaveCount(0);
  await pruefeKeinHorizontalesScrollen(page, `/lektion/${id}/kurzfassung (ohne)`);
  await oeffne(page, `/lektion/${id}/lernzettel`);
  await expect(page.getByRole('link', { name: 'Zur Kurzfassung' })).toHaveCount(0);
}

/** In zehn Tagen (JJJJ-MM-TT) in der Zeitzone des Browsers (playwright.config: Europe/Zurich). */
function inZehnTagen(): string {
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' });
  const d = new Date(`${heute}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 10);
  return d.toISOString().slice(0, 10);
}

const FIXTURE_KURZFASSUNG = [
  'Alles Wichtige für die Prüfung auf einen Blick.',
  '',
  '## EVA-Prinzip',
  'Jeder Computer arbeitet nach **Eingabe – Verarbeitung – Ausgabe**. Ein sehr langes Wort wie Datenverarbeitungsgeräteeingabeschnittstellenbeschreibung darf die Seite nicht verbreitern.',
  '',
  '> **Merke:**',
  '> - Eingabe: Tastatur, Maus',
  '> - Ausgabe: Bildschirm, Drucker',
  '',
  '## Speichereinheiten',
  '| Einheit | Bytes | Beispiel | Bemerkung | Noch eine Spalte |',
  '|---|---|---|---|---|',
  '| KB | 1000 | kleine Textdatei | Dezimalpräfix | breit breit breit breit |',
  '| KiB | 1024 | Speicherseite | Binärpräfix | breit breit breit breit |',
  '',
  '### Umrechnen',
  '1 Byte = 8 Bit, 2^10 = 1024.',
  '',
  '## Prüfungs-Check',
  '- KB und KiB nicht verwechseln.',
  '- Der Drucker ist ein Ausgabegerät.',
].join('\n');

test.describe('Kurzfassung', () => {
  for (const id of MITGELIEFERT) {
    test(`${id}: Kurzfassung aus der Übersicht oder Meldung`, async ({ page }) => {
      // Inhalt vom Server lesen: so stimmt der Test mit dem ausgelieferten Build überein
      const antwort = await page.request.get(`/lektionen/${id}.json`);
      expect(antwort.ok()).toBe(true);
      const lektion = (await antwort.json()) as { titel: string; kurzfassung?: string };
      if (lektion.kurzfassung?.trim()) {
        await pruefeKurzfassung(page, id, lektion.titel, lektion.kurzfassung);
      } else {
        await pruefeOhneKurzfassung(page, id);
      }
    });
  }

  test('importierte Lektion mit Kurzfassung: Abschnitte, Merke-Kasten, Countdown', async ({
    page,
  }, info) => {
    const datei = info.outputPath('mit-kurzfassung.json');
    const titel = 'Lektion mit Kurzfassung';
    writeFileSync(
      datei,
      JSON.stringify({
        ...fixtureAlleTypen,
        id: 'e2e-mit-kurzfassung',
        titel,
        pruefungsdatum: inZehnTagen(),
        kurzfassung: FIXTURE_KURZFASSUNG,
      }),
    );
    await importiereLektion(page, datei, titel);
    await pruefeKurzfassung(page, 'e2e-mit-kurzfassung', titel, FIXTURE_KURZFASSUNG);

    // Kopf: Fach, Countdown, Hinweise zur Prüfung; Einleitung vor dem ersten Abschnitt
    await expect(page.getByText('Prüfung in 10 Tagen', { exact: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Zur Prüfung' })).toContainText(
      'Kein Taschenrechner erlaubt',
    );
    await expect(page.getByText('Alles Wichtige für die Prüfung auf einen Blick.')).toBeVisible();
    // Merke-Kasten mit Liste, Tabelle scrollt in sich statt die Seite zu verbreitern
    const eva = page.getByRole('region', { name: 'EVA-Prinzip', exact: true });
    await expect(eva.getByRole('blockquote')).toContainText('Merke:');
    await expect(eva.getByRole('blockquote').getByRole('listitem')).toHaveCount(2);
    await expect(
      page.getByRole('region', { name: 'Speichereinheiten', exact: true }).getByRole('table'),
    ).toBeVisible();
    await pruefeKeinHorizontalesScrollen(page, 'Kurzfassung mit Tabelle');
  });

  test('Lektion ohne Kurzfassung zeigt die Meldung', async ({ page }) => {
    await importiereLektion(page, FIXTURE_ALLE_TYPEN, fixtureAlleTypen.titel);
    await pruefeOhneKurzfassung(page, fixtureAlleTypen.id);
  });

  test('Kurzfassung im Editor schreiben, Vorschau, speichern und wieder entfernen', async ({
    page,
  }) => {
    await importiereLektion(page, FIXTURE_ALLE_TYPEN, fixtureAlleTypen.titel);
    const id = fixtureAlleTypen.id;
    await oeffne(page, `/lektion/${id}/kurzfassung`);
    await page.getByRole('link', { name: 'Kurzfassung schreiben' }).click();
    await expect(page).toHaveURL(`/lektion/${id}/bearbeiten`);

    const feld = page.getByRole('textbox', { name: 'Kurzfassung' });
    await feld.fill('## Erstes\nText eins\n\n> Wichtig\n\n## Zweites\nText zwei');
    await page.getByRole('button', { name: 'Vorschau zeigen' }).click();
    await expect(page.getByRole('blockquote')).toHaveText('Wichtig');
    await pruefeKeinHorizontalesScrollen(page, 'Editor mit Kurzfassung');
    const speichern = page.getByRole('region', { name: 'Speichern' }).getByRole('button', {
      name: 'Speichern',
    });
    await speichern.click();
    await expect(page.getByText('Gespeichert.', { exact: true })).toBeVisible();

    await oeffne(page, `/lektion/${id}/kurzfassung`);
    await expect(abschnitte(page)).toHaveCount(2);

    // Leeren entfernt die Kurzfassung wieder
    await oeffne(page, `/lektion/${id}/bearbeiten`);
    await page.getByRole('textbox', { name: 'Kurzfassung' }).fill('');
    await speichern.click();
    await expect(page.getByText('Gespeichert.', { exact: true })).toBeVisible();
    await oeffne(page, `/lektion/${id}/kurzfassung`);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Noch keine Kurzfassung' }),
    ).toBeVisible();
  });

  test('unbekannte Lektion zeigt eine Meldung', async ({ page }) => {
    await oeffne(page, '/lektion/gibt-es-nicht/kurzfassung');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Kurzfassung nicht gefunden' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Zur Startseite', exact: true }).click();
    await expect(page).toHaveURL('/');
  });
});
