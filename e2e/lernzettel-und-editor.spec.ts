import {
  LEKTION,
  beantworte,
  expect,
  naechsteFrage,
  oeffne,
  setzeEinstellung,
  test,
} from './hilfen';

test.describe('Lernzettel', () => {
  test('alle 13 Lernziele, alle Bilder laden ohne 404', async ({ page, beobachtung }) => {
    await oeffne(page, `/lektion/${LEKTION.id}/lernzettel`);
    await expect(
      page.getByRole('heading', { level: 1, name: `Lernzettel – ${LEKTION.titel}` }),
    ).toBeVisible();

    // Themen als Sprungmarken, Lernziele als Abschnitte
    const sprung = page.getByRole('navigation', { name: 'Themen' }).getByRole('button');
    await expect(sprung).toHaveText([...LEKTION.themen]);
    await expect(page.getByRole('heading', { level: 2 })).toHaveText([...LEKTION.themen]);
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(LEKTION.anzahlLernziele);
    await expect(page.getByRole('link', { name: /^Dazu üben: / })).toHaveCount(
      LEKTION.anzahlLernziele,
    );
    // Hinweis bei den 6 ergänzten Lernzielen
    await expect(page.getByText(/Dieser Teil stammt nicht aus deinen Unterlagen/)).toHaveCount(
      6,
    );

    // Bilder sind lazy: jedes einmal in den Sichtbereich holen und warten, bis es geladen ist
    const bilder = page.getByRole('figure').getByRole('img');
    const anzahl = await bilder.count();
    expect(anzahl).toBe(21);
    for (let i = 0; i < anzahl; i++) {
      const bild = bilder.nth(i);
      await bild.scrollIntoViewIfNeeded();
      await expect(bild).toHaveAttribute('alt', /\S/);
      await expect
        .poll(
          () => bild.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
          {
            message: `Bild ${i + 1} geladen`,
          },
        )
        .toBe(true);
    }
    const svgs = beobachtung.antworten.filter((a) => a.url.includes('/bilder/'));
    expect(svgs.length).toBeGreaterThanOrEqual(18); // 18 verschiedene Dateien
    expect(svgs.filter((a) => a.status >= 400)).toEqual([]);
    expect(beobachtung.antworten.filter((a) => a.status === 404)).toEqual([]);
  });

  test('?lz= springt zum Lernziel, Sprungmarken springen zum Thema', async ({ page }) => {
    await page.goto(`/lektion/${LEKTION.id}/lernzettel?lz=lz-passwort`);
    const passwort = page.getByRole('region', {
      name: 'Wie sollte ein gutes Passwort gewählt werden.',
    });
    await expect(passwort).toBeInViewport();
    await expect(passwort).toBeFocused();
    // Der Anfang der Seite ist weggescrollt
    await expect(page.getByRole('heading', { level: 1 })).not.toBeInViewport();

    await page.goto(`/lektion/${LEKTION.id}/lernzettel`);
    await page
      .getByRole('navigation', { name: 'Themen' })
      .getByRole('button', { name: 'Funktionsweise des Computers' })
      .click();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Funktionsweise des Computers' }),
    ).toBeInViewport();

    // «Lernzettel»-Knopf in der Lektionsübersicht führt mit ?lz= hierher
    await page.goto(`/lektion/${LEKTION.id}`);
    await page.getByRole('link', { name: /^Lernzettel: Formel für die Anzahl Varianten/ }).click();
    await expect(page).toHaveURL(/lernzettel\?lz=lz-varianten/);
    await expect(
      page.getByRole('region', { name: /^Formel für die Anzahl Varianten/ }),
    ).toBeInViewport();
  });
});

test.describe('Editor', () => {
  test('Frage und Titel ändern, speichern, in Lernrunde sichtbar; Original wiederherstellen', async ({
    page,
  }) => {
    const neuerText = 'E2E: Was unterscheidet Hardware von Software?';
    const neuerTitel = 'Prüfung 1 (bearbeitet)';
    const lernziel = /^\d+\. Hardware, Software und Betriebssystem/;

    await oeffne(page, `/lektion/${LEKTION.id}/bearbeiten`);
    await expect(page.getByRole('heading', { level: 1, name: 'Lektion bearbeiten' })).toBeVisible();
    await expect(page.getByText('Keine Änderungen', { exact: true })).toBeVisible();

    // Titel der Lektion
    await page.getByRole('textbox', { name: 'Titel' }).fill(neuerTitel);
    await expect(page.getByText('Ungespeichert', { exact: true })).toBeVisible();

    // Erste Frage des Lernziels «Hardware, Software und Betriebssystem»
    await page.getByRole('tab', { name: /Fragen/ }).click();
    await expect(page.getByRole('tab', { name: /Fragen/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const filter = page.getByRole('combobox', { name: 'Fragen zu Lernziel' });
    const option = await filter.getByRole('option', { name: lernziel }).textContent();
    await filter.selectOption({ label: option! });
    const liste = page.getByRole('list', { name: 'Fragen' });
    await expect(liste.getByRole('listitem')).toHaveCount(15);
    await liste.getByRole('button').first().click();
    const fragetext = page.getByRole('textbox', { name: 'Fragetext' });
    await expect(fragetext).toBeVisible();
    await fragetext.fill(neuerText);

    await page
      .getByRole('region', { name: 'Speichern' })
      .getByRole('button', { name: 'Speichern' })
      .click();
    await expect(page.getByText('Gespeichert.', { exact: true })).toBeVisible();

    // Nach Neuladen noch da (IndexedDB)
    await page.reload();
    await page.getByRole('tab', { name: /Fragen/ }).click();
    await expect(page.getByRole('list', { name: 'Fragen' }).getByText(neuerText)).toBeVisible();

    // Übersicht zeigt den neuen Titel und «Original wiederherstellen»
    await page.getByRole('link', { name: '← Zur Lektion' }).click();
    await expect(page.getByRole('heading', { level: 1, name: neuerTitel })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Original wiederherstellen' })).toBeVisible();

    // Lernrunde zum Lernziel mit allen 15 Fragen: die geänderte Frage kommt vor
    await setzeEinstellung(page, 'Fragen pro Lernrunde', 15);
    await page.goto(`/lektion/${LEKTION.id}/lernen?modus=lernziel&lz=lz-hardware-software`);
    await expect(page.getByText('Frage 1 von 15')).toBeVisible();
    let gefunden = false;
    for (let i = 0; i < 15 && !gefunden; i++) {
      const karte = page.getByRole('article');
      if (await karte.getByText(neuerText).isVisible()) {
        gefunden = true;
        break;
      }
      await beantworte(karte, 'ueben');
      await naechsteFrage(page);
    }
    expect(gefunden, 'geänderte Frage in der Lernrunde').toBe(true);

    // Original wiederherstellen (Bestätigung annehmen)
    await page.goto(`/lektion/${LEKTION.id}`);
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Original wiederherstellen' }).click();
    await expect(page.getByText('Das Original ist wiederhergestellt.')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: LEKTION.titel })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Original wiederherstellen' })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: LEKTION.titel })).toBeVisible();
    await page.goto(`/lektion/${LEKTION.id}/bearbeiten`);
    await page.getByRole('tab', { name: /Fragen/ }).click();
    await expect(page.getByRole('list', { name: 'Fragen' }).getByText(neuerText)).toHaveCount(0);
  });

  test('ungespeicherte Änderungen: Nachfrage beim Verlassen', async ({ page }) => {
    await oeffne(page, `/lektion/${LEKTION.id}/bearbeiten`);
    await page.getByRole('textbox', { name: 'Titel' }).fill('Etwas anderes');
    let meldung = '';
    page.once('dialog', (d) => {
      meldung = d.message();
      void d.dismiss();
    });
    await page.getByRole('link', { name: '← Zur Lektion' }).click();
    await expect.poll(() => meldung).toContain('ungespeicherte Änderungen');
    await expect(page).toHaveURL(`/lektion/${LEKTION.id}/bearbeiten`);
  });
});
