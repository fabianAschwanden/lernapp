import { writeFileSync } from 'node:fs';

import { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';

import {
  ANZAHL_FRAGEN,
  FIXTURE_ALLE_TYPEN,
  Konto,
  LEKTION,
  RUECKMELDUNG,
  beantworte,
  expect,
  fixtureAlleTypen,
  freigabeEntziehen,
  freigeben,
  importiereLektion,
  meldeAn,
  neueTestperson,
  oeffne,
  pruefeKeinHorizontalesScrollen,
  test,
} from './hilfen';

const NICHT_FREIGEGEBEN =
  'Deine Google-Adresse ist für die Lernapp nicht freigegeben. Frag die Person, die dir die Lernapp gegeben hat, ob sie freigeschaltet werden kann – oder melde dich mit einer anderen Google-Adresse an.';

/** Google-Anmeldeseite abfangen (kein echter Aufruf). */
async function googleAttrappe(context: BrowserContext): Promise<void> {
  await context.route('https://accounts.google.com/**', (r) =>
    r.fulfill({ contentType: 'text/html', body: '<h1>Google (Attrappe)</h1>' }),
  );
}

/** Zweites Gerät (eigener Browser-Kontext, eigene IndexedDB) derselben oder einer anderen Person. */
async function geraet(
  browser: Browser,
  konto: Konto,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await meldeAn(context, konto);
  return { context, page: await context.newPage() };
}

/** Wartet in den Einstellungen, bis der Ausgang leer und alles beim Server ist. */
async function warteBisSynchron(page: Page): Promise<void> {
  await oeffne(page, '/einstellungen');
  await expect(page.getByText('Alles synchronisiert', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

/** Anzahl Einträge je IndexedDB-Store und die Schlüssel der Einstellungen. */
async function lokaleDaten(page: Page): Promise<Record<string, number | string[]>> {
  return page.evaluate(
    () =>
      new Promise<Record<string, number | string[]>>((ok, fehler) => {
        const a = indexedDB.open('lernapp');
        a.onerror = () => fehler(a.error);
        a.onsuccess = () => {
          const db = a.result;
          const namen = [...db.objectStoreNames];
          const tx = db.transaction(namen, 'readonly');
          const ergebnis: Record<string, number | string[]> = {};
          for (const n of namen) {
            const r =
              n === 'einstellungen' ? tx.objectStore(n).getAllKeys() : tx.objectStore(n).count();
            r.onsuccess = () => {
              ergebnis[n] =
                n === 'einstellungen'
                  ? (r.result as IDBValidKey[]).map(String)
                  : (r.result as number);
            };
          }
          tx.oncomplete = () => {
            db.close();
            ok(ergebnis);
          };
        };
      }),
  );
}

/** Beantwortet die erste Frage der mitgelieferten Lektion (erzeugt Lernstand). */
async function beantworteEineFrage(page: Page): Promise<void> {
  await oeffne(page, `/lektion/${LEKTION.id}/lernen`);
  const karte = page.getByRole('article');
  await beantworte(karte, 'ueben');
  await expect(karte.getByText(RUECKMELDUNG)).toBeVisible();
}

function zweitePerson(info: TestInfo): Konto {
  return neueTestperson(info, 'Zweite Person');
}

test.describe('Anmeldung', () => {
  test.use({ anmelden: false });

  test('ohne Anmeldung: Umleitung auf die Anmeldeseite mit Rücksprung', async ({ page }) => {
    await page.goto(`/lektion/${LEKTION.id}/lernzettel`);
    await expect(page).toHaveURL(
      `/anmelden?zurueck=${encodeURIComponent(`/lektion/${LEKTION.id}/lernzettel`)}`,
    );
    await expect(
      page.getByRole('heading', { level: 1, name: 'Willkommen bei der Lernapp' }),
    ).toBeVisible();
    const link = page.getByRole('link', { name: 'Mit Google anmelden' });
    await expect(link).toHaveAttribute(
      'href',
      `/api/auth/google/start?zurueck=${encodeURIComponent(`/lektion/${LEKTION.id}/lernzettel`)}`,
    );
    await expect(
      page.getByRole('heading', { level: 2, name: 'Was gespeichert wird' }),
    ).toBeVisible();
    await expect(
      page.getByText(/Claude-API-Schlüssel .* bleibt nur auf deinem Gerät/),
    ).toBeVisible();
    // Ohne Anmeldung keine App-Navigation
    await expect(page.getByRole('link', { name: 'Einstellungen' })).toHaveCount(0);
    await pruefeKeinHorizontalesScrollen(page, '/anmelden');

    // Startseite ebenfalls geschützt, Rücksprung dann ohne Parameter
    await page.goto('/');
    await expect(page).toHaveURL('/anmelden');
    await expect(page.getByRole('link', { name: 'Mit Google anmelden' })).toHaveAttribute(
      'href',
      '/api/auth/google/start?zurueck=%2F',
    );
  });

  test('Fehlertexte je ?fehler=', async ({ page }) => {
    const faelle: [string, string][] = [
      ['nicht-freigegeben', NICHT_FREIGEGEBEN],
      ['abgebrochen', 'Die Anmeldung wurde abgebrochen. Du kannst es gleich nochmals versuchen.'],
      ['fehler', 'Bei der Anmeldung ist etwas schiefgegangen. Versuch es bitte nochmals.'],
      ['unbekannt', 'Bei der Anmeldung ist etwas schiefgegangen. Versuch es bitte nochmals.'],
    ];
    for (const [code, text] of faelle) {
      await page.goto(`/anmelden?fehler=${code}`);
      await expect(page.getByRole('alert')).toHaveText(text);
    }
    await page.goto('/anmelden');
    await expect(page.getByRole('link', { name: 'Mit Google anmelden' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('Google-Rückruf ohne gültigen Zustand führt zu «abgebrochen»', async ({ page }) => {
    await page.goto('/api/auth/google/callback?code=x&state=gefaelscht');
    await expect(page).toHaveURL('/anmelden?fehler=abgebrochen');
    await expect(page.getByRole('alert')).toHaveText(
      'Die Anmeldung wurde abgebrochen. Du kannst es gleich nochmals versuchen.',
    );
  });

  test('nicht freigegebene Adresse bekommt keine Sitzung', async ({ page, context }, info) => {
    const fremd = neueTestperson(info, 'Fremd');
    const antwort = await context.request.post('/api/test/anmelden', {
      headers: { 'X-Lernapp': '1' },
      data: fremd,
    });
    expect(antwort.status()).toBe(403);
    expect((await antwort.json()).fehler).toBe('nicht-freigegeben');
    await page.goto('/');
    await expect(page).toHaveURL('/anmelden');
    await expect(page.getByRole('link', { name: 'Mit Google anmelden' })).toBeVisible();
  });

  test('Freigabe entzogen: Zugang ist sofort weg', async ({ page, context, beobachtung }, info) => {
    const konto = neueTestperson(info);
    await meldeAn(context, konto);
    await oeffne(page, '/');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Was lernst du heute?' }),
    ).toBeVisible();

    freigabeEntziehen(konto.email);
    // Der Server lehnt jetzt jede Anfrage dieser Sitzung ab (401 nicht-freigegeben).
    beobachtung.erlaubt.push(/\/api\/(ich|sync)(\?|$)/);
    await page.reload();
    await expect(page).toHaveURL(/\/anmelden/);
    await expect(page.getByRole('alert')).toHaveText(NICHT_FREIGEGEBEN);
    await expect(page.getByRole('link', { name: 'Mit anderem Google-Konto anmelden' })).toBeVisible();
    // Auch nach erneuter Freigabe bleibt die alte Sitzung gelöscht.
    freigeben(konto.email);
    const ich = await context.request.get('/api/ich');
    expect(ich.status()).toBe(401);
  });
});

test.describe('Synchronisation', () => {
  test('Lernstand und Lektionen gehen von Gerät A zu Gerät B und zurück', async ({
    page,
    browser,
    konto,
  }) => {
    test.setTimeout(60_000);
    await beantworteEineFrage(page);
    await warteBisSynchron(page);

    const b = await geraet(browser, konto!);
    await oeffne(b.page, `/lektion/${LEKTION.id}`);
    // Eine Frage hat Lernstand → eine weniger «neu»
    await expect(
      b.page.getByRole('link', { name: new RegExp(`^Lernen ${ANZAHL_FRAGEN - 1} neu`) }),
    ).toBeVisible();

    // Gegenrichtung: B importiert eine Lektion, A sieht sie nach dem Synchronisieren
    await importiereLektion(b.page, FIXTURE_ALLE_TYPEN, fixtureAlleTypen.titel);
    await warteBisSynchron(b.page);
    await page.getByRole('button', { name: 'Jetzt synchronisieren' }).click();
    await oeffne(page, '/');
    await expect(
      page.getByRole('link', { name: new RegExp(fixtureAlleTypen.titel) }).first(),
    ).toBeVisible();
    await b.context.close();
  });

  test('zwei Personen sehen die Daten der anderen nicht', async ({ page, browser }, info) => {
    await importiereLektion(page, FIXTURE_ALLE_TYPEN, fixtureAlleTypen.titel);
    await warteBisSynchron(page);

    const andere = await geraet(browser, zweitePerson(info));
    await oeffne(andere.page, '/');
    await expect(
      andere.page.getByRole('link', { name: new RegExp(LEKTION.titel) }).first(),
    ).toBeVisible();
    await expect(andere.page.getByText(fixtureAlleTypen.titel)).toHaveCount(0);
    const sync = await andere.context.request.get('/api/sync?seit=0');
    expect(sync.status()).toBe(200);
    expect((await sync.json()).datensaetze).not.toContainEqual(
      expect.objectContaining({ art: 'lektion' }),
    );
    await andere.context.close();
  });

  test('meldet sich auf dem Gerät eine andere Person an, verschwinden die lokalen Daten', async ({
    page,
    context,
  }, info) => {
    await importiereLektion(page, FIXTURE_ALLE_TYPEN, fixtureAlleTypen.titel);
    await warteBisSynchron(page);

    // Gleicher Browser, neue Sitzung einer anderen Person (z. B. nach Ablauf der Sitzung)
    await meldeAn(context, zweitePerson(info));
    await oeffne(page, '/');
    // Die App startet kurz mit den alten Daten, erkennt die andere Person und lädt neu.
    await expect
      .poll(async () => (await lokaleDaten(page).catch(() => null))?.['lektionen'], { timeout: 15_000 })
      .toBe(0);
    await expect(page.getByRole('link', { name: new RegExp(LEKTION.titel) }).first()).toBeVisible();
    await expect(page.getByText(fixtureAlleTypen.titel)).toHaveCount(0);
  });
});

test.describe('Abmelden', () => {
  test('entfernt alle lokalen Daten, auf dem Server bleiben sie', async ({
    page,
    context,
    konto,
    beobachtung,
  }) => {
    await importiereLektion(page, FIXTURE_ALLE_TYPEN, fixtureAlleTypen.titel);
    await beantworteEineFrage(page);
    // API-Schlüssel nur auf dem Gerät — muss beim Abmelden ebenfalls weg
    await page.evaluate(
      () =>
        new Promise<void>((ok, fehler) => {
          const a = indexedDB.open('lernapp');
          a.onsuccess = () => {
            const tx = a.result.transaction('einstellungen', 'readwrite');
            tx.objectStore('einstellungen').put('sk-ant-test', 'anthropicApiKey');
            tx.oncomplete = () => {
              a.result.close();
              ok();
            };
            tx.onerror = () => fehler(tx.error);
          };
        }),
    );

    await oeffne(page, '/einstellungen');
    await expect(page.getByText(`Angemeldet als ${konto!.email}`)).toBeVisible();
    await expect(page.getByText(`Angemeldet als ${konto!.email} (`)).toBeVisible();
    await page.getByRole('button', { name: 'Abmelden …' }).click();
    await expect(page.getByText(/von diesem Gerät entfernt/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abbrechen' })).toBeFocused();
    beobachtung.erlaubt.push(/\/api\/ich$/);
    await page.getByRole('button', { name: 'Ja, abmelden' }).click();
    await expect(page).toHaveURL('/anmelden');
    await expect(page.getByRole('link', { name: 'Mit Google anmelden' })).toBeVisible();

    const daten = await lokaleDaten(page);
    for (const store of [
      'lektionen',
      'fortschritt',
      'pruefungen',
      'rueckmeldungen',
      'ausgang',
      'syncstand',
    ]) {
      expect(daten[store], store).toBe(0);
    }
    expect(daten['einstellungen']).not.toContain('anthropicApiKey');
    expect(daten['einstellungen']).not.toContain('konto');
    expect((await context.request.get('/api/ich')).status()).toBe(401);
    await page.goto('/einstellungen');
    await expect(page).toHaveURL(/\/anmelden\?zurueck=%2Feinstellungen/);

    // Wieder anmelden: Die Daten kommen vom Server zurück.
    await meldeAn(context, konto!);
    await oeffne(page, '/');
    await expect(
      page.getByRole('link', { name: new RegExp(fixtureAlleTypen.titel) }).first(),
    ).toBeVisible();
    await oeffne(page, `/lektion/${LEKTION.id}`);
    // Eine Frage hat Lernstand → eine weniger «neu»
    await expect(
      page.getByRole('link', { name: new RegExp(`^Lernen ${ANZAHL_FRAGEN - 1} neu`) }),
    ).toBeVisible();
  });
});

test.describe('Umzug von der Version ohne Server', () => {
  test.use({ anmelden: false });

  test('lokale Daten vor der ersten Anmeldung werden hochgeladen', async ({
    page,
    context,
    browser,
  }, info) => {
    test.setTimeout(60_000);
    // Gleiche Herkunft, aber ohne App: DB in Version 2 wie vor der Synchronisation anlegen
    await page.goto('/manifest.webmanifest');
    await page.evaluate(
      async ({ lektion }) => {
        const db = await new Promise<IDBDatabase>((ok, fehler) => {
          const a = indexedDB.open('lernapp', 2);
          a.onupgradeneeded = () => {
            const d = a.result;
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
            d.createObjectStore('rueckmeldungen', { keyPath: 'id' });
          };
          a.onsuccess = () => ok(a.result);
          a.onerror = () => fehler(a.error);
        });
        await new Promise<void>((ok, fehler) => {
          const tx = db.transaction(['lektionen', 'einstellungen'], 'readwrite');
          tx.objectStore('lektionen').put(lektion);
          tx.objectStore('einstellungen').put('sk-ant-alt', 'anthropicApiKey');
          tx.objectStore('einstellungen').put(
            { rundenGroesse: 7, farbschema: 'dunkel' },
            'einstellungen',
          );
          tx.oncomplete = () => ok();
          tx.onerror = () => fehler(tx.error);
        });
        db.close();
      },
      { lektion: fixtureAlleTypen },
    );

    const konto = neueTestperson(info);
    await meldeAn(context, konto);
    await oeffne(page, '/');
    await expect(
      page.getByRole('link', { name: new RegExp(fixtureAlleTypen.titel) }).first(),
    ).toBeVisible();
    await warteBisSynchron(page);
    // Alles angenommen (auch die Einstellungen ohne eigenen Zeitstempel)
    await expect(page.getByText(/nicht angenommen/)).toHaveCount(0);

    // Auf einem zweiten Gerät sind Lektion und Einstellungen da, API-Schlüssel und Farbschema nicht.
    const b = await geraet(browser, konto);
    await oeffne(b.page, '/');
    await expect(
      b.page.getByRole('link', { name: new RegExp(fixtureAlleTypen.titel) }).first(),
    ).toBeVisible();
    const sync = (await (await b.context.request.get('/api/sync?seit=0')).json()) as {
      datensaetze: { art: string; schluessel: string }[];
    };
    expect(sync.datensaetze).toContainEqual(
      expect.objectContaining({ art: 'lektion', schluessel: fixtureAlleTypen.id }),
    );
    expect(JSON.stringify(sync)).not.toContain('sk-ant-alt');
    expect(JSON.stringify(sync)).not.toContain('farbschema');
    await oeffne(b.page, '/einstellungen');
    await expect(b.page.getByLabel('Fragen pro Lernrunde')).toHaveValue('7');
    await b.context.close();
  });
});

test.describe('Anmeldung ohne Netz', () => {
  test.use({ anmelden: false });

  test('ohne Verbindung kein Google-Link, sondern «Nochmals versuchen»', async ({ page, beobachtung }) => {
    beobachtung.erlaubt.push(/\/api\/ich$/);
    await page.route('**/api/ich', (r) => r.abort());
    await page.goto('/anmelden');
    await expect(page.getByText(/Die Lernapp ist gerade nicht erreichbar/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Mit Google anmelden' })).toHaveCount(0);
    const nochmals = page.getByRole('button', { name: 'Nochmals versuchen' });
    await expect(nochmals).toBeVisible();
    await page.unroute('**/api/ich');
    await nochmals.click();
    await expect(page.getByRole('link', { name: 'Mit Google anmelden' })).toBeVisible();
  });
});

test.describe('Sitzung abgelaufen', () => {
  test('während der Probeprüfung: kein Verlassen-Dialog, Hinweis, Navigation bleibt', async ({
    page,
    context,
    beobachtung,
  }) => {
    const dialoge: string[] = [];
    page.on('dialog', (d) => {
      dialoge.push(d.message());
      void d.dismiss();
    });
    await oeffne(page, `/lektion/${LEKTION.id}/pruefung`);
    await page.getByRole('button', { name: 'Probeprüfung starten' }).click();
    const karte = page.getByRole('article');
    await beantworte(karte, 'pruefung');

    // Sitzung weg (z. B. abgelaufen): der nächste Abgleich bekommt 401.
    beobachtung.erlaubt.push(/\/api\/(sync|ich)/);
    await context.clearCookies();
    await page.evaluate(() => window.dispatchEvent(new Event('online')));

    await expect(page.getByText('Deine Anmeldung ist abgelaufen. Was du machst, bleibt auf diesem Gerät gespeichert.')).toBeVisible();
    await expect(page).toHaveURL(`/lektion/${LEKTION.id}/pruefung`);
    await expect(karte).toBeVisible();
    await expect(page.getByRole('link', { name: /Nicht übertragen/ })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Hauptnavigation' }).first()).toBeAttached();
    expect(dialoge).toEqual([]);

    // «Neu anmelden» führt zum Google-Start (Rücksprung auf die Prüfung)
    await googleAttrappe(context);
    page.removeAllListeners('dialog');
    page.on('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Neu anmelden' }).click();
    await expect(page).toHaveURL(/^https:\/\/accounts\.google\.com\//);
  });
});

test.describe('Abmelden: Sonderfälle', () => {
  test('Lektion über 5 MB: Warnung mit Namen vor dem Abmelden', async ({ page, beobachtung }, info) => {
    test.setTimeout(60_000);
    const gross = structuredClone(fixtureAlleTypen) as typeof fixtureAlleTypen & {
      lernziele: { bilder?: { src: string; alt: string }[] }[];
    };
    gross.id = 'riesige-lektion';
    gross.titel = 'Riesige Lektion';
    gross.lernziele[0].bilder = [{ src: 'data:image/png;base64,' + 'A'.repeat(5_600_000), alt: 'Buchseite' }];
    const datei = info.outputPath('riesig.json');
    writeFileSync(datei, JSON.stringify(gross));
    await importiereLektion(page, datei, gross.titel);
    await oeffne(page, '/einstellungen');
    await expect(page.getByText(/Die Lektion «Riesige Lektion» ist zu gross für die Synchronisation/)).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: 'Abmelden …' }).click();
    const warnung = page.getByRole('alert');
    await expect(warnung.getByText('Die Lektion «Riesige Lektion» ist zu gross für den Server')).toBeVisible();
    await expect(warnung.getByRole('button', { name: 'Backup exportieren' })).toBeVisible();
    beobachtung.erlaubt.push(/\/api\/ich$/);
    await page.getByRole('button', { name: 'Trotzdem abmelden' }).click();
    await expect(page).toHaveURL('/anmelden');
  });

  test('Server-Fehler beim Abgleich: Begründung «Server», nicht «offline»', async ({ page, beobachtung }) => {
    await beantworteEineFrage(page);
    beobachtung.erlaubt.push(/\/api\/sync/);
    await page.route('**/api/sync**', (r) =>
      r.fulfill({ status: 500, contentType: 'application/json', body: '{"fehler":"server","meldung":"kaputt"}' }),
    );
    await oeffne(page, '/einstellungen');
    const hoeheVorher = (await page.getByRole('banner').boundingBox())?.height;
    await page.getByRole('button', { name: 'Abmelden …' }).click();
    await page.getByRole('button', { name: 'Ja, abmelden' }).click();
    await expect(page.getByRole('alert').getByText(/der Server hat einen Fehler gemeldet/)).toBeVisible();
    await expect(page.getByRole('alert').getByText(/offline/)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Trotzdem abmelden' })).toBeVisible();
    // Hinweis im Kopf, ohne dass der Kopf höher wird
    await expect(page.getByRole('link', { name: /Nicht übertragen/ })).toBeVisible();
    expect((await page.getByRole('banner').boundingBox())?.height).toBe(hoeheVorher);
  });

  test('auf allen Geräten abmelden beendet auch die Sitzung des anderen Geräts', async ({
    page,
    browser,
    konto,
    beobachtung,
  }) => {
    const b = await geraet(browser, konto!);
    expect((await b.context.request.get('/api/ich')).status()).toBe(200);

    await oeffne(page, '/einstellungen');
    await page.getByRole('button', { name: 'Abmelden …' }).click();
    beobachtung.erlaubt.push(/\/api\/ich$/);
    await page.getByRole('button', { name: 'Auf allen Geräten abmelden' }).click();
    await expect(page).toHaveURL('/anmelden');
    expect((await b.context.request.get('/api/ich')).status()).toBe(401);
    await b.context.close();
  });
});

test.describe('Mehrere Tabs und Geräte', () => {
  test('Personenwechsel in einem anderen Tab: dieser Tab lädt neu, nichts landet im falschen Konto', async ({
    page,
    context,
    beobachtung,
  }, info) => {
    test.setTimeout(60_000);
    await beantworteEineFrage(page);
    await warteBisSynchron(page);
    await oeffne(page, `/lektion/${LEKTION.id}/lernen`);

    // Zweiter Tab: abmelden, dann meldet sich eine andere Person an.
    beobachtung.erlaubt.push(/\/api\/(ich|sync)/);
    const tab2 = await context.newPage();
    await oeffne(tab2, '/einstellungen');
    await tab2.getByRole('button', { name: 'Abmelden …' }).click();
    await tab2.getByRole('button', { name: 'Ja, abmelden' }).click();
    await expect(tab2).toHaveURL('/anmelden');
    // Tab 1 wurde neu geladen und ist abgemeldet
    await expect(page).toHaveURL(/\/anmelden/, { timeout: 10_000 });

    const b = zweitePerson(info);
    await meldeAn(context, b);
    await oeffne(tab2, '/einstellungen');
    await expect(tab2.getByText(`Angemeldet als ${b.email}`)).toBeVisible();
    await oeffne(page, '/einstellungen');
    await expect(page.getByText(`Angemeldet als ${b.email}`)).toBeVisible();
    await expect(page.getByText('Alles synchronisiert', { exact: true })).toBeVisible({ timeout: 15_000 });
    const sync = (await (await context.request.get('/api/sync?seit=0')).json()) as { datensaetze: { art: string }[] };
    expect(sync.datensaetze.filter((d) => d.art === 'fortschritt')).toEqual([]);
  });

  test('Start mit früherer Anmeldung wartet nicht auf den Server', async ({ page }) => {
    await oeffne(page, '/');
    await warteBisSynchron(page);
    await page.route('**/api/ich', async (r) => {
      await new Promise((ok) => setTimeout(ok, 4000));
      await r.continue().catch(() => undefined);
    });
    const start = Date.now();
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Was lernst du heute?' })).toBeVisible();
    expect(Date.now() - start).toBeLessThan(1500);
  });

  test('Backup-Import überschreibt keine neueren Stände auf dem Server', async ({
    page,
    browser,
    konto,
  }, info) => {
    test.setTimeout(90_000);
    // Gerät B ist angemeldet, hat aber die folgenden Änderungen von A noch nicht geholt.
    const b = await geraet(browser, konto!);
    await oeffne(b.page, '/einstellungen');

    // Gerät A: Lektion anlegen (Server-Stand jetzt) und eine Probeprüfung auf dem Server löschen
    await importiereLektion(page, FIXTURE_ALLE_TYPEN, fixtureAlleTypen.titel);
    await warteBisSynchron(page);
    const grab = await page.context().request.post('/api/sync', {
      headers: { 'X-Lernapp': '1' },
      data: {
        datensaetze: [
          { art: 'pruefung', schluessel: 'p-geloescht', daten: null, geaendertAm: new Date().toISOString(), geloescht: true },
        ],
      },
    });
    expect(grab.status()).toBe(200);

    // Gerät B importiert ein altes Backup: ältere Fassung derselben Lektion, die gelöschte Prüfung
    const alt = { ...fixtureAlleTypen, titel: 'Alte Fassung aus dem Backup', geaendertAm: '2026-01-01T00:00:00.000Z' };
    const backup = {
      app: 'lernapp',
      format: 1,
      erstelltAm: '2026-01-02T00:00:00.000Z',
      lektionen: [alt],
      fortschritt: [],
      pruefungen: [
        { id: 'p-geloescht', lektionId: alt.id, am: '2026-01-01T00:00:00.000Z', punkte: 1, maxPunkte: 2, note: 4, dauerSekunden: 60, proLernziel: {} },
      ],
      rueckmeldungen: [],
      einstellungen: {},
    };
    const datei = info.outputPath('altes-backup.json');
    writeFileSync(datei, JSON.stringify(backup));
    const chooser = b.page.waitForEvent('filechooser');
    await b.page.getByText('Backup importieren', { exact: true }).click();
    await (await chooser).setFiles(datei);
    await expect(b.page.getByText('Backup importiert.')).toBeVisible();

    // B lädt hoch, der Server antwortet «veraltet» mit seinem Stand, B übernimmt ihn.
    await expect
      .poll(async () => (await lokaleDaten(b.page))['pruefungen'], { timeout: 20_000 })
      .toBe(0);
    await expect(b.page.getByText('Alles synchronisiert', { exact: true })).toBeVisible({ timeout: 15_000 });
    const sync = (await (await b.context.request.get('/api/sync?seit=0')).json()) as {
      datensaetze: { art: string; schluessel: string; daten: { titel?: string } | null; geloescht: boolean }[];
    };
    const lektion = sync.datensaetze.find((d) => d.art === 'lektion' && d.schluessel === fixtureAlleTypen.id);
    expect(lektion?.daten?.titel).toBe(fixtureAlleTypen.titel);
    expect(sync.datensaetze.find((d) => d.schluessel === 'p-geloescht')?.geloescht).toBe(true);
    await oeffne(b.page, '/');
    await expect(b.page.getByRole('link', { name: new RegExp(fixtureAlleTypen.titel) }).first()).toBeVisible();
    await expect(b.page.getByText('Alte Fassung aus dem Backup')).toHaveCount(0);
    await b.context.close();
  });
});
