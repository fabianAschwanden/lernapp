import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Locator, Page, TestInfo, expect, test as basis } from '@playwright/test';

/** Mitgelieferte Lektion, gegen die die meisten Tests laufen. */
export const LEKTION = {
  id: 'informatik-pruefung-1',
  titel: 'Prüfung 1: Computer-Grundlagen',
  anzahlLernziele: 13,
  themen: [
    'Bauteile im Computer',
    'Anschlüsse',
    'Funktionsweise des Computers',
    'MS Teams, Klassennotizbuch und Sicherheit',
  ],
} as const;

/** Anzahl Fragen der mitgelieferten Lektion (aus der Datei, damit Inhaltsänderungen keine Tests brechen). */
export const ANZAHL_FRAGEN = (
  JSON.parse(
    readFileSync(join(__dirname, '..', 'public', 'lektionen', `${LEKTION.id}.json`), 'utf-8'),
  ) as { fragen: unknown[] }
).fragen.length;

export const FIXTURE_ALLE_TYPEN = join(__dirname, 'fixtures', 'alle-fragetypen.json');
export const fixtureAlleTypen = JSON.parse(readFileSync(FIXTURE_ALLE_TYPEN, 'utf-8')) as {
  id: string;
  titel: string;
  fragen: { id: string; typ: string; frage: string }[];
};

export interface Beobachtung {
  /** Konsolenfehler, Seitenfehler, fehlgeschlagene Requests und HTTP-Fehler (≥ 400). */
  probleme: string[];
  /** Alle Netzwerkantworten (URL → Status). */
  antworten: { url: string; status: number }[];
}

/**
 * Test-Basis: Jeder Test bekommt einen frischen Browser-Kontext (also leere
 * IndexedDB). Zusätzlich sammelt `beobachtung` automatisch Konsolenfehler und
 * fehlgeschlagene Requests — ein Test ist nur grün, wenn keine auftreten.
 */
export const test = basis.extend<{ beobachtung: Beobachtung }>({
  beobachtung: [
    async ({ page }, use, info: TestInfo) => {
      const b: Beobachtung = { probleme: [], antworten: [] };
      page.on('console', (m) => {
        if (m.type() === 'error') b.probleme.push(`Konsole: ${m.text()}`);
      });
      page.on('pageerror', (e) => b.probleme.push(`Seitenfehler: ${e.message}`));
      page.on('requestfailed', (r) => {
        const grund = r.failure()?.errorText ?? '';
        // Blob-URLs (Downloads) werden absichtlich sofort wieder freigegeben.
        if (r.url().startsWith('blob:') || r.url().startsWith('data:')) return;
        b.probleme.push(`Request fehlgeschlagen: ${r.url()} (${grund})`);
      });
      page.on('response', (r) => {
        b.antworten.push({ url: r.url(), status: r.status() });
        if (r.status() >= 400) b.probleme.push(`HTTP ${r.status()}: ${r.url()}`);
      });
      await use(b);
      if (info.status === info.expectedStatus) {
        expect(b.probleme, 'keine Konsolenfehler und keine fehlgeschlagenen Requests').toEqual([]);
      }
    },
    { auto: true },
  ],
});

export { expect };

export function istHandy(info: TestInfo): boolean {
  return info.project.name === 'handy';
}

/** Öffnet eine Route und wartet, bis die App gerendert ist. */
export async function oeffne(page: Page, pfad: string): Promise<void> {
  await page.goto(pfad);
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
}

/** Kein horizontales Scrollen auf der aktuellen Seite. */
export async function pruefeKeinHorizontalesScrollen(page: Page, wo: string): Promise<void> {
  const masse = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    breite: window.innerWidth,
  }));
  expect(masse.scroll, `horizontales Scrollen auf ${wo}`).toBeLessThanOrEqual(masse.breite);
}

/** Setzt eine Zahl in den Einstellungen (Eingabe + change). */
export async function setzeEinstellung(page: Page, label: string, wert: number): Promise<void> {
  await oeffne(page, '/einstellungen');
  const feld = page.getByLabel(label, { exact: true });
  await feld.fill(String(wert));
  await feld.blur();
  await expect(feld).toHaveValue(String(wert));
}

/** Importiert eine Lektion als JSON-Datei über «Neue Lektion» und landet auf ihrer Übersicht. */
export async function importiereLektion(page: Page, datei: string, titel: string): Promise<void> {
  await oeffne(page, '/neu');
  await page.getByRole('button', { name: /Lektion importieren/ }).click();
  const chooserVersprechen = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'JSON-Datei wählen' }).click();
  await (await chooserVersprechen).setFiles(datei);
  await expect(page.getByRole('heading', { name: titel })).toBeVisible();
  await page.getByRole('button', { name: 'Importieren', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: titel })).toBeVisible();
}

/** Kopf der Rückmeldung nach dem Prüfen (Symbol davor ist aria-hidden). */
export const RUECKMELDUNG = /Richtig!|Teilweise richtig \(\d+ %\)|Leider falsch/;

const TYP_LABEL: Record<string, string> = {
  'Eine Antwort': 'einfachwahl',
  'Mehrere Antworten': 'mehrfachwahl',
  'Wahr oder falsch': 'wahrfalsch',
  Zuordnen: 'zuordnen',
  Reihenfolge: 'reihenfolge',
  Zahl: 'zahl',
  Kurzantwort: 'kurzantwort',
  Erklären: 'offen',
};

/** Fragetyp einer Fragekarte anhand des Typ-Chips. */
export async function frageTyp(karte: Locator): Promise<string> {
  await expect(karte.getByRole('form')).toBeVisible();
  for (const [label, typ] of Object.entries(TYP_LABEL)) {
    if (await karte.getByText(label, { exact: true }).first().isVisible()) return typ;
  }
  throw new Error('Unbekannter Fragetyp');
}

/**
 * Bedient die Eingabe einer Frage (irgendeine Antwort). Im Übungsmodus wird
 * danach «Prüfen» gedrückt bzw. bei offenen Fragen selbst bewertet.
 */
export async function beantworte(karte: Locator, modus: 'ueben' | 'pruefung'): Promise<string> {
  const typ = await frageTyp(karte);
  switch (typ) {
    case 'einfachwahl':
    case 'mehrfachwahl': {
      const optionen = karte.getByRole('group').getByRole('button');
      await optionen.first().click();
      await expect(optionen.first()).toHaveAttribute('aria-pressed', 'true');
      if (typ === 'mehrfachwahl') await optionen.nth(1).click();
      break;
    }
    case 'wahrfalsch':
      await karte.getByRole('button', { name: 'Wahr', exact: true }).click();
      break;
    case 'zuordnen': {
      const auswahl = karte.getByRole('combobox');
      const n = await auswahl.count();
      expect(n).toBeGreaterThan(0);
      for (let i = 0; i < n; i++) await auswahl.nth(i).selectOption({ index: 1 });
      break;
    }
    case 'reihenfolge': {
      const runter = karte.getByRole('button', { name: /nach unten verschieben/ });
      await runter.first().click();
      break;
    }
    case 'zahl':
      await karte.getByLabel('Deine Antwort').fill('8');
      break;
    case 'kurzantwort':
      await karte.getByLabel('Deine Antwort').fill('Bit');
      break;
    case 'offen':
      await karte.getByLabel(/Deine Antwort/).fill('Meine Erklärung in eigenen Worten.');
      if (modus === 'ueben') {
        await karte.getByRole('button', { name: 'Lösung zeigen' }).click();
        await expect(karte.getByText('Musterlösung')).toBeVisible();
        await karte.getByRole('button', { name: 'Teilweise', exact: true }).click();
      }
      return typ;
  }
  if (modus === 'ueben') await karte.getByRole('button', { name: 'Prüfen' }).click();
  return typ;
}

/** Position in der Lernrunde: «Frage 3 von 12 · +1 Wiederholung» bzw. «Wiederholung 1 von 2». */
export const POSITION = /^(?:Frage|Wiederholung) \d+ von \d+/;

/** Klickt «Weiter →» und wartet, bis die nächste Frage (oder der Endbildschirm) da ist. */
export async function naechsteFrage(page: Page): Promise<void> {
  const position = page.getByText(POSITION);
  const ende = page.getByRole('heading', { name: 'Runde geschafft!' });
  // Nur «Frage 3» bzw. «Wiederholung 1» vergleichen: «· +1 Wiederholung» kommt schon beim Prüfen dazu
  const stelle = async () =>
    (await ende.isVisible())
      ? 'Ende'
      : POSITION.exec(await position.innerText())?.[0].replace(/ von \d+$/, '');
  const weiter = page.getByRole('button', { name: 'Weiter →' });
  await expect(weiter).toBeVisible();
  const vorher = await stelle();
  await weiter.click();
  await expect.poll(stelle).not.toBe(vorher);
}

/**
 * Spielt eine Lernrunde bis zum Endbildschirm durch und prüft bei jeder Frage
 * Rückmeldung und Erklärung. Liefert die Fragetypen, die vorkamen.
 */
export async function spieleRunde(page: Page): Promise<Set<string>> {
  const typen = new Set<string>();
  const ende = page.getByRole('heading', { name: 'Runde geschafft!' });
  for (let schritt = 0; schritt < 80; schritt++) {
    const karte = page.getByRole('article');
    await expect(ende.or(karte)).toBeVisible();
    if (await ende.isVisible()) return typen;
    typen.add(await beantworte(karte, 'ueben'));
    const rueckmeldung = karte.getByText(RUECKMELDUNG);
    await expect(rueckmeldung).toBeVisible();
    // Erklärung erscheint in der Live-Region unter der Rückmeldung
    const kopf = (await rueckmeldung.innerText()).trim();
    const live = (
      await rueckmeldung.locator('xpath=ancestor::div[@aria-live][1]').innerText()
    ).trim();
    expect(live.replace(kopf, '').trim().length, 'Erklärung nach der Rückmeldung').toBeGreaterThan(
      5,
    );
    await expect(page.getByRole('button', { name: 'Weiter →' })).toBeFocused();
    await naechsteFrage(page);
  }
  throw new Error('Runde endet nicht');
}
