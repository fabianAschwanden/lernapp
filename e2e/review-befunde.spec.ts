import { writeFileSync } from 'node:fs';

import { Locator, Page } from '@playwright/test';

import {
  FIXTURE_ALLE_TYPEN,
  LEKTION,
  beantworte,
  expect,
  fixtureAlleTypen,
  frageTyp,
  importiereLektion,
  naechsteFrage,
  oeffne,
  test,
} from './hilfen';

/**
 * Regressionstests zu Befunden aus dem Review: verdeckte Knöpfe, Fokus,
 * Rückmeldung bei Mehrfachwahl, Nachfrage beim Verlassen, robuste
 * Backup-Importe und PDF-Verarbeitung unter der Content-Security-Policy.
 */

/** Liegt das Element ganz im Fenster und wird es von nichts verdeckt (Kopf, untere Navigation)? */
function frei(l: Locator): Promise<boolean> {
  return l.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight || r.height === 0) return false;
    // Mitte und Ränder (nicht die Ecken: runde Ecken zählen beim Hit-Test nicht zum Element)
    const mx = (r.left + r.right) / 2;
    const my = (r.top + r.bottom) / 2;
    const punkte = [
      [mx, my],
      [mx, r.top + 2],
      [mx, r.bottom - 2],
      [r.left + Math.min(10, r.width / 4), my],
      [r.right - Math.min(10, r.width / 4), my],
    ] as const;
    return punkte.every(([x, y]) => el.contains(document.elementFromPoint(x, y)));
  });
}

/** Der sichtbare Link «Lektionen» der Hauptnavigation (oben auf dem PC, unten auf dem Handy). */
function lektionenLink(page: Page): Locator {
  return page.getByRole('link', { name: 'Lektionen', exact: true }).filter({ visible: true });
}

test.describe('Sichtbarkeit unter Kopf und Navigation', () => {
  test('«Weiter →» ist nach dem Prüfen sichtbar und nicht verdeckt', async ({ page }) => {
    await oeffne(page, `/lektion/${LEKTION.id}/lernen`);
    // Definierter Startfokus auf der Position
    await expect(page.getByText(/^Frage 1 von \d+/)).toBeFocused();
    for (let i = 0; i < 8; i++) {
      await beantworte(page.getByRole('article'), 'ueben');
      const weiter = page.getByRole('button', { name: 'Weiter →' });
      await expect(weiter).toBeFocused();
      await expect.poll(() => frei(weiter), { message: `Weiter frei (Frage ${i + 1})` }).toBe(true);
      await naechsteFrage(page);
    }
  });

  test('Probeprüfung: Position und Restzeit bleiben sichtbar; Nummern sind eine Tab-Station', async ({
    page,
  }) => {
    await oeffne(page, `/lektion/${LEKTION.id}/pruefung`);
    await page.getByRole('button', { name: 'Probeprüfung starten' }).click();
    const position = page.getByText(/^Frage \d+ von \d+$/);
    const timer = page.getByRole('timer');
    for (let i = 0; i < 3; i++) {
      await expect(position).toHaveText(new RegExp(`^Frage ${i + 1} von \\d+$`));
      await expect.poll(() => frei(position)).toBe(true);
      await expect.poll(() => frei(timer)).toBe(true);
      // Ganz nach unten scrollen: der Prüfungskopf bleibt sichtbar
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect.poll(() => frei(timer)).toBe(true);
      await page.getByRole('button', { name: 'Weiter →' }).click();
    }

    // Tab von der Position: nur die aktuelle Nummer, Pfeiltasten wechseln, nächster Tab verlässt die Leiste
    await expect(position).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Frage 4, offen' })).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('button', { name: 'Frage 5, offen' })).toBeFocused();
    await page.keyboard.press('Tab');
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest('nav[aria-label^="Fragenübersicht"]'),
      ),
    ).toBe(false);
  });
});

test('Mehrfachwahl: verpasste richtige Option ist als «fehlte» markiert', async ({ page }) => {
  await importiereLektion(page, FIXTURE_ALLE_TYPEN, fixtureAlleTypen.titel);
  await page.goto(`/lektion/${fixtureAlleTypen.id}/lernen?modus=lernziel&lz=lz-grundlagen`);
  for (let i = 0; i < 5; i++) {
    const karte = page.getByRole('article');
    if ((await frageTyp(karte)) !== 'mehrfachwahl') {
      await beantworte(karte, 'ueben');
      await naechsteFrage(page);
      continue;
    }
    // Nur eine der beiden richtigen Optionen wählen
    await karte.getByRole('button', { name: /^Tastatur/ }).click();
    await karte.getByRole('button', { name: 'Prüfen' }).click();
    await expect(karte.getByText(/Teilweise richtig/)).toBeVisible();
    await expect(karte.getByRole('button', { name: 'Tastatur (richtig gewählt)' })).toBeVisible();
    const maus = karte.getByRole('button', { name: 'Maus (richtig, nicht gewählt)' });
    await expect(maus).toContainText('fehlte');
    await expect(maus).toContainText('✓');
    return;
  }
  throw new Error('Mehrfachwahl-Frage kam nicht vor');
});

test('Neue Lektion: Fokus nach der Wahl; Verlassen mit Material fragt nach', async ({ page }) => {
  await oeffne(page, '/neu');
  await page.getByRole('button', { name: /Aus Material erstellen/ }).click();
  await expect(page.getByRole('heading', { name: '1. Grunddaten' })).toBeFocused();
  await page.getByRole('combobox', { name: 'Fach *' }).fill('Informatik');
  await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  await page.getByText('Text einfügen', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Etwas Stoff zum Lernen.');
  await page.getByRole('button', { name: 'Text hinzufügen' }).click();

  // Abbrechen → bleibt auf der Seite, Material ist noch da
  let meldung = '';
  page.once('dialog', (d) => {
    meldung = d.message();
    void d.dismiss();
  });
  await lektionenLink(page).click();
  await expect.poll(() => meldung).toContain('Material');
  await expect(page).toHaveURL('/neu');
  await expect(page.getByText('Etwas Stoff zum Lernen.')).toBeVisible();

  // Bestätigen → verlässt die Seite
  page.once('dialog', (d) => void d.accept());
  await lektionenLink(page).click();
  await expect(page).toHaveURL('/');
});

test('Neue Lektion: PDF wird gelesen und als Vorschau gezeigt (pdf.js-Worker unter CSP)', async ({
  page,
}) => {
  await oeffne(page, '/neu');
  await page.getByRole('button', { name: /Aus Material erstellen/ }).click();
  await page.getByRole('combobox', { name: 'Fach *' }).fill('Informatik');
  await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'PDF hinzufügen' }).click();
  await (
    await chooser
  ).setFiles({
    name: 'skript.pdf',
    mimeType: 'application/pdf',
    buffer: minimalesPdf(),
  });
  await expect(page.getByText(/^1 Seiten/)).toBeVisible();
  const seite = page.getByRole('button', { name: 'Seite 1' });
  await expect(seite.locator('img')).toBeVisible();
  await seite.click();
  await expect(seite).toHaveAttribute('aria-pressed', 'true');
});

test('Backup mit unvollständiger Lektion, ungültigem Lernstand und Note 3.75', async ({
  page,
}, info) => {
  const lektion = {
    id: 'mini',
    fach: 'Testfach',
    titel: 'Mini ohne Quellen',
    lernziele: [{ id: 'lz-a', thema: 'A', text: 'Ziel A', zusammenfassung: 'Text' }],
    fragen: [
      {
        id: 'f-1',
        lernzielId: 'lz-a',
        typ: 'wahrfalsch',
        frage: 'Stimmt das?',
        richtig: true,
        erklaerung: 'Darum.',
        schwierigkeit: 1,
      },
    ],
  };
  const pfad = info.outputPath('backup-mini.json');
  writeFileSync(
    pfad,
    JSON.stringify({
      app: 'lernapp',
      format: 1,
      erstelltAm: '2026-10-01T10:00:00.000Z',
      lektionen: [lektion],
      // Fach 9 gibt es nicht — würde beim nächsten Verbuchen einen Fehler auslösen
      fortschritt: [
        {
          schluessel: 'mini::f-1',
          lektionId: 'mini',
          frageId: 'f-1',
          fach: 9,
          richtig: 1,
          falsch: 0,
          verlauf: ['richtig'],
        },
      ],
      pruefungen: [
        {
          id: 'p1',
          lektionId: 'mini',
          am: '2026-10-01T10:00:00.000Z',
          punkte: 11,
          maxPunkte: 20,
          note: 3.75,
          dauerSekunden: 300,
          proLernziel: {},
        },
      ],
      einstellungen: {},
    }),
  );

  await oeffne(page, '/einstellungen');
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('Backup importieren', { exact: true }).click();
  await (await chooser).setFiles(pfad);
  await expect(page.getByText('Backup importiert.')).toBeVisible();

  await oeffne(page, '/lektion/mini');
  await expect(page.getByRole('heading', { level: 1, name: 'Mini ohne Quellen' })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Lernen/ })).toBeVisible();
  // Angezeigte Note 4.0 ist genügend (gleiche Grundlage für Anzeige und Bewertung)
  const note = page.getByText('Note 4.0', { exact: true });
  await expect(note).toBeVisible();
  await expect(note).toHaveClass(/\bgut\b/);

  // Lernen verbucht ohne Fehler (beobachtung meldet Konsolenfehler automatisch)
  await page.getByRole('link', { name: /^Lernen/ }).click();
  await beantworte(page.getByRole('article'), 'ueben');
  await expect(page.getByText('Richtig!')).toBeVisible();
});

test('Lernzettel: breite Tabellen sind benannte, fokussierbare Bereiche', async ({ page }) => {
  await oeffne(page, `/lektion/${LEKTION.id}/lernzettel`);
  const tabellen = page.getByRole('region', { name: /^Tabelle/ });
  expect(await tabellen.count()).toBeGreaterThan(0);
  await expect(tabellen.first()).toHaveAttribute('tabindex', '0');
  // Keine leeren Spaltenüberschriften
  expect(
    await page
      .locator('.md th')
      .evaluateAll((ths) => ths.filter((th) => !th.textContent?.trim()).length),
  ).toBe(0);
});

/** Kleinstes gültiges PDF mit einer Seite (ein grünes Rechteck, ohne Schrift). */
function minimalesPdf(): Buffer {
  const inhalt = '0 0.5 0.3 rg 40 40 220 120 re f';
  const objekte = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << >> >>',
    `<< /Length ${inhalt.length} >>\nstream\n${inhalt}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objekte.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objekte.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) pdf += `${String(o).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objekte.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
