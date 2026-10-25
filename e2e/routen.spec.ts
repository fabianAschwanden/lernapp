import { Page } from '@playwright/test';

import {
  LEKTION,
  beantworte,
  expect,
  oeffne,
  pruefeKeinHorizontalesScrollen,
  test,
} from './hilfen';

const L = `/lektion/${LEKTION.id}`;

/**
 * Jede Route (und die wichtigsten Zustände darin) auf Handy und PC:
 * kein horizontales Scrollen. Konsolenfehler und fehlgeschlagene Requests
 * meldet die automatische `beobachtung` aus hilfen.ts.
 */
const ROUTEN: {
  pfad: string;
  titel: string | RegExp;
  zustaende?: (page: Page) => Promise<string[]>;
}[] = [
  { pfad: '/', titel: 'Was lernst du heute?' },
  {
    pfad: '/neu',
    titel: 'Neue Lektion',
    zustaende: async (page) => {
      await page.getByRole('button', { name: /Aus Material erstellen/ }).click();
      await expect(page.getByRole('heading', { name: '1. Grunddaten' })).toBeVisible();
      await pruefeKeinHorizontalesScrollen(page, '/neu (KI, Schritt 1)');
      await page.getByRole('combobox', { name: 'Fach *' }).fill('Informatik');
      await page.getByRole('button', { name: 'Weiter', exact: true }).click();
      await page.getByText('Text einfügen', { exact: true }).click();
      await pruefeKeinHorizontalesScrollen(page, '/neu (KI, Schritt 2)');
      await page
        .getByRole('textbox', { name: 'Text', exact: true })
        .fill('Etwas Stoff '.repeat(40));
      await page.getByRole('button', { name: 'Text hinzufügen' }).click();
      await page.getByRole('button', { name: 'Weiter', exact: true }).click();
      await page.getByRole('textbox', { name: /Lernziele/ }).fill('Du kannst etwas.');
      await page.getByRole('button', { name: 'Weiter', exact: true }).click();
      await pruefeKeinHorizontalesScrollen(page, '/neu (KI, Schritt 4)');
      await page.getByRole('button', { name: 'Weiter', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Prompt kopieren' })).toBeVisible();
      await pruefeKeinHorizontalesScrollen(page, '/neu (KI, Schritt 5)');
      await page
        .getByRole('navigation', { name: 'Schritte' })
        .getByRole('button', { name: 'Schritt 1: Grunddaten' })
        .click();
      await page.getByRole('button', { name: '← Andere Art wählen' }).click();
      await page.getByRole('button', { name: /Lektion importieren/ }).click();
      await pruefeKeinHorizontalesScrollen(page, '/neu (Import)');
      await page.getByRole('button', { name: '← Andere Art wählen' }).click();
      await page.getByRole('button', { name: /Leere Lektion anlegen/ }).click();
      await pruefeKeinHorizontalesScrollen(page, '/neu (leer)');
      return [];
    },
  },
  {
    pfad: '/einstellungen',
    titel: 'Einstellungen',
    zustaende: async (page) => {
      await page.getByRole('button', { name: 'Alle Daten löschen …' }).click();
      await pruefeKeinHorizontalesScrollen(page, '/einstellungen (Löschen bestätigen)');
      await page.getByRole('button', { name: 'Abbrechen' }).click();
      return [];
    },
  },
  { pfad: L, titel: LEKTION.titel },
  {
    pfad: `${L}/lernen`,
    titel: 'Lernen',
    zustaende: async (page) => {
      // Mehrere Fragen beantworten, damit verschiedene Fragetypen samt Rückmeldung vorkommen
      for (let i = 1; i <= 6; i++) {
        await expect(page.getByText(`Frage ${i} von`)).toBeVisible();
        await beantworte(page.getByRole('article'), 'ueben');
        await pruefeKeinHorizontalesScrollen(page, `${L}/lernen (Rückmeldung ${i})`);
        await page.getByRole('button', { name: 'Weiter →' }).click();
      }
      return [];
    },
  },
  { pfad: `${L}/lernen?modus=lernziel&lz=lz-anschluesse`, titel: 'Üben: Anschlüsse' },
  { pfad: `${L}/lernen?modus=fehler`, titel: 'Fehler wiederholen' },
  {
    pfad: `${L}/pruefung`,
    titel: 'Probeprüfung',
    zustaende: async (page) => {
      await page.getByRole('button', { name: 'Probeprüfung starten' }).click();
      await expect(page.getByText('Frage 1 von 20')).toBeVisible();
      await pruefeKeinHorizontalesScrollen(page, `${L}/pruefung (läuft)`);
      await page.getByRole('button', { name: 'Abgeben', exact: true }).click();
      await page.getByRole('button', { name: 'Ja, abgeben' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Auswertung' })).toBeVisible();
      await page.getByText('1.', { exact: true }).click();
      await pruefeKeinHorizontalesScrollen(page, `${L}/pruefung (Auswertung)`);
      return [];
    },
  },
  { pfad: `${L}/lernzettel`, titel: `Lernzettel – ${LEKTION.titel}` },
  // Mit oder ohne Kurzfassung (Inhalt wird separat ergänzt): Überschrift ist immer da
  { pfad: `${L}/kurzfassung`, titel: `Kurzfassung – ${LEKTION.titel}` },
  {
    pfad: `${L}/bearbeiten`,
    titel: 'Lektion bearbeiten',
    zustaende: async (page) => {
      await page.getByRole('tab', { name: /Lernziele/ }).click();
      await pruefeKeinHorizontalesScrollen(page, `${L}/bearbeiten (Lernziele)`);
      await page.getByRole('tab', { name: /Fragen/ }).click();
      await pruefeKeinHorizontalesScrollen(page, `${L}/bearbeiten (Fragen)`);
      // Je eine Frage pro Typ öffnen (Formular + Vorschau)
      const typen = [
        'Eine Antwort',
        'Mehrere Antworten',
        'Wahr oder falsch',
        'Zuordnen',
        'Reihenfolge',
        'Zahl',
        'Kurzantwort',
        'Erklären',
      ];
      for (const typ of typen) {
        await page
          .getByRole('list', { name: 'Fragen' })
          .getByRole('button')
          .filter({ hasText: typ })
          .first()
          .click();
        await expect(page.getByRole('textbox', { name: 'Fragetext' })).toBeVisible();
        await pruefeKeinHorizontalesScrollen(page, `${L}/bearbeiten (Frage ${typ})`);
        await page.getByRole('button', { name: '← Alle Fragen' }).click();
      }
      return [];
    },
  },
  { pfad: `${L}/rueckmeldung`, titel: 'Rückmeldung zur Prüfung' },
  { pfad: '/rueckmeldungen', titel: 'Rückmeldungen' },
  { pfad: '/lektion/gibt-es-nicht', titel: 'Lektion nicht gefunden' },
  { pfad: '/lektion/gibt-es-nicht/lernzettel', titel: 'Lernzettel nicht gefunden' },
  { pfad: '/lektion/gibt-es-nicht/kurzfassung', titel: 'Kurzfassung nicht gefunden' },
  { pfad: '/lektion/gibt-es-nicht/rueckmeldung', titel: 'Lektion nicht gefunden' },
];

test.describe('Alle Routen', () => {
  for (const r of ROUTEN) {
    test(`${r.pfad}: kein horizontales Scrollen, keine Fehler`, async ({ page }) => {
      await oeffne(page, r.pfad);
      await expect(page.getByRole('heading', { level: 1, name: r.titel }).first()).toBeVisible();
      // Bilder und lazy Inhalte fertig laden lassen
      await page.waitForLoadState('networkidle');
      await pruefeKeinHorizontalesScrollen(page, r.pfad);
      if (r.zustaende) await r.zustaende(page);
      // Nach unten scrollen (lazy Bilder) und nochmals prüfen
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await page.waitForLoadState('networkidle');
      await pruefeKeinHorizontalesScrollen(page, `${r.pfad} (unten)`);
    });
  }

  test('unbekannte Route leitet auf die Startseite um', async ({ page }) => {
    await page.goto('/gibt/es/nicht');
    await expect(page).toHaveURL('/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Was lernst du heute?' }),
    ).toBeVisible();
  });

  test('Seitentitel je Route', async ({ page }) => {
    for (const [pfad, titel] of [
      ['/', 'Lernapp'],
      [L, 'Lektion'],
      [`${L}/lernzettel`, 'Lernzettel'],
      [`${L}/kurzfassung`, 'Kurzfassung'],
      ['/einstellungen', 'Einstellungen'],
      [`${L}/rueckmeldung`, 'Rückmeldung zur Prüfung'],
      ['/rueckmeldungen', 'Rückmeldungen'],
    ] as const) {
      await page.goto(pfad);
      await expect(page).toHaveTitle(titel);
    }
  });
});
