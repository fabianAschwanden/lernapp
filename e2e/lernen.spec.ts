import {
  FIXTURE_ALLE_TYPEN,
  RUECKMELDUNG,
  beantworte,
  LEKTION,
  expect,
  fixtureAlleTypen,
  importiereLektion,
  naechsteFrage,
  oeffne,
  spieleRunde,
  test,
} from './hilfen';

test.describe('Lernrunde', () => {
  test('eine Runde durchspielen, Fortschritt bleibt nach Neuladen', async ({ page }) => {
    await oeffne(page, `/lektion/${LEKTION.id}`);
    await page
      .getByRole('navigation', { name: 'Lernen' })
      .getByRole('link', { name: /^Lernen/ })
      .click();
    await expect(page).toHaveURL(`/lektion/${LEKTION.id}/lernen`);
    await expect(page.getByRole('heading', { level: 1, name: 'Lernen' })).toBeVisible();
    await expect(page.getByText(/Frage 1 von \d+/)).toBeVisible();

    await spieleRunde(page);

    await expect(page.getByRole('heading', { name: 'Runde geschafft!' })).toBeVisible();
    await expect(page.getByText('Dein Stand bei den Lernzielen')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nächste Runde' })).toBeVisible();

    await page.getByRole('link', { name: 'Zur Lektion' }).click();
    await expect(page).toHaveURL(`/lektion/${LEKTION.id}`);
    const stand = page.getByRole('progressbar', { name: 'Gesamtstand' });
    await expect(stand).not.toHaveAttribute('aria-valuenow', '0');
    const prozent = Number(await stand.getAttribute('aria-valuenow'));
    expect(prozent).toBeGreaterThan(0);
    // Mindestens ein Lernziel ist nicht mehr «Noch nicht geübt»
    await expect(
      page.getByRole('progressbar', { name: /^Stand: (Am Lernen|Sitzt fast|Sitzt)$/ }).first(),
    ).toBeVisible();

    // IndexedDB: nach dem Neuladen ist der Lernstand noch da
    await page.reload();
    await expect(page.getByRole('progressbar', { name: 'Gesamtstand' })).toHaveAttribute(
      'aria-valuenow',
      String(prozent),
    );
    await page.goto('/');
    const karte = page
      .getByRole('link', { name: new RegExp(LEKTION.titel) })
      .filter({ has: page.getByRole('progressbar') });
    await expect(karte.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(prozent));
  });

  test('alle Fragetypen lassen sich bedienen (importierte Lektion)', async ({ page }) => {
    await importiereLektion(page, FIXTURE_ALLE_TYPEN, fixtureAlleTypen.titel);
    await page
      .getByRole('navigation', { name: 'Lernen' })
      .getByRole('link', { name: /^Lernen/ })
      .click();
    await expect(page.getByText('Frage 1 von 8')).toBeVisible();

    const typen = await spieleRunde(page);
    expect([...typen].sort()).toEqual(
      [
        'einfachwahl',
        'mehrfachwahl',
        'kurzantwort',
        'offen',
        'reihenfolge',
        'wahrfalsch',
        'zahl',
        'zuordnen',
      ].sort(),
    );
    await expect(page.getByRole('heading', { name: 'Runde geschafft!' })).toBeVisible();
  });

  test('Enter prüft, «Im Lernzettel nachlesen» springt zum Lernziel', async ({ page }) => {
    await importiereLektion(page, FIXTURE_ALLE_TYPEN, fixtureAlleTypen.titel);
    // Lernziel mit Zahl, Kurzantwort und offener Frage
    await page.getByRole('link', { name: 'Üben: Du kannst Speichereinheiten umrechnen.' }).click();
    await expect(page).toHaveURL(/modus=lernziel&lz=lz-einheiten/);
    // Kurzer Titel (Thema), der Lernzieltext steht vollständig darunter
    await expect(page.getByRole('heading', { level: 1, name: 'Üben: Einheiten' })).toBeVisible();
    await expect(page.getByText('Du kannst Speichereinheiten umrechnen.').first()).toBeVisible();
    await expect(page.getByText('Frage 1 von 3')).toBeVisible();

    const karte = page.getByRole('article');
    for (let i = 0; i < 3; i++) {
      const feld = karte.getByRole('textbox', { name: 'Deine Antwort', exact: true });
      if (await feld.isVisible()) {
        await feld.fill('8');
        await feld.press('Enter');
        await expect(karte.getByText(RUECKMELDUNG)).toBeVisible();
        await page.getByRole('link', { name: 'Im Lernzettel nachlesen' }).click();
        await expect(page).toHaveURL(/lernzettel\?lz=lz-einheiten/);
        await expect(
          page.getByRole('region', { name: 'Du kannst Speichereinheiten umrechnen.' }),
        ).toBeInViewport();
        return;
      }
      await beantworte(karte, 'ueben');
      await naechsteFrage(page);
    }
    throw new Error('Keine Frage mit Eingabefeld gefunden');
  });

  test('Tipp lässt sich auf- und zuklappen', async ({ page }) => {
    await importiereLektion(page, FIXTURE_ALLE_TYPEN, fixtureAlleTypen.titel);
    await page.getByRole('link', { name: 'Üben: Du kannst das EVA-Prinzip erklären.' }).click();
    await expect(page.getByText('Frage 1 von 5')).toBeVisible();
    const karte = page.getByRole('article');
    for (let i = 0; i < 5; i++) {
      const tipp = karte.getByRole('button', { name: 'Tipp anzeigen' });
      if (await tipp.isVisible()) {
        await expect(tipp).toHaveAttribute('aria-expanded', 'false');
        await tipp.click();
        await expect(karte.getByText('Was passiert zwischen Eingabe und Ausgabe?')).toBeVisible();
        await karte.getByRole('button', { name: 'Tipp ausblenden' }).click();
        await expect(karte.getByText('Was passiert zwischen Eingabe und Ausgabe?')).toBeHidden();
        return;
      }
      await beantworte(karte, 'ueben');
      await naechsteFrage(page);
    }
    throw new Error('Frage mit Tipp nicht gefunden');
  });
});

test.describe('Fehler wiederholen und Lernziel üben', () => {
  test('Fehler aus der Runde lassen sich wiederholen', async ({ page }) => {
    await importiereLektion(page, FIXTURE_ALLE_TYPEN, fixtureAlleTypen.titel);
    // Ohne Lernstand: keine Fehler
    await page.goto(`/lektion/${fixtureAlleTypen.id}/lernen?modus=fehler`);
    await expect(
      page.getByText('Super, gerade gibt es keine Fehler zu wiederholen.'),
    ).toBeVisible();

    await page.goto(`/lektion/${fixtureAlleTypen.id}/lernen`);
    await spieleRunde(page);
    // Die Beliebig-Antworten treffen sicher nicht alles (z. B. Reihenfolge wird absichtlich falsch gemischt)
    const fehlerKnopf = page.getByRole('button', { name: 'Fehler wiederholen' });
    await expect(fehlerKnopf).toBeVisible();
    await fehlerKnopf.click();
    await expect(page).toHaveURL(/modus=fehler/);
    await expect(page.getByRole('heading', { level: 1, name: 'Fehler wiederholen' })).toBeVisible();
    await expect(page.getByText(/Frage 1 von \d+/)).toBeVisible();
    await spieleRunde(page);

    // Auch über die Lektionsübersicht erreichbar
    await page.goto(`/lektion/${fixtureAlleTypen.id}`);
    const link = page.getByRole('link', { name: /^Fehler wiederholen \(\d+\)/ });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(`/lektion/${fixtureAlleTypen.id}/lernen?modus=fehler`);
    await expect(page.getByRole('article')).toBeVisible();
  });

  test('Lernziel üben (modus=lernziel) fragt nur dieses Lernziel ab', async ({ page }) => {
    await oeffne(page, `/lektion/${LEKTION.id}`);
    const ueben = page.getByRole('link', { name: /^Üben: Unterschied zwischen Arbeitsspeicher/ });
    await ueben.click();
    await expect(page).toHaveURL(
      new RegExp(`/lektion/${LEKTION.id}/lernen\\?modus=lernziel&lz=lz-speicherarten`),
    );
    await expect(
      page.getByRole('heading', { level: 1, name: 'Üben: Bauteile im Computer' }),
    ).toBeVisible();
    await expect(page.getByText(/Lernziel: Unterschied zwischen Arbeitsspeicher/)).toBeVisible();
    await spieleRunde(page);

    await page.getByRole('link', { name: 'Zur Lektion' }).click();
    // Nur das geübte Lernziel hat Fortschritt
    const geuebt = page
      .getByRole('listitem')
      .filter({ hasText: /Unterschied zwischen Arbeitsspeicher/ });
    await expect(geuebt.getByRole('progressbar')).not.toHaveAttribute(
      'aria-label',
      'Stand: Noch nicht geübt',
    );
    await expect(page.getByRole('progressbar', { name: 'Stand: Noch nicht geübt' })).toHaveCount(
      LEKTION.anzahlLernziele - 1,
    );
  });
});
