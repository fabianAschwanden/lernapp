import { ergaenzeLektion, validiereLektion } from './lektion-validierung';

type Obj = Record<string, any>;

function minimal(): Obj {
  return {
    id: 'informatik-test-1',
    format: 1,
    version: 1,
    fach: 'Informatik',
    titel: 'Test',
    beschreibung: '',
    quellen: [],
    lernziele: [{ id: 'lz-1', thema: 'Grundlagen', text: 'Ich kann EVA erklären.', zusammenfassung: '' }],
    fragen: [
      {
        id: 'f-1',
        lernzielId: 'lz-1',
        typ: 'wahrfalsch',
        frage: 'Die CPU verarbeitet Daten.',
        erklaerung: 'Sie ist das V in EVA.',
        schwierigkeit: 1,
        richtig: true,
      },
    ],
    herkunft: 'manuell',
    erstelltAm: '2026-10-20T00:00:00.000Z',
  };
}

const fragenBasis = {
  lernzielId: 'lz-1',
  frage: 'Frage?',
  erklaerung: 'Weil.',
  schwierigkeit: 2,
};

/** Gültige Frage je Typ. */
const gueltig: Record<string, Obj> = {
  einfachwahl: { typ: 'einfachwahl', optionen: ['A', 'B'], richtig: 1 },
  mehrfachwahl: { typ: 'mehrfachwahl', optionen: ['A', 'B', 'C'], richtig: [0, 2] },
  wahrfalsch: { typ: 'wahrfalsch', richtig: false },
  zuordnen: {
    typ: 'zuordnen',
    paare: [
      { links: 'Maus', rechts: 'Eingabe' },
      { links: 'Tastatur', rechts: 'Eingabe' },
      { links: 'Drucker', rechts: 'Ausgabe' },
    ],
  },
  reihenfolge: { typ: 'reihenfolge', elemente: ['Eingabe', 'Verarbeitung', 'Ausgabe'] },
  zahl: { typ: 'zahl', richtig: 3.125, toleranz: 0.01, einheit: 'MB' },
  kurzantwort: { typ: 'kurzantwort', akzeptiert: ['USB-C'] },
  offen: { typ: 'offen', musterloesung: 'Weil …', stichworte: ['EVA'] },
};

/** Lektion mit genau einer Frage (Basis + typspezifische Felder). */
function mitFrage(f: Obj): Obj {
  const l = minimal();
  l['fragen'] = [{ id: 'f-x', ...fragenBasis, ...f }];
  return l;
}

/** Erwartet genau eine Fehlermeldung, die den Text enthält. */
function erwarteFehler(daten: unknown, teil: string): void {
  const fehler = validiereLektion(daten);
  expect(fehler.length, JSON.stringify(fehler)).toBeGreaterThan(0);
  expect(fehler.some((m) => m.includes(teil)), JSON.stringify(fehler)).toBe(true);
}

describe('validiereLektion — gültige Lektionen', () => {
  it('akzeptiert eine Minimal-Lektion', () => {
    expect(validiereLektion(minimal())).toEqual([]);
  });

  it('akzeptiert eine Lektion ohne format-Feld und ohne Fragen', () => {
    const l = minimal();
    delete l['format'];
    l['fragen'] = [];
    expect(validiereLektion(l)).toEqual([]);
  });

  it.each(Object.keys(gueltig))('akzeptiert eine gültige Frage vom Typ %s', (typ) => {
    expect(validiereLektion(mitFrage(gueltig[typ]))).toEqual([]);
  });

  it('akzeptiert zahl ohne Toleranz und Toleranz 0', () => {
    expect(validiereLektion(mitFrage({ typ: 'zahl', richtig: 8 }))).toEqual([]);
    expect(validiereLektion(mitFrage({ typ: 'zahl', richtig: -8, toleranz: 0 }))).toEqual([]);
  });
});

describe('validiereLektion — Lektion', () => {
  it.each([[null], [undefined], [42], ['text'], [[]], [[minimal()]]])('lehnt %j ab (kein Objekt)', (daten) => {
    expect(validiereLektion(daten)).toEqual(['Die Datei enthält keine Lektion (kein JSON-Objekt).']);
  });

  it.each(['id', 'fach', 'titel'])('meldet fehlendes oder leeres Feld «%s»', (feld) => {
    const ohne = minimal();
    delete ohne[feld];
    erwarteFehler(ohne, `Feld «${feld}» fehlt.`);
    const leer = minimal();
    leer[feld] = '   ';
    erwarteFehler(leer, `Feld «${feld}» fehlt.`);
  });

  it.each(['Informatik', 'mit leerzeichen', '-vorne', 'ümlaut', 'a_b'])('lehnt die id «%s» ab', (id) => {
    const l = minimal();
    l['id'] = id;
    erwarteFehler(l, 'Kleinbuchstaben, Ziffern und Bindestriche');
  });

  it('meldet ein unbekanntes Format', () => {
    const l = minimal();
    l['format'] = 2;
    erwarteFehler(l, 'Unbekanntes Format 2 (erwartet 1).');
  });

  it('verlangt mindestens ein Lernziel', () => {
    const leer = minimal();
    leer['lernziele'] = [];
    expect(validiereLektion(leer)).toEqual(['Die Lektion braucht mindestens ein Lernziel.']);
    const fehlt = minimal();
    delete fehlt['lernziele'];
    erwarteFehler(fehlt, 'mindestens ein Lernziel');
  });

  it('verlangt die Liste «fragen»', () => {
    const l = minimal();
    l['fragen'] = 'keine';
    expect(validiereLektion(l)).toEqual(['Die Liste «fragen» fehlt.']);
  });
});

describe('validiereLektion — Lernziele', () => {
  const mitLz = (lz: unknown[]): Obj => ({ ...minimal(), lernziele: lz, fragen: [] });
  const lz = { id: 'lz-1', thema: 'T', text: 'Text', zusammenfassung: '' };

  it('meldet ungültige Lernziele', () => {
    erwarteFehler(mitLz([null]), 'Lernziel 1: ungültig.');
    erwarteFehler(mitLz([lz, 'x']), 'Lernziel 2: ungültig.');
  });

  it('meldet fehlende id', () => {
    erwarteFehler(mitLz([{ ...lz, id: '' }]), 'Lernziel 1: id fehlt.');
  });

  it('meldet doppelte id', () => {
    erwarteFehler(mitLz([lz, { ...lz }]), 'Lernziel 2: id «lz-1» doppelt.');
  });

  it('meldet fehlenden Text, Thema und Zusammenfassung', () => {
    erwarteFehler(mitLz([{ ...lz, text: ' ' }]), 'Lernziel 1: Text fehlt.');
    erwarteFehler(mitLz([{ ...lz, thema: undefined }]), 'Lernziel 1: Thema fehlt.');
    erwarteFehler(mitLz([{ ...lz, zusammenfassung: undefined }]), 'Lernziel 1: Zusammenfassung fehlt.');
  });
});

describe('validiereLektion — gemeinsame Fragefelder', () => {
  it('meldet ungültige Fragen', () => {
    const l = minimal();
    l['fragen'] = [42];
    erwarteFehler(l, 'Frage 1: ungültig.');
  });

  it('meldet fehlende Frage-id', () => {
    erwarteFehler(mitFrage({ ...gueltig['wahrfalsch'], id: '' }), 'Frage 1: id fehlt.');
  });

  it('meldet doppelte Frage-id', () => {
    const l = minimal();
    l['fragen'] = [l['fragen'][0], { ...l['fragen'][0] }];
    erwarteFehler(l, 'Frage 2 (f-1): id doppelt.');
  });

  it('meldet ein unbekanntes Lernziel', () => {
    erwarteFehler(mitFrage({ ...gueltig['wahrfalsch'], lernzielId: 'lz-9' }), 'unbekanntes Lernziel «lz-9»');
  });

  it('meldet fehlenden Fragetext', () => {
    erwarteFehler(mitFrage({ ...gueltig['wahrfalsch'], frage: '' }), 'Frage 1 (f-x): Fragetext fehlt.');
  });

  it('meldet fehlende Erklärung', () => {
    erwarteFehler(mitFrage({ ...gueltig['wahrfalsch'], erklaerung: undefined }), 'Erklärung fehlt.');
  });

  it.each([0, 4, '2', undefined, 1.5])('meldet Schwierigkeit %j', (schwierigkeit) => {
    erwarteFehler(mitFrage({ ...gueltig['wahrfalsch'], schwierigkeit }), 'Schwierigkeit muss 1, 2 oder 3 sein.');
  });

  it('meldet einen unbekannten Fragetyp', () => {
    erwarteFehler(mitFrage({ typ: 'lueckentext' }), 'unbekannter Fragetyp «lueckentext».');
    erwarteFehler(mitFrage({}), 'unbekannter Fragetyp «undefined».');
  });

  it('sammelt mehrere Fehler und nennt die Frage', () => {
    const fehler = validiereLektion(mitFrage({ typ: 'einfachwahl', optionen: ['A'], frage: '', schwierigkeit: 9 }));
    expect(fehler.length).toBe(3);
    expect(fehler.every((m) => m.startsWith('Frage 1 (f-x): '))).toBe(true);
  });
});

describe('validiereLektion — Fragetypen', () => {
  const faelle: [string, Obj, string][] = [
    ['einfachwahl: zu wenige Optionen', { typ: 'einfachwahl', optionen: ['A'], richtig: 0 }, 'mindestens zwei Optionen'],
    ['einfachwahl: leere Option', { typ: 'einfachwahl', optionen: ['A', ' '], richtig: 0 }, 'mindestens zwei Optionen'],
    ['einfachwahl: Index zu gross', { typ: 'einfachwahl', optionen: ['A', 'B'], richtig: 2 }, 'zeigt auf keine Option'],
    ['einfachwahl: Index negativ', { typ: 'einfachwahl', optionen: ['A', 'B'], richtig: -1 }, 'zeigt auf keine Option'],
    ['einfachwahl: Index als Text', { typ: 'einfachwahl', optionen: ['A', 'B'], richtig: '1' }, 'zeigt auf keine Option'],
    ['einfachwahl: Optionen doppelt', { typ: 'einfachwahl', optionen: ['A', 'A'], richtig: 0 }, 'Optionen doppelt'],
    ['mehrfachwahl: zu wenige Optionen', { typ: 'mehrfachwahl', optionen: ['A'], richtig: [0] }, 'mindestens zwei Optionen'],
    ['mehrfachwahl: richtig leer', { typ: 'mehrfachwahl', optionen: ['A', 'B'], richtig: [] }, 'gültige, eindeutige'],
    ['mehrfachwahl: richtig keine Liste', { typ: 'mehrfachwahl', optionen: ['A', 'B'], richtig: 1 }, 'gültige, eindeutige'],
    ['mehrfachwahl: Index ausserhalb', { typ: 'mehrfachwahl', optionen: ['A', 'B'], richtig: [0, 2] }, 'gültige, eindeutige'],
    ['mehrfachwahl: Index doppelt', { typ: 'mehrfachwahl', optionen: ['A', 'B'], richtig: [1, 1] }, 'gültige, eindeutige'],
    ['wahrfalsch: kein Boolean', { typ: 'wahrfalsch', richtig: 'true' }, '«richtig» muss true oder false sein.'],
    ['wahrfalsch: fehlt', { typ: 'wahrfalsch' }, '«richtig» muss true oder false sein.'],
    ['zuordnen: nur ein Paar', { typ: 'zuordnen', paare: [{ links: 'A', rechts: 'X' }] }, 'mindestens zwei vollständige Paare'],
    [
      'zuordnen: unvollständiges Paar',
      { typ: 'zuordnen', paare: [{ links: 'A', rechts: 'X' }, { links: 'B' }] },
      'mindestens zwei vollständige Paare',
    ],
    ['zuordnen: keine Liste', { typ: 'zuordnen', paare: 'A=X' }, 'mindestens zwei vollständige Paare'],
    [
      'zuordnen: links doppelt',
      { typ: 'zuordnen', paare: [{ links: 'A', rechts: 'X' }, { links: 'A', rechts: 'Y' }] },
      'linke Seite doppelt',
    ],
    [
      'zuordnen: nur ein rechter Wert',
      { typ: 'zuordnen', paare: [{ links: 'A', rechts: 'X' }, { links: 'B', rechts: 'X' }] },
      'rechts braucht mindestens zwei Werte',
    ],
    ['reihenfolge: zu wenige', { typ: 'reihenfolge', elemente: ['A'] }, 'mindestens zwei Elemente'],
    ['reihenfolge: fehlt', { typ: 'reihenfolge' }, 'mindestens zwei Elemente'],
    ['reihenfolge: doppelt', { typ: 'reihenfolge', elemente: ['A', 'B', 'A'] }, 'Elemente doppelt'],
    ['zahl: Text statt Zahl', { typ: 'zahl', richtig: '3,125' }, '«richtig» muss eine Zahl sein.'],
    ['zahl: nicht endlich', { typ: 'zahl', richtig: Infinity }, '«richtig» muss eine Zahl sein.'],
    ['zahl: negative Toleranz', { typ: 'zahl', richtig: 1, toleranz: -1 }, '«toleranz» muss ≥ 0 sein.'],
    ['zahl: Toleranz als Text', { typ: 'zahl', richtig: 1, toleranz: '0.1' }, '«toleranz» muss ≥ 0 sein.'],
    ['kurzantwort: leer', { typ: 'kurzantwort', akzeptiert: [] }, 'mindestens eine akzeptierte Antwort'],
    ['kurzantwort: leerer Text', { typ: 'kurzantwort', akzeptiert: [''] }, 'mindestens eine akzeptierte Antwort'],
    ['kurzantwort: fehlt', { typ: 'kurzantwort' }, 'mindestens eine akzeptierte Antwort'],
    ['offen: Musterlösung fehlt', { typ: 'offen' }, 'Musterlösung fehlt.'],
    ['offen: Musterlösung leer', { typ: 'offen', musterloesung: '  ' }, 'Musterlösung fehlt.'],
  ];

  it.each(faelle)('%s', (_name, frage, meldung) => {
    erwarteFehler(mitFrage(frage), meldung);
  });

  it('deckt jeden Fragetyp mit mindestens einem Fehlerfall ab', () => {
    const typen = new Set(faelle.map(([, f]) => f['typ']));
    expect([...typen].sort()).toEqual(Object.keys(gueltig).sort());
  });
});

describe('optionale Felder und Bilder', () => {
  it('lässt fehlende optionale Felder zu (werden beim Import ergänzt)', () => {
    const l = minimal();
    delete l['quellen'];
    delete l['beschreibung'];
    expect(validiereLektion(l)).toEqual([]);
  });

  it.each<[string, (l: Obj) => void, string]>([
    ['quellen als Text', (l) => (l['quellen'] = 'Skript'), '«quellen» muss eine Liste'],
    ['quellen ohne Titel', (l) => (l['quellen'] = [{ id: 'q1' }]), '«quellen» muss eine Liste'],
    ['hinweise als Text', (l) => (l['hinweise'] = 'Kein Taschenrechner'), '«hinweise» muss eine Liste'],
    ['beschreibung als Zahl', (l) => (l['beschreibung'] = 5), 'Feld «beschreibung» muss ein Text sein.'],
    ['unbekannte Herkunft', (l) => (l['herkunft'] = 'internet'), 'Unbekannte Herkunft'],
    ['merksaetze mit Zahl', (l) => (l['lernziele'][0].merksaetze = [5]), '«merksaetze» muss eine Liste'],
    ['ergaenzt als Text', (l) => (l['lernziele'][0].ergaenzt = 'ja'), '«ergaenzt» muss true oder false sein.'],
    ['tipp als Zahl', (l) => (l['fragen'][0].tipp = 5), '«tipp» muss ein Text sein.'],
  ])('%s', (_name, aendere, meldung) => {
    const l = minimal();
    aendere(l);
    expect(validiereLektion(l).join(' ')).toContain(meldung);
  });

  it.each([
    'https://tracker.example/q.gif',
    '//tracker.example/q.gif',
    'javascript:alert(1)',
    'data:text/html;base64,PGgxPkhpPC9oMT4=',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'bilder/../../geheim.svg',
    '/bilder/x.svg',
    'andere/x.svg',
  ])('lehnt die Bildquelle «%s» ab', (src) => {
    const l = minimal();
    l['fragen'][0].bild = { src, alt: 'Bild' };
    l['lernziele'][0].bilder = [{ src, alt: 'Bild' }];
    const fehler = validiereLektion(l).join(' ');
    expect(fehler).toContain('Frage 1 (f-1), Bild: Quelle nicht erlaubt');
    expect(fehler).toContain('Lernziel 1, Bild 1: Quelle nicht erlaubt');
  });

  it.each(['bilder/informatik/anschluss-hdmi.svg', 'data:image/jpeg;base64,/9j/4AAQSkZJRg==', 'data:image/png;base64,iVBORw0KGgo='])(
    'erlaubt die Bildquelle «%s»',
    (src) => {
      const l = minimal();
      l['fragen'][0].bild = { src, alt: 'Bild', legende: 'Legende' };
      expect(validiereLektion(l)).toEqual([]);
    },
  );

  it('verlangt einen Alternativtext', () => {
    const l = minimal();
    l['fragen'][0].bild = { src: 'bilder/x.svg' };
    expect(validiereLektion(l).join(' ')).toContain('Alternativtext');
  });
});

describe('ergaenzeLektion', () => {
  it('ergänzt fehlende, vorausgesetzte Felder', () => {
    const l = minimal();
    for (const feld of ['format', 'version', 'beschreibung', 'quellen', 'herkunft', 'erstelltAm']) delete l[feld];
    const jetzt = new Date('2026-10-20T12:00:00Z');
    const e = ergaenzeLektion(l as never, jetzt);
    expect(e).toMatchObject({
      format: 1,
      version: 1,
      beschreibung: '',
      quellen: [],
      herkunft: 'import',
      erstelltAm: jetzt.toISOString(),
    });
    expect(validiereLektion(e)).toEqual([]);
  });
});
