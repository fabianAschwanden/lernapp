import { readFileSync } from 'node:fs';

import {
  BEISPIELFRAGE,
  FIXTURE_ALLE_TYPEN,
  LEKTION,
  RUECKMELDUNG,
  beantworte,
  expect,
  fixtureAlleTypen,
  gibRueckmeldung,
  importiereLektion,
  oeffne,
  test,
} from './hilfen';

/** KI-Antwort, wie sie Claude im «Prompt kopieren»-Weg liefert (mit Text drumherum). */
const KI_ANTWORT = `Hier ist die Lektion:

\`\`\`json
${JSON.stringify(
  {
    fach: 'Informatik',
    titel: 'Netzwerke Grundlagen',
    beschreibung: 'Erste Begriffe zu Netzwerken.',
    hinweise: ['Kein Taschenrechner erlaubt'],
    lernziele: [
      {
        id: 'lz-lan',
        thema: 'Netzwerke',
        text: 'Du kannst LAN und WLAN unterscheiden.',
        zusammenfassung: 'LAN ist kabelgebunden, WLAN funkt.',
        merksaetze: ['LAN = Kabel'],
        quellenhinweis: null,
        ergaenzt: false,
      },
      {
        id: 'lz-ip',
        thema: 'Netzwerke',
        text: 'Du weisst, wozu eine IP-Adresse dient.',
        zusammenfassung: 'Die IP-Adresse identifiziert ein Gerät im Netz.',
        merksaetze: [],
        quellenhinweis: null,
        ergaenzt: true,
      },
    ],
    fragen: [
      kiFrage('f-1', 'lz-lan', 'einfachwahl', { optionen: ['Kabel', 'Funk'], richtigIndex: 0 }),
      kiFrage('f-2', 'lz-lan', 'wahrfalsch', { richtigBool: true }),
      kiFrage('f-3', 'lz-ip', 'kurzantwort', { akzeptiert: ['IP'] }),
    ],
  },
  null,
  2,
)}
\`\`\`
`;

function kiFrage(id: string, lernzielId: string, typ: string, teil: Record<string, unknown>) {
  return {
    id,
    lernzielId,
    typ,
    frage: `Frage ${id}?`,
    erklaerung: 'Weil es so ist.',
    schwierigkeit: 1,
    tipp: null,
    optionen: null,
    richtigIndex: null,
    richtigIndizes: null,
    richtigBool: null,
    paare: null,
    elemente: null,
    richtigZahl: null,
    toleranz: null,
    einheit: null,
    akzeptiert: null,
    musterloesung: null,
    stichworte: null,
    ...teil,
  };
}

test.describe('Neue Lektion', () => {
  test('Import einer gültigen JSON-Datei, zweiter Import als Kopie', async ({ page }) => {
    await importiereLektion(page, FIXTURE_ALLE_TYPEN, fixtureAlleTypen.titel);
    await expect(page).toHaveURL(`/lektion/${fixtureAlleTypen.id}`);
    await expect(page.getByText('Importiert', { exact: true })).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: 'Einheiten', exact: true })
        .getByText('nicht in deinen Unterlagen', { exact: true }),
    ).toBeVisible();

    // Startseite: neues Fach mit der Lektion
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 2, name: 'Testfach' })).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Alle Fragetypen/ }).filter({ hasText: '8 Fragen' }),
    ).toBeVisible();

    // Noch einmal importieren → Kopie
    await oeffne(page, '/neu');
    await page.getByRole('button', { name: /Lektion importieren/ }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'JSON-Datei wählen' }).click();
    await (await chooser).setFiles(FIXTURE_ALLE_TYPEN);
    await expect(page.getByText('Diese Lektion hast du schon.')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Als Kopie importieren' })).toBeChecked();
    await page.getByRole('button', { name: 'Importieren', exact: true }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: `${fixtureAlleTypen.titel} (Kopie)` }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/lektion\/alle-fragetypen$/);
  });

  test('ungültige Datei wird mit Gründen abgelehnt', async ({ page }) => {
    await oeffne(page, '/neu');
    await page.getByRole('button', { name: /Lektion importieren/ }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'JSON-Datei wählen' }).click();
    await (
      await chooser
    ).setFiles({
      name: 'kaputt.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ id: 'x', titel: 'Ohne alles' })),
    });
    await expect(page.getByRole('alert')).toContainText('Die Datei ist keine gültige Lektion');
    await expect(page.getByRole('button', { name: 'Importieren', exact: true })).toHaveCount(0);

    await (
      await Promise.all([
        page.waitForEvent('filechooser'),
        page.getByRole('button', { name: 'JSON-Datei wählen' }).click(),
      ])
    )[0].setFiles({
      name: 'kein-json.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{ das ist kein JSON'),
    });
    await expect(page.getByRole('alert')).toContainText('keine gültige JSON-Datei');
  });

  test('ohne API-Schlüssel: Prompt kopieren und JSON-Antwort einfügen', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await oeffne(page, '/neu');
    await page.getByRole('button', { name: /Aus Material erstellen \(KI\)/ }).click();

    // 1. Grunddaten
    const weiter = page.getByRole('button', { name: 'Weiter', exact: true });
    await expect(page.getByRole('heading', { name: '1. Grunddaten' })).toBeVisible();
    await expect(weiter).toBeDisabled();
    await page.getByRole('combobox', { name: 'Fach *' }).fill('Informatik');
    await weiter.click();

    // 2. Material: Text einfügen
    await expect(page.getByRole('heading', { name: /^2\. / })).toBeVisible();
    await expect(weiter).toBeDisabled();
    await page.getByText('Text einfügen', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Bezeichnung' }).fill('Notizen');
    await page
      .getByRole('textbox', { name: 'Text', exact: true })
      .fill('Ein LAN verbindet Geräte per Kabel. WLAN funkt.');
    await page.getByRole('button', { name: 'Text hinzufügen' }).click();
    await expect(page.getByRole('region', { name: 'Notizen' })).toBeVisible();
    await weiter.click();

    // 3. Lernziele
    await expect(page.getByRole('heading', { name: /^3\. / })).toBeVisible();
    await page
      .getByRole('textbox', { name: /Lernziele/ })
      .fill('Du kannst LAN und WLAN unterscheiden.\nDu weisst, wozu eine IP-Adresse dient.');
    await expect(page.getByText('2 Lernziele erkannt.')).toBeVisible();
    await weiter.click();

    // 4. Optionen
    await expect(page.getByRole('heading', { name: /^4\. / })).toBeVisible();
    await weiter.click();

    // 5. Erstellen: ohne Schlüssel → Hinweis + Prompt kopieren
    await expect(page.getByRole('heading', { name: /^5\. / })).toBeVisible();
    await expect(
      page.getByText('Für die direkte Erstellung braucht es einen API-Schlüssel'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Prompt kopieren' }).click();
    await expect(page.getByText('Prompt kopiert', { exact: true })).toBeVisible();
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(prompt).toContain('Du kannst LAN und WLAN unterscheiden.');
    expect(prompt).toContain('Ein LAN verbindet Geräte per Kabel.');

    await page.getByRole('textbox', { name: 'Antwort von Claude einfügen' }).fill(KI_ANTWORT);
    await page.getByRole('button', { name: 'Antwort übernehmen' }).click();

    // 6. Vorschau
    await expect(page.getByRole('heading', { name: /^6\. / })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Netzwerke Grundlagen' })).toBeVisible();
    await expect(page.getByText('2 Lernziele · 3 Fragen')).toBeVisible();
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();

    await expect(page).toHaveURL(/\/lektion\/netzwerke-grundlagen$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Netzwerke Grundlagen' }),
    ).toBeVisible();
    await expect(page.getByText('Mit KI erstellt', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Üben: / })).toHaveCount(2);
  });

  test('leere Lektion anlegen öffnet den Editor; löschen', async ({ page }) => {
    await oeffne(page, '/neu');
    await page.getByRole('button', { name: /Leere Lektion anlegen/ }).click();
    await page.getByRole('button', { name: 'Anlegen und bearbeiten' }).click();
    await expect(page.getByRole('alert')).toHaveText('Gib Fach und Titel an.');
    await page.getByRole('combobox', { name: 'Fach' }).fill('Geschichte');
    await page.getByRole('textbox', { name: 'Titel' }).fill('Römer');
    await page.getByRole('button', { name: 'Anlegen und bearbeiten' }).click();

    await expect(page).toHaveURL('/lektion/roemer/bearbeiten');
    await expect(page.getByRole('heading', { level: 1, name: 'Lektion bearbeiten' })).toBeVisible();
    await expect(page.getByText('Geschichte · Römer')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Titel' })).toHaveValue('Römer');

    await page.getByRole('link', { name: '← Zur Lektion' }).click();
    await expect(page.getByText('Diese Lektion hat noch keine Fragen.')).toBeVisible();
    await expect(page.getByText('Eigene Lektion', { exact: true })).toBeVisible();

    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Löschen', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { level: 2, name: 'Geschichte' })).toHaveCount(0);
  });
});

test.describe('Einstellungen', () => {
  test('Backup exportieren enthält den Lernstand und lässt sich wieder importieren', async ({
    page,
  }, info) => {
    // Etwas Lernstand erzeugen: eine Frage beantworten
    await page.goto(`/lektion/${LEKTION.id}/lernen`);
    const karte = page.getByRole('article');
    await beantworte(karte, 'ueben');
    await expect(karte.getByText(RUECKMELDUNG)).toBeVisible();

    await oeffne(page, '/einstellungen');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Backup exportieren' }).click();
    const datei = await download;
    expect(datei.suggestedFilename()).toMatch(/^lernapp-backup-.*\.json$/);
    const pfad = info.outputPath('backup.json');
    await datei.saveAs(pfad);
    const backup = JSON.parse(readFileSync(pfad, 'utf-8'));
    expect(backup.app).toBe('lernapp');
    expect(backup.fortschritt.length).toBeGreaterThanOrEqual(1);
    expect(backup.fortschritt[0].lektionId).toBe(LEKTION.id);
    expect(JSON.stringify(backup)).not.toContain('anthropicApiKey');

    // Alles löschen …
    await page.getByRole('button', { name: 'Alle Daten löschen …' }).click();
    page.once('dialog', (d) => void d.accept());
    // Die App lädt sich nach dem Löschen selbst neu
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('button', { name: 'Ja, endgültig löschen' }).click(),
    ]);
    await oeffne(page, `/lektion/${LEKTION.id}`);
    await expect(page.getByRole('progressbar', { name: 'Gesamtstand' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
    // Alles wieder neu: so viele «neu» wie die Lektion Fragen hat (Zahl hängt vom Inhalt ab)
    const lernen = page.getByRole('link', { name: /^Lernen \d+ neu/ });
    await expect(lernen).toBeVisible();
    const alleNeu = Number(/(\d+) neu/.exec(await lernen.innerText())![1]);

    // … und das Backup wieder importieren
    await oeffne(page, '/einstellungen');
    const chooser = page.waitForEvent('filechooser');
    await page.getByText('Backup importieren', { exact: true }).click();
    await (await chooser).setFiles(pfad);
    await expect(page.getByText('Backup importiert.')).toBeVisible();
    await expect(page.getByText(`Lernstand: ${backup.fortschritt.length} Einträge`)).toBeVisible();

    await page.goto(`/lektion/${LEKTION.id}`);
    await expect(
      page.getByRole('link', {
        name: new RegExp(`^Lernen ${alleNeu - backup.fortschritt.length} neu`),
      }),
    ).toBeVisible();
  });

  test('Backup enthält die Rückmeldungen zu Prüfungen und stellt sie wieder her', async ({
    page,
  }, info) => {
    await gibRueckmeldung(page);
    await oeffne(page, '/einstellungen');
    await expect(page.getByText('1 Rückmeldung', { exact: true })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Backup exportieren' }).click();
    const pfad = info.outputPath('backup.json');
    await (await download).saveAs(pfad);
    const backup = JSON.parse(readFileSync(pfad, 'utf-8'));
    expect(backup.rueckmeldungen).toHaveLength(1);
    expect(backup.rueckmeldungen[0].lektionId).toBe(LEKTION.id);
    expect(backup.rueckmeldungen[0].beispielfragen).toContain(BEISPIELFRAGE);

    await page.getByRole('button', { name: 'Alle Daten löschen …' }).click();
    page.once('dialog', (d) => void d.accept());
    await Promise.all([
      page.waitForEvent('load'),
      page.getByRole('button', { name: 'Ja, endgültig löschen' }).click(),
    ]);
    await oeffne(page, `/lektion/${LEKTION.id}`);
    await expect(page.getByRole('link', { name: /Rückmeldung bearbeiten/ })).toHaveCount(0);

    await oeffne(page, '/einstellungen');
    const chooser = page.waitForEvent('filechooser');
    await page.getByText('Backup importieren', { exact: true }).click();
    await (await chooser).setFiles(pfad);
    await expect(page.getByText('Backup importiert.')).toBeVisible();
    await expect(page.getByText('Rückmeldungen zu Prüfungen: 1')).toBeVisible();

    await oeffne(page, `/lektion/${LEKTION.id}`);
    await expect(page.getByRole('link', { name: /Rückmeldung bearbeiten/ })).toBeVisible();
  });

  test('Farbschema «Dunkel» setzt data-theme und bleibt nach Neuladen', async ({ page }) => {
    await oeffne(page, '/einstellungen');
    const html = page.locator('html');
    await expect(html).not.toHaveAttribute('data-theme');
    const hellerHintergrund = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor,
    );

    await page.getByText('Dunkel', { exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Dunkel' })).toBeChecked();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(
      hellerHintergrund,
    );

    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(page.getByRole('radio', { name: 'Dunkel' })).toBeChecked();

    await page.getByText('Hell', { exact: true }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await page.getByText('Wie das Gerät', { exact: true }).click();
    await expect(html).not.toHaveAttribute('data-theme');
  });

  test('Zahlen werden auf den erlaubten Bereich begrenzt', async ({ page }) => {
    await oeffne(page, '/einstellungen');
    const runde = page.getByRole('spinbutton', { name: 'Fragen pro Lernrunde' });
    await runde.fill('2');
    await runde.blur();
    await expect(runde).toHaveValue('5');
    await runde.fill('99');
    await runde.blur();
    await expect(runde).toHaveValue('30');
    await page.reload();
    await expect(page.getByRole('spinbutton', { name: 'Fragen pro Lernrunde' })).toHaveValue('30');
  });
});
