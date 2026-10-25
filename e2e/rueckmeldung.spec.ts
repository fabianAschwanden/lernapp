import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ANZAHL_FRAGEN,
  BEISPIELFRAGE,
  LEKTION,
  LERNZIELE_TEXTE,
  expect,
  fixtureAlleTypen,
  gibRueckmeldung,
  istHandy,
  oeffne,
  pruefeKeinHorizontalesScrollen,
  test,
} from './hilfen';

const L = `/lektion/${LEKTION.id}`;

test.describe('Rückmeldung zur Prüfung', () => {
  test('ausfüllen, speichern, Werte bleiben nach Neuladen; Übersicht zeigt «bearbeiten»', async ({
    page,
  }) => {
    await oeffne(page, L);
    // Ohne Prüfungsdatum: unauffälliger Link unter «Verwalten»
    await page.getByRole('link', { name: 'Rückmeldung zur Prüfung', exact: true }).click();
    await expect(page).toHaveURL(`${L}/rueckmeldung`);
    await expect(page).toHaveTitle('Rückmeldung zur Prüfung');

    await gibRueckmeldung(page);
    await pruefeKeinHorizontalesScrollen(page, `${L}/rueckmeldung (gespeichert)`);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Was das für dich heisst' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Diese Probeprüfung wiederholen' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Zum Profil Informatik' })).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Rückmeldung zur Prüfung' }),
    ).toBeVisible();
    await expect(page.getByLabel('Note (freiwillig)')).toHaveValue('4.5');
    await expect(page.getByLabel('Lehrperson (freiwillig)')).toHaveValue('Frau M.');
    await expect(
      page
        .getByRole('group', { name: 'Wie gut passten die Lernziele zu dem, was drankam?' })
        .getByRole('radio', { name: 'Gut', exact: true }),
    ).toBeChecked();
    await expect(
      page
        .getByRole('group', { name: 'Wurde der ganze Lernstoff abgefragt?' })
        .getByRole('radio', { name: 'Nur Teile' }),
    ).toBeChecked();
    await expect(
      page
        .getByRole('group', { name: /Wie schwierig/ })
        .getByRole('radio', { name: 'Etwas schwerer' }),
    ).toBeChecked();
    await expect(
      page
        .getByRole('group', { name: LERNZIELE_TEXTE[0], exact: true })
        .getByRole('radio', { name: 'Ja', exact: true }),
    ).toBeChecked();
    await expect(
      page
        .getByRole('group', { name: LERNZIELE_TEXTE[1], exact: true })
        .getByRole('radio', { name: 'Nein', exact: true }),
    ).toBeChecked();
    await expect(
      page
        .getByRole('group', { name: LERNZIELE_TEXTE[2], exact: true })
        .getByRole('radio', { name: 'Weiss nicht' }),
    ).toBeChecked();
    await expect(page.getByLabel('Erklären, begründen, beschreiben (ganze Sätze)')).toBeChecked();
    await expect(page.getByRole('textbox', { name: 'Beispielfrage 1' })).toHaveValue(BEISPIELFRAGE);

    await oeffne(page, L);
    const bearbeiten = page.getByRole('link', { name: /Rückmeldung bearbeiten/ });
    await expect(bearbeiten).toContainText(/schwerer/i);
    await expect(bearbeiten).toContainText(
      `1 von 2 beurteilten Lernzielen dran (${LERNZIELE_TEXTE.length - 2} offen)`,
    );
    await bearbeiten.click();
    await expect(page).toHaveURL(`${L}/rueckmeldung`);
  });

  test('Profil-Seite: Kennzahlen, Beispielfrage, kopieren und herunterladen', async ({
    page,
    context,
  }, info) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await gibRueckmeldung(page);
    await page.getByRole('link', { name: 'Zum Profil Informatik' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Rückmeldungen' })).toBeVisible();
    await expect(page).toHaveTitle('Rückmeldungen');

    const fach = page.getByRole('region', { name: 'Informatik' });
    await expect(fach.getByText('1 Prüfung', { exact: true })).toBeVisible();
    await expect(fach.getByRole('definition').first()).toBeVisible();
    await expect(fach.getByText(/schwerer/i).first()).toBeVisible();
    await fach.getByText('Beispielfragen (1)').click();
    await expect(fach.getByText(BEISPIELFRAGE)).toBeVisible();
    await expect(
      fach.getByRole('link', { name: `Rückmeldung zu ${LEKTION.titel} bearbeiten` }),
    ).toBeVisible();
    await pruefeKeinHorizontalesScrollen(page, '/rueckmeldungen');

    await fach.getByRole('button', { name: 'Für die Lektionserstellung kopieren' }).click();
    await expect(page.getByText(/^Kopiert\. Füge den Text/)).toBeVisible();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain('Informatik');
    expect(text).toContain(BEISPIELFRAGE);
    expect(text, 'keine Note im kopierten Text').not.toContain('4.5');
    expect(text, 'kein Name im kopierten Text').not.toContain('Frau M.');

    const download = page.waitForEvent('download');
    await fach.getByRole('button', { name: 'Als Datei herunterladen' }).click();
    const datei = await download;
    expect(datei.suggestedFilename()).toBe('rueckmeldungen-informatik.json');
    const pfad = info.outputPath('rueckmeldungen.json');
    await datei.saveAs(pfad);
    const exportiert = JSON.parse(readFileSync(pfad, 'utf-8'));
    expect(exportiert.art).toBe('lernapp-rueckmeldungen');
    expect(exportiert.rueckmeldungen).toHaveLength(1);
    expect(exportiert.rueckmeldungen[0].lektionId).toBe(LEKTION.id);
    expect(exportiert.rueckmeldungen[0].note).toBeUndefined();
  });

  test('neues Formular: keine Vorbelegung; Speichern ohne Kernfragen bleibt neutral', async ({
    page,
  }) => {
    await oeffne(page, `${L}/rueckmeldung`);
    const gruppen = [
      'Wie gut passten die Lernziele zu dem, was drankam?',
      'Wurde der ganze Lernstoff abgefragt?',
      'Wie schwierig war die Prüfung im Vergleich zum Üben mit der App?',
    ];
    for (const name of gruppen) {
      const radios = page.getByRole('group', { name }).getByRole('radio');
      await expect(radios.first()).toBeVisible();
      for (const radio of await radios.all()) await expect(radio).not.toBeChecked();
    }
    await expect(page.getByText('Noch offen')).toHaveCount(3);

    await page.getByRole('button', { name: 'Rückmeldung speichern' }).click();
    await expect(page.getByText(/Noch ohne Antwort: «Wie gut passten/)).toBeVisible();
    // Gespeichert, aber ohne erfundene Werte: «Keine Angabe» statt Vorbelegung
    await page.reload();
    for (const name of gruppen) {
      await expect(
        page.getByRole('group', { name }).getByRole('radio', { name: 'Keine Angabe' }),
      ).toBeChecked();
    }
    await expect(page.getByText('Noch offen')).toHaveCount(0);
    await oeffne(page, L);
    const bearbeiten = page.getByRole('link', { name: /Rückmeldung bearbeiten/ });
    await expect(bearbeiten).not.toContainText('Schwierigkeit');
  });

  test('ungültige Note: Hinweis beim Speichern, Fokus aufs Notenfeld, nichts gespeichert', async ({
    page,
  }) => {
    await oeffne(page, `${L}/rueckmeldung`);
    await page.getByLabel('Note (freiwillig)').fill('45');
    const speichern = page.getByRole('button', { name: 'Rückmeldung speichern' });
    await expect(speichern).toBeEnabled();
    await speichern.click();
    await expect(page.getByText(/^Die Note ist ungültig/)).toBeVisible();
    await expect(page.getByLabel('Note (freiwillig)')).toBeFocused();
    page.once('dialog', (d) => void d.accept());
    await oeffne(page, L);
    await expect(
      page.getByRole('link', { name: 'Rückmeldung zur Prüfung', exact: true }),
    ).toBeVisible();
  });

  test('Beispielfrage entfernen: Fokus bleibt bei den Beispielfragen', async ({ page }) => {
    await oeffne(page, `${L}/rueckmeldung`);
    await page.getByRole('button', { name: '+ Beispielfrage hinzufügen' }).click();
    await page.getByRole('button', { name: 'Beispielfrage 1 entfernen' }).click();
    await expect(page.getByRole('button', { name: '+ Beispielfrage hinzufügen' })).toBeFocused();
  });

  test('«Alle übrigen: Ja» setzt nur unbeurteilte Lernziele des Themas', async ({ page }) => {
    await gibRueckmeldung(page);
    await page.getByRole('button', { name: /^Alle übrigen: Ja – Bauteile/ }).click();
    const lz = (i: number, name: string) =>
      page
        .getByRole('group', { name: LERNZIELE_TEXTE[i], exact: true })
        .getByRole('radio', { name, exact: true });
    await expect(lz(1, 'Nein')).toBeChecked();
    await expect(lz(2, 'Ja')).toBeChecked();
    // Anderes Thema bleibt unverändert
    await expect(lz(3, 'Weiss nicht')).toBeChecked();
  });

  test('nach dem Speichern: nächste Lektion im Fach mit vorbelegtem Fach erstellen', async ({
    page,
  }) => {
    await gibRueckmeldung(page);
    await page.getByRole('link', { name: 'Nächste Lektion in Informatik erstellen' }).click();
    await expect(page).toHaveURL(/\/neu\?fach=Informatik$/);
    await page.getByRole('button', { name: /Aus Material erstellen/ }).click();
    await expect(page.getByRole('combobox', { name: 'Fach *' })).toHaveValue('Informatik');
    await expect(page.getByRole('textbox', { name: 'Lehrperson' })).toHaveValue('Frau M.');
  });

  test('Handy: Skalen und Lernziel-Antworten ohne Umbruch-Chaos', async ({ page }, info) => {
    test.skip(!istHandy(info), 'nur bei 360 px');
    await oeffne(page, `${L}/rueckmeldung`);
    for (const name of [
      'Wie gut passten die Lernziele zu dem, was drankam?',
      'Wie schwierig war die Prüfung im Vergleich zum Üben mit der App?',
    ]) {
      const boxen = await Promise.all(
        // Die Optionsfelder liegen unsichtbar über der ganzen Kachel; ohne «Keine Angabe»
        (await page.getByRole('group', { name }).getByRole('radio').all())
          .slice(0, 5)
          .map((r) => r.boundingBox()),
      );
      for (let i = 1; i < 5; i++) {
        expect(Math.abs(boxen[i]!.width - boxen[0]!.width)).toBeLessThanOrEqual(1);
        expect(boxen[i]!.y).toBeGreaterThan(boxen[i - 1]!.y);
      }
    }
    const segmente = await Promise.all(
      (
        await page
          .getByRole('group', { name: LERNZIELE_TEXTE[0], exact: true })
          .getByRole('radio')
          .all()
      ).map((s) => s.boundingBox()),
    );
    expect(segmente).toHaveLength(4);
    for (const b of segmente) {
      expect(b!.y).toBe(segmente[0]!.y);
      expect(b!.height).toBeGreaterThanOrEqual(44);
    }
    await pruefeKeinHorizontalesScrollen(page, `${L}/rueckmeldung (Handy)`);
  });

  test('leere Profil-Seite erklärt die Funktion; Einstellungen verlinken sie', async ({ page }) => {
    await oeffne(page, '/einstellungen');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Rückmeldungen nach Prüfungen' }),
    ).toBeVisible();
    await expect(page.getByText('Noch keine Rückmeldungen')).toBeVisible();
    await page.getByRole('link', { name: 'Rückmeldungen ansehen' }).click();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Noch keine Rückmeldungen' }),
    ).toBeVisible();
    await pruefeKeinHorizontalesScrollen(page, '/rueckmeldungen (leer)');
    await page.getByRole('link', { name: 'Zu den Lektionen' }).click();
    await expect(page).toHaveURL('/');
  });

  test('ungespeicherte Änderung: Nachfrage beim Verlassen', async ({ page }) => {
    await oeffne(page, `${L}/rueckmeldung`);
    await page.getByLabel('Lehrperson (freiwillig)').fill('Herr X.');
    let meldung = '';
    page.once('dialog', (d) => {
      meldung = d.message();
      void d.dismiss();
    });
    await page.getByRole('link', { name: LEKTION.titel }).click();
    await expect.poll(() => meldung).toContain('noch nicht gespeichert');
    await expect(page).toHaveURL(`${L}/rueckmeldung`);

    page.once('dialog', (d) => void d.accept());
    await page.getByRole('link', { name: LEKTION.titel }).click();
    await expect(page).toHaveURL(L);
    // Nichts gespeichert
    await expect(
      page.getByRole('link', { name: 'Rückmeldung zur Prüfung', exact: true }),
    ).toBeVisible();
  });

  test('löschen mit Bestätigung', async ({ page }) => {
    await gibRueckmeldung(page);
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Rückmeldung löschen' }).click();
    await expect(page).toHaveURL(L);
    await expect(
      page.getByRole('link', { name: 'Rückmeldung zur Prüfung', exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /Rückmeldung bearbeiten/ })).toHaveCount(0);
  });

  test('Prüfungsdatum erreicht: Rückmeldung hervorgehoben', async ({ page }) => {
    const bio = '/lektion/biologie-pruefung-1';
    const datum = (
      JSON.parse(
        readFileSync(
          join(__dirname, '..', 'public', 'lektionen', 'biologie-pruefung-1.json'),
          'utf-8',
        ),
      ) as { pruefungsdatum: string }
    ).pruefungsdatum;
    const hervor = page.getByRole('link', { name: /Prüfung geschrieben\? Gib Rückmeldung/ });

    const vorher = new Date(`${datum}T09:00:00`);
    vorher.setDate(vorher.getDate() - 3);
    await page.clock.setFixedTime(vorher);
    await oeffne(page, bio);
    await expect(
      page.getByRole('link', { name: 'Rückmeldung zur Prüfung', exact: true }),
    ).toBeVisible();
    await expect(hervor).toHaveCount(0);

    await page.clock.setFixedTime(new Date(`${datum}T18:00:00`));
    await oeffne(page, bio);
    await expect(hervor).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Rückmeldung zur Prüfung', exact: true }),
    ).toHaveCount(0);
  });
});

test.describe('Rückmeldungen wirken weiter', () => {
  test('Probeprüfung zeigt den Stil-Hinweis und den Schalter', async ({ page }) => {
    await oeffne(page, `${L}/pruefung`);
    await expect(page.getByRole('heading', { name: /Im Stil deiner Lehrperson/ })).toHaveCount(0);

    await gibRueckmeldung(page);
    await page.getByRole('link', { name: 'Diese Probeprüfung wiederholen' }).click();
    await expect(
      page.getByRole('heading', { name: /Im Stil deiner Lehrperson \(Frau M\.\)/ }),
    ).toBeVisible();
    await expect(page.getByText(/\(aus 1 Rückmeldung\)/)).toBeVisible();
    const schalter = page.getByRole('checkbox', {
      name: 'Fragen nach dem Stil der Lehrperson auswählen',
    });
    await expect(schalter).toBeChecked();
    await pruefeKeinHorizontalesScrollen(page, `${L}/pruefung (Stil)`);
    await page.getByRole('button', { name: 'Probeprüfung starten' }).click();
    await expect(page.getByText('Frage 1 von 20')).toBeVisible();
  });

  test('Neue Lektion: Profil-Hinweis beim Fach, Lehrperson vorgeschlagen', async ({ page }) => {
    await gibRueckmeldung(page);
    await oeffne(page, '/neu');
    await page.getByRole('button', { name: /Aus Material erstellen/ }).click();
    const fach = page.getByRole('combobox', { name: 'Fach *' });
    await fach.fill('Informatik');
    await fach.blur();
    await expect(
      page.getByText(
        /1 Rückmeldung zu früheren Prüfungen in Informatik fliesst in die Erstellung ein/,
      ),
    ).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: 'Rückmeldungen früherer Prüfungen berücksichtigen' }),
    ).toBeChecked();
    await expect(page.getByRole('textbox', { name: 'Lehrperson' })).toHaveValue('Frau M.');
    await pruefeKeinHorizontalesScrollen(page, '/neu (Profil-Hinweis)');

    // Anderes Fach: kein Hinweis
    await fach.fill('Geschichte');
    await expect(page.getByText(/zu früheren Prüfungen in/)).toHaveCount(0);
    await fach.fill('informatik');
    await page.getByRole('link', { name: 'Rückmeldungen zu Informatik ansehen' }).click();
    await expect(page).toHaveURL(/\/rueckmeldungen\?fach=informatik$/);
    await expect(page.getByRole('heading', { level: 2, name: 'Informatik' })).toBeVisible();
  });
});

test.describe('Datenbank-Migration', () => {
  test('Daten aus Version 1 bleiben erhalten, Rückmeldungen lassen sich speichern', async ({
    page,
  }) => {
    const frageId = (
      JSON.parse(
        readFileSync(join(__dirname, '..', 'public', 'lektionen', `${LEKTION.id}.json`), 'utf-8'),
      ) as { fragen: { id: string }[] }
    ).fragen[0].id;

    // Gleiche Herkunft, aber ohne App: DB in Version 1 wie vor den Rückmeldungen anlegen
    await page.goto('/manifest.webmanifest');
    await page.evaluate(
      async ({ lektion, lektionId, frageId }) => {
        const db = await new Promise<IDBDatabase>((ok, fehler) => {
          const anfrage = indexedDB.open('lernapp', 1);
          anfrage.onupgradeneeded = () => {
            const d = anfrage.result;
            d.createObjectStore('lektionen', { keyPath: 'id' });
            d.createObjectStore('fortschritt', { keyPath: 'schluessel' }).createIndex(
              'lektionId',
              'lektionId',
            );
            d.createObjectStore('pruefungen', { keyPath: 'id' }).createIndex(
              'lektionId',
              'lektionId',
            );
            d.createObjectStore('einstellungen');
          };
          anfrage.onsuccess = () => ok(anfrage.result);
          anfrage.onerror = () => fehler(anfrage.error);
        });
        await new Promise<void>((ok, fehler) => {
          const tx = db.transaction(['lektionen', 'fortschritt'], 'readwrite');
          tx.objectStore('lektionen').put(lektion);
          tx.objectStore('fortschritt').put({
            schluessel: `${lektionId}::${frageId}`,
            lektionId,
            frageId,
            fach: 3,
            richtig: 3,
            falsch: 0,
            zuletzt: new Date().toISOString(),
            faelligAb: new Date(Date.now() + 7 * 864e5).toISOString(),
            verlauf: ['richtig', 'richtig', 'richtig'],
          });
          tx.oncomplete = () => ok();
          tx.onerror = () => fehler(tx.error);
        });
        db.close();
      },
      { lektion: fixtureAlleTypen, lektionId: LEKTION.id, frageId },
    );

    await oeffne(page, '/');
    await expect(page.getByText(fixtureAlleTypen.titel).first()).toBeVisible();
    await oeffne(page, L);
    // Eine Frage hat schon Lernstand → eine weniger «neu»
    await expect(
      page.getByRole('link', { name: new RegExp(`^Lernen ${ANZAHL_FRAGEN - 1} neu`) }),
    ).toBeVisible();

    await gibRueckmeldung(page);
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Beispielfrage 1' })).toHaveValue(BEISPIELFRAGE);
    const version = await page.evaluate(
      () =>
        new Promise<number>((ok) => {
          const a = indexedDB.open('lernapp');
          a.onsuccess = () => {
            ok(a.result.version);
            a.result.close();
          };
        }),
    );
    expect(version).toBe(2);
  });
});
