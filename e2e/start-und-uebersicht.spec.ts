import { ANZAHL_FRAGEN, LEKTION, expect, istHandy, oeffne, test } from './hilfen';

test.describe('Startseite', () => {
  test('zeigt die mitgelieferte Lektion mit 0 % Fortschritt', async ({ page }) => {
    await oeffne(page, '/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Was lernst du heute?' }),
    ).toBeVisible();

    const karte = page
      .getByRole('link', { name: new RegExp(LEKTION.titel) })
      .filter({ has: page.getByRole('progressbar') });
    await expect(karte).toBeVisible();
    await expect(karte.getByRole('progressbar', { name: 'Gesamtstand' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
    await expect(karte.getByText('0 %', { exact: true })).toBeVisible();
    await expect(karte.getByText('13 Lernziele')).toBeVisible();
    await expect(karte.getByText(`${ANZAHL_FRAGEN} Fragen`)).toBeVisible();

    // Weiterlernen-Vorschlag führt direkt in die Lernrunde
    await expect(page.getByRole('link', { name: /Weiterlernen/ })).toHaveAttribute(
      'href',
      `/lektion/${LEKTION.id}/lernen`,
    );

    await karte.click();
    await expect(page).toHaveURL(`/lektion/${LEKTION.id}`);
    await expect(page.getByRole('heading', { level: 1, name: LEKTION.titel })).toBeVisible();
  });

  test('Hauptnavigation oben (PC) bzw. unten (Handy)', async ({ page }, info) => {
    await oeffne(page, '/');
    const kopfNav = page.getByRole('banner').getByRole('navigation', { name: 'Hauptnavigation' });
    const navigationen = page.getByRole('navigation', { name: 'Hauptnavigation' });
    // Genau eine Hauptnavigation ist sichtbar
    await expect(navigationen).toHaveCount(1);

    if (istHandy(info)) {
      await expect(kopfNav).toBeHidden();
      const unten = navigationen;
      const box = await unten.boundingBox();
      const vp = page.viewportSize()!;
      expect(box, 'Navigation unten sichtbar').not.toBeNull();
      expect(box!.y + box!.height).toBeGreaterThanOrEqual(vp.height - 1);
      await unten.getByRole('link', { name: 'Neu' }).click();
      await expect(page).toHaveURL('/neu');
      await expect(unten.getByRole('link', { name: 'Neu' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      // Touch-Ziele mindestens 44 px hoch
      for (const link of await unten.getByRole('link').all()) {
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      await unten.getByRole('link', { name: 'Einstellungen' }).click();
      await expect(page).toHaveURL('/einstellungen');
      await unten.getByRole('link', { name: 'Lektionen' }).click();
      await expect(page).toHaveURL('/');
    } else {
      await expect(kopfNav).toBeVisible();
      await expect(kopfNav.getByRole('link', { name: 'Lektionen' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await kopfNav.getByRole('link', { name: 'Neue Lektion' }).click();
      await expect(page).toHaveURL('/neu');
      await expect(kopfNav.getByRole('link', { name: 'Neue Lektion' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      await expect(kopfNav.getByRole('link', { name: 'Lektionen' })).not.toHaveAttribute(
        'aria-current',
      );
      await expect(page.getByRole('heading', { level: 1, name: 'Neue Lektion' })).toBeVisible();
      await kopfNav.getByRole('link', { name: 'Einstellungen' }).click();
      await expect(page).toHaveURL('/einstellungen');
      await kopfNav.getByRole('link', { name: 'Lektionen' }).click();
      await expect(page).toHaveURL('/');
    }
    // Logo führt immer zur Startseite
    await page.goto('/einstellungen');
    await page.getByRole('link', { name: 'Lernapp – zur Startseite' }).click();
    await expect(page).toHaveURL('/');
  });
});

test.describe('Lektionsübersicht', () => {
  test('13 Lernziele in 4 Themen, Kennzeichen für ergänzte Lernziele und Hinweise zur Prüfung', async ({ page }) => {
    await oeffne(page, `/lektion/${LEKTION.id}`);
    await expect(page.getByRole('heading', { level: 1, name: LEKTION.titel })).toBeVisible();

    // Hinweise zur Prüfung
    const hinweise = page.getByRole('complementary', { name: 'Zur Prüfung' });
    await expect(hinweise).toBeVisible();
    await expect(hinweise.getByRole('listitem')).toHaveCount(3);
    await expect(hinweise).toContainText('Taschenrechner');

    // Gesamtstand 0 %
    await expect(page.getByRole('progressbar', { name: 'Gesamtstand' })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );

    // Themen und Lernziele
    for (const thema of LEKTION.themen) {
      await expect(page.getByRole('region', { name: thema, exact: true })).toBeVisible();
    }
    const themenTitel = page.getByRole('heading', { level: 3 });
    await expect(themenTitel).toHaveText([...LEKTION.themen]);

    const lernziele = page
      .getByRole('listitem')
      .filter({ has: page.getByRole('link', { name: /^Lernzettel: / }) });
    await expect(lernziele).toHaveCount(LEKTION.anzahlLernziele);
    await expect(page.getByRole('link', { name: /^Üben: / })).toHaveCount(LEKTION.anzahlLernziele);

    // Ergänzte Lernziele (nicht im Material: Anschlüsse + Teams/Sicherheit) sichtbar erklärt
    const ERGAENZT = 'nicht in deinen Unterlagen';
    const ergaenzt = page.getByText(ERGAENZT, { exact: true });
    await expect(ergaenzt).toHaveCount(6);
    const anschluesse = page.getByRole('region', { name: 'Anschlüsse', exact: true });
    await expect(anschluesse.getByText(ERGAENZT, { exact: true })).toHaveCount(2);
    const bauteile = page.getByRole('region', { name: 'Bauteile im Computer', exact: true });
    await expect(bauteile.getByText(ERGAENZT, { exact: true })).toHaveCount(0);

    // Aktionen
    for (const name of [/^Lernen/, /^Probeprüfung/, /^Lernzettel Stoff/]) {
      await expect(
        page.getByRole('navigation', { name: 'Lernen' }).getByRole('link', { name }),
      ).toBeVisible();
    }
    // Ohne Lernstand noch kein «Fehler wiederholen»
    await expect(page.getByRole('link', { name: /Fehler wiederholen/ })).toHaveCount(0);
  });

  test('unbekannte Lektion zeigt eine Meldung', async ({ page }) => {
    await oeffne(page, '/lektion/gibt-es-nicht');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Lektion nicht gefunden' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Zur Startseite', exact: true }).click();
    await expect(page).toHaveURL('/');
  });
});
