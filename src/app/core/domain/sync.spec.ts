import {
  SyncDatensatz,
  URZEIT,
  bildePakete,
  erzeugeStempelGeber,
  istFernNeuer,
  naechsterStempel,
  planeAnwendung,
  syncId,
  umzugStempel,
} from './sync';

const T1 = '2026-10-01T10:00:00.000Z';
const T2 = '2026-10-01T10:00:00.001Z';

function ds(teil: Partial<SyncDatensatz> & Pick<SyncDatensatz, 'schluessel'>): SyncDatensatz {
  return { art: 'fortschritt', daten: { x: 1 }, geaendertAm: T2, geloescht: false, ...teil };
}

describe('istFernNeuer (last write wins)', () => {
  it('Server gewinnt ohne oder mit vergessenem lokalem Stand', () => {
    expect(istFernNeuer(T1, undefined)).toBe(true);
    expect(istFernNeuer(URZEIT, '')).toBe(true);
  });
  it('nur echt neuere Server-Stände gewinnen, Gleichstand bleibt lokal', () => {
    expect(istFernNeuer(T2, T1)).toBe(true);
    expect(istFernNeuer(T1, T2)).toBe(false);
    expect(istFernNeuer(T1, T1)).toBe(false);
  });
  it('vergleicht Zeitpunkte, nicht Zeichenketten', () => {
    expect(istFernNeuer('2026-10-01T12:00:00.000+02:00', '2026-10-01T09:59:59.999Z')).toBe(true);
    expect(istFernNeuer('2026-10-01T12:00:00.000+02:00', '2026-10-01T10:00:00.000Z')).toBe(false);
  });
  it('unbrauchbarer Server-Zeitstempel verliert gegen einen lokalen Stand', () => {
    expect(istFernNeuer('kaputt', T1)).toBe(false);
  });
});

describe('bildePakete', () => {
  const bytes = (n: number) => n;

  it('teilt nach Anzahl', () => {
    const { pakete } = bildePakete([1, 1, 1, 1, 1], bytes, { maxAnzahl: 2 });
    expect(pakete).toEqual([[1, 1], [1, 1], [1]]);
  });

  it('teilt nach Bytes; ein grosser Datensatz bekommt ein eigenes Paket', () => {
    const { pakete, zuGross } = bildePakete([4, 4, 3, 12, 1], bytes, { maxBytes: 10, maxDatensatz: 20 });
    expect(pakete).toEqual([[4, 4], [3], [12], [1]]);
    expect(zuGross).toEqual([]);
  });

  it('lässt Datensätze über dem Server-Limit weg', () => {
    const { pakete, zuGross } = bildePakete([1, 30, 2], bytes, { maxBytes: 10, maxDatensatz: 20 });
    expect(pakete).toEqual([[1, 2]]);
    expect(zuGross).toEqual([30]);
  });

  it('leere Liste ergibt keine Pakete', () => {
    expect(bildePakete([], bytes).pakete).toEqual([]);
  });
});

describe('planeAnwendung', () => {
  const alles = (d: SyncDatensatz) => d.daten;

  it('übernimmt nur neuere Datensätze und führt die Stände nach', () => {
    const staende = new Map<string, string | undefined>([
      [syncId('fortschritt', 'a'), T1],
      [syncId('fortschritt', 'b'), T2],
    ]);
    const { anwenden } = planeAnwendung(
      [ds({ schluessel: 'a' }), ds({ schluessel: 'b', geaendertAm: T1 }), ds({ schluessel: 'c' })],
      staende,
      alles,
    );
    expect(anwenden.map((a) => a.schluessel)).toEqual(['a', 'c']);
    expect(staende.get(syncId('fortschritt', 'a'))).toBe(T2);
    expect(staende.get(syncId('fortschritt', 'b'))).toBe(T2);
  });

  it('Grabstein ergibt eine Löschung, ohne die Daten zu prüfen', () => {
    const pruefe = vi.fn(() => null);
    const { anwenden } = planeAnwendung([ds({ schluessel: 'a', daten: null, geloescht: true })], new Map(), pruefe);
    expect(anwenden).toEqual([{ id: 'fortschritt::a', art: 'fortschritt', schluessel: 'a', geaendertAm: T2, wert: null }]);
    expect(pruefe).not.toHaveBeenCalled();
  });

  it('ungültige Daten werden übersprungen und gemeldet; der lokale Stand bleibt', () => {
    const staende = new Map<string, string | undefined>();
    const { anwenden, ungueltig } = planeAnwendung([ds({ schluessel: 'a' })], staende, () => null);
    expect(anwenden).toEqual([]);
    expect(ungueltig).toHaveLength(1);
    expect(staende.has('fortschritt::a')).toBe(false);
  });

  it('bei doppelt gelieferten Datensätzen gilt der neueste', () => {
    const { anwenden } = planeAnwendung(
      [
        ds({ schluessel: 'a', geaendertAm: T1, daten: 'alt' }),
        ds({ schluessel: 'a', geaendertAm: T2, daten: 'neu' }),
        ds({ schluessel: 'a', geaendertAm: T1, daten: 'veraltet' }),
      ],
      new Map(),
      alles,
    );
    expect(anwenden).toHaveLength(1);
    expect(anwenden[0].wert).toBe('neu');
  });

  it('gerätebezogene Einstellungen: weder Werte noch Grabsteine vom Server', () => {
    const staende = new Map<string, string | undefined>();
    const pruefe = vi.fn((d: SyncDatensatz) => d.daten);
    const { anwenden, ungueltig } = planeAnwendung(
      [
        ds({ art: 'einstellung', schluessel: 'anthropicApiKey', daten: null, geloescht: true }),
        ds({ art: 'einstellung', schluessel: 'konto', daten: null, geloescht: true }),
        ds({ art: 'einstellung', schluessel: 'anthropicApiKey', daten: 'sk-ant-boese' }),
      ],
      staende,
      pruefe,
    );
    expect(anwenden).toEqual([]);
    expect(ungueltig.map((d) => d.schluessel)).toEqual(['anthropicApiKey', 'konto', 'anthropicApiKey']);
    expect(staende.size).toBe(0);
    expect(pruefe).not.toHaveBeenCalled();
  });

  it('Grabstein für die synchronisierten Einstellungen wird weiterhin angewendet', () => {
    const { anwenden } = planeAnwendung(
      [ds({ art: 'einstellung', schluessel: 'einstellungen', daten: null, geloescht: true })],
      new Map(),
      () => null,
    );
    expect(anwenden).toEqual([{ id: 'einstellung::einstellungen', art: 'einstellung', schluessel: 'einstellungen', geaendertAm: T2, wert: null }]);
  });

  it('bereinigte Werte aus pruefe werden übernommen', () => {
    const { anwenden } = planeAnwendung([ds({ schluessel: 'a', daten: { x: 1, boese: true } })], new Map(), () => ({
      x: 1,
    }));
    expect(anwenden[0].wert).toEqual({ x: 1 });
  });
});

describe('umzugStempel', () => {
  it('nimmt den eigenen Stand des Datensatzes', () => {
    expect(umzugStempel('lektion', { erstelltAm: T1, geaendertAm: T2 })).toBe(T2);
    expect(umzugStempel('lektion', { erstelltAm: T1 })).toBe(T1);
    expect(umzugStempel('rueckmeldung', { erstelltAm: T1 })).toBe(T1);
    expect(umzugStempel('fortschritt', { zuletzt: '2026-10-01T12:00:00+02:00' })).toBe(T1);
    expect(umzugStempel('pruefung', { am: T2 })).toBe(T2);
  });
  it('Einstellungen und Datensätze ohne Zeitstempel verlieren gegen alles', () => {
    expect(umzugStempel('einstellung', { kiModell: 'x' })).toBe(URZEIT);
    expect(umzugStempel('fortschritt', {})).toBe(URZEIT);
    expect(umzugStempel('pruefung', null)).toBe(URZEIT);
    // Der Server ersetzt Zeitstempel vor 2000 durch «jetzt» (api/lib/sync.php) — URZEIT liegt genau darauf.
    expect(URZEIT).toBe('2000-01-01T00:00:00.000Z');
  });
});

describe('erzeugeStempelGeber', () => {
  it('liefert streng steigende Zeitstempel, auch in derselben Millisekunde', () => {
    const gib = erzeugeStempelGeber(() => Date.parse(T1));
    expect([gib(), gib(), gib()]).toEqual([T1, T2, '2026-10-01T10:00:00.002Z']);
  });
});

describe('naechsterStempel (kausal monoton)', () => {
  it('ohne bekannten Stand: jetzt', () => {
    expect(naechsterStempel(T1, undefined)).toBe(T1);
    expect(naechsterStempel(T1, '')).toBe(T1);
  });
  it('Stand vom Server aus der Zukunft (Uhr eines anderen Geräts geht vor): knapp danach', () => {
    const zukunft = '2026-10-01T10:03:00.000Z';
    const b = naechsterStempel(T1, zukunft);
    expect(b).toBe('2026-10-01T10:03:00.001Z');
    expect(istFernNeuer(zukunft, b)).toBe(false); // eigene Änderung gilt als neuer
  });
  it('älterer Stand: jetzt', () => {
    expect(naechsterStempel(T2, T1)).toBe(T2);
  });
  it('gleicher Stand: 1 ms danach', () => {
    expect(naechsterStempel(T1, T1)).toBe(T2);
  });
  it('unbrauchbarer Stand: jetzt', () => {
    expect(naechsterStempel(T1, 'kaputt')).toBe(T1);
  });
});
