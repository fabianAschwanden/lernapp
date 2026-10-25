import { bereinigeId, parseKiJson, schneideJson, wandleKiAntwort } from './ki-umwandlung';
import { KiFrage, KiLektion } from './ki-schema';

function kiFrage(teil: Partial<KiFrage>): KiFrage {
  return {
    id: 'f-1',
    lernzielId: 'lz-eva',
    typ: 'einfachwahl',
    frage: 'Frage?',
    erklaerung: 'Darum.',
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

function kiLektion(fragen: KiFrage[]): KiLektion {
  return {
    fach: 'Informatik',
    titel: 'Grundlagen',
    beschreibung: 'EVA und Speicher.',
    hinweise: ['Kein Taschenrechner erlaubt'],
    lernziele: [
      {
        id: 'lz-eva',
        thema: 'Grundlagen',
        text: 'Du kannst das EVA-Prinzip erklären.',
        zusammenfassung: '### EVA',
        merksaetze: ['E → V → A'],
        quellenhinweis: null,
        ergaenzt: false,
      },
      {
        id: 'LZ Speicher',
        thema: 'Speicher',
        text: 'Du kannst Speichereinheiten umrechnen.',
        zusammenfassung: '',
        merksaetze: [],
        quellenhinweis: 'Skript S. 11',
        ergaenzt: true,
      },
    ],
    kurzfassung: '',
    fragen,
  };
}

const opt = {
  idFuer: (t: string) => bereinigeId(t, 'lektion-', 1),
  jetzt: new Date('2026-10-20T10:00:00Z'),
};

describe('wandleKiAntwort', () => {
  it('übernimmt die Kurzfassung (getrimmt) und lässt eine leere weg', () => {
    const fragen = [kiFrage({ optionen: ['A', 'B'], richtigIndex: 0 })];
    const mit = wandleKiAntwort(
      { ...kiLektion(fragen), kurzfassung: '\n## EVA\n> Merke: E → V → A\n  ' },
      opt,
    );
    expect(mit.fehler).toEqual([]);
    expect(mit.lektion?.kurzfassung).toBe('## EVA\n> Merke: E → V → A');
    for (const leer of ['', '   ', null, 42]) {
      const ohne = wandleKiAntwort({ ...kiLektion(fragen), kurzfassung: leer }, opt);
      expect(ohne.lektion && 'kurzfassung' in ohne.lektion).toBe(false);
    }
  });

  it('wandelt alle acht Fragetypen ins Lektionsformat um', () => {
    const fragen = [
      kiFrage({
        id: 'f-a',
        typ: 'einfachwahl',
        optionen: ['A', 'B', 'C'],
        richtigIndex: 2,
        tipp: 'Denk nach',
      }),
      kiFrage({
        id: 'f-b',
        typ: 'mehrfachwahl',
        optionen: ['A', 'B', 'C'],
        richtigIndizes: [0, 2],
      }),
      kiFrage({ id: 'f-c', typ: 'wahrfalsch', richtigBool: false }),
      kiFrage({
        id: 'f-d',
        typ: 'zuordnen',
        paare: [
          { links: 'Maus', rechts: 'Eingabe' },
          { links: 'Drucker', rechts: 'Ausgabe' },
        ],
      }),
      kiFrage({ id: 'f-e', typ: 'reihenfolge', elemente: ['E', 'V', 'A'] }),
      kiFrage({
        id: 'f-f',
        lernzielId: 'LZ Speicher',
        typ: 'zahl',
        richtigZahl: 1024,
        einheit: 'KB',
        toleranz: null,
      }),
      kiFrage({ id: 'f-g', typ: 'kurzantwort', akzeptiert: ['CPU', 'Prozessor'] }),
      kiFrage({ id: 'f-h', typ: 'offen', musterloesung: 'So.', stichworte: ['Eingabe'] }),
    ];
    const { lektion, verworfen, fehler } = wandleKiAntwort(kiLektion(fragen), opt);

    expect(fehler).toEqual([]);
    expect(verworfen).toEqual([]);
    expect(lektion).not.toBeNull();
    const l = lektion!;
    expect(l.id).toBe('grundlagen');
    expect(l.format).toBe(1);
    expect(l.version).toBe(1);
    expect(l.herkunft).toBe('ki');
    expect(l.erstelltAm).toBe('2026-10-20T10:00:00.000Z');
    expect(l.fragen.length).toBe(8);

    expect(l.fragen[0]).toEqual({
      id: 'f-a',
      lernzielId: 'lz-eva',
      typ: 'einfachwahl',
      frage: 'Frage?',
      erklaerung: 'Darum.',
      schwierigkeit: 1,
      tipp: 'Denk nach',
      optionen: ['A', 'B', 'C'],
      richtig: 2,
    });
    expect(l.fragen[1]).toMatchObject({ richtig: [0, 2] });
    expect(l.fragen[2]).toMatchObject({ richtig: false });
    expect(l.fragen[5]).toEqual({
      id: 'f-f',
      lernzielId: 'lz-speicher',
      typ: 'zahl',
      frage: 'Frage?',
      erklaerung: 'Darum.',
      schwierigkeit: 1,
      richtig: 1024,
      einheit: 'KB',
    });
    expect(l.fragen[7]).toMatchObject({ musterloesung: 'So.', stichworte: ['Eingabe'] });
    // keine null-Felder und keine fremden Felder
    for (const f of l.fragen) {
      expect(Object.values(f)).not.toContain(null);
      expect(f).not.toHaveProperty('richtigIndex');
      expect('optionen' in f).toBe(f.typ === 'einfachwahl' || f.typ === 'mehrfachwahl');
      expect('paare' in f).toBe(f.typ === 'zuordnen');
    }
  });

  it('bereinigt Lernziel-ids und übernimmt optionale Lernzielfelder nur, wenn gesetzt', () => {
    const { lektion } = wandleKiAntwort(kiLektion([]), opt);
    const [eva, speicher] = lektion!.lernziele;
    expect(eva.id).toBe('lz-eva');
    expect(eva).not.toHaveProperty('ergaenzt');
    expect(eva).not.toHaveProperty('quellenhinweis');
    expect(speicher.id).toBe('lz-speicher');
    expect(speicher.ergaenzt).toBe(true);
    expect(speicher.quellenhinweis).toBe('Skript S. 11');
    expect(speicher).not.toHaveProperty('merksaetze');
  });

  it('verwirft ungültige einzelne Fragen und zählt sie', () => {
    const fragen = [
      kiFrage({ id: 'ok', optionen: ['A', 'B'], richtigIndex: 0 }),
      kiFrage({ id: 'index-falsch', optionen: ['A', 'B'], richtigIndex: 5 }),
      kiFrage({
        id: 'lz-fehlt',
        lernzielId: 'lz-gibts-nicht',
        typ: 'wahrfalsch',
        richtigBool: true,
      }),
      kiFrage({ id: 'offen-leer', typ: 'offen', musterloesung: null }),
    ];
    const { lektion, verworfen, fehler } = wandleKiAntwort(kiLektion(fragen), opt);
    expect(fehler).toEqual([]);
    expect(lektion!.fragen.map((f) => f.id)).toEqual(['ok']);
    expect(verworfen.map((v) => v.nummer)).toEqual([2, 3, 4]);
    expect(verworfen[0].gruende[0]).toContain('«richtig»');
    expect(verworfen[1].gruende[0]).toContain('unbekanntes Lernziel');
  });

  it('macht doppelte Fragen-ids eindeutig und vergibt fehlende ids', () => {
    const fragen = [
      kiFrage({ id: 'f-1', typ: 'wahrfalsch', richtigBool: true }),
      kiFrage({ id: 'f-1', typ: 'wahrfalsch', richtigBool: false }),
      kiFrage({ id: '', typ: 'wahrfalsch', richtigBool: true }),
      kiFrage({ id: 'Frage Nr. 4', typ: 'wahrfalsch', richtigBool: true }),
    ];
    const { lektion } = wandleKiAntwort(kiLektion(fragen), opt);
    expect(lektion!.fragen.map((f) => f.id)).toEqual(['f-1', 'f-1-2', 'f-eva-03', 'frage-nr-4']);
  });

  it('akzeptiert auch das echte Lektionsformat (Antwort aus claude.ai)', () => {
    const daten = {
      fach: 'Informatik',
      titel: 'Test',
      lernziele: [{ id: 'lz-a', thema: 'T', text: 'Ziel', zusammenfassung: 'x' }],
      fragen: [
        {
          id: 'f-1',
          lernzielId: 'lz-a',
          typ: 'einfachwahl',
          frage: '?',
          optionen: ['a', 'b'],
          richtig: 1,
          erklaerung: 'e',
          schwierigkeit: 2,
        },
        {
          id: 'f-2',
          lernzielId: 'lz-a',
          typ: 'wahrfalsch',
          frage: '?',
          richtig: true,
          erklaerung: 'e',
          schwierigkeit: 1,
        },
        {
          id: 'f-3',
          lernzielId: 'lz-a',
          typ: 'zahl',
          frage: '?',
          richtig: '8',
          erklaerung: 'e',
          schwierigkeit: '1',
        },
      ],
    };
    const { lektion, verworfen, fehler } = wandleKiAntwort(daten, opt);
    expect(fehler).toEqual([]);
    expect(verworfen).toEqual([]);
    expect(lektion!.fragen[0]).toMatchObject({ richtig: 1 });
    expect(lektion!.fragen[2]).toMatchObject({ richtig: 8, schwierigkeit: 1 });
  });

  it('Vorgaben der Person haben Vorrang, Hinweise werden ohne Doppel zusammengeführt', () => {
    const { lektion } = wandleKiAntwort(kiLektion([]), {
      ...opt,
      fach: 'Mathematik',
      titel: 'Prüfung 2',
      klasse: '1a',
      lehrperson: ' Frau Muster ',
      pruefungsdatum: '2026-11-03',
      hinweise: ['kein taschenrechner erlaubt', 'Formelblatt erlaubt'],
      quellen: [{ id: 'q1', titel: 'Skript.pdf', umfang: 'PDF-Seiten 9–11' }],
    });
    expect(lektion!.fach).toBe('Mathematik');
    expect(lektion!.titel).toBe('Prüfung 2');
    expect(lektion!.id).toBe('pruefung-2');
    expect(lektion!.klasse).toBe('1a');
    expect(lektion!.lehrperson).toBe('Frau Muster');
    expect(lektion!.pruefungsdatum).toBe('2026-11-03');
    expect(lektion!.hinweise).toEqual(['kein taschenrechner erlaubt', 'Formelblatt erlaubt']);
    expect(lektion!.quellen).toEqual([
      { id: 'q1', titel: 'Skript.pdf', umfang: 'PDF-Seiten 9–11' },
    ]);
  });

  it('meldet Lernziele ohne Fragen und weggelassene Lernziele', () => {
    const daten = kiLektion([kiFrage({ typ: 'wahrfalsch', richtigBool: true })]);
    (daten.lernziele as unknown[]).push({ id: 'leer', thema: '', text: '  ' });
    const { hinweise, lektion } = wandleKiAntwort(daten, opt);
    expect(lektion!.lernziele.length).toBe(2);
    expect(hinweise.some((h) => h.includes('Lernziel 3'))).toBe(true);
    expect(
      hinweise.some((h) => h.includes('Speichereinheiten') && h.includes('keine Fragen')),
    ).toBe(true);
  });

  it('liefert Fehler statt Lektion, wenn die Antwort kein Objekt ist', () => {
    const { lektion, fehler } = wandleKiAntwort([1, 2], opt);
    expect(lektion).toBeNull();
    expect(fehler.length).toBe(1);
  });

  it('meldet über validiereLektion, wenn kein Lernziel übrig bleibt', () => {
    const { lektion, fehler } = wandleKiAntwort(
      { fach: 'X', titel: 'Y', lernziele: [], fragen: [] },
      opt,
    );
    expect(lektion).not.toBeNull();
    expect(fehler).toContain('Die Lektion braucht mindestens ein Lernziel.');
  });
});

describe('bereinigeId', () => {
  it('erzeugt kebab-case mit Umlauten als ae/oe/ue', () => {
    expect(bereinigeId('Prüfung Größe', 'x-', 1)).toBe('pruefung-groesse');
    expect(bereinigeId('  ', 'f-', 7)).toBe('f-7');
  });
});

describe('schneideJson / parseKiJson', () => {
  it('schneidet JSON aus Codeblock und Fliesstext', () => {
    expect(schneideJson('Hier ist die Lektion:\n```json\n{"a":1}\n```\nViel Erfolg!')).toBe(
      '{"a":1}',
    );
    expect(schneideJson('Gerne! {"a":{"b":2}} Fertig.')).toBe('{"a":{"b":2}}');
    expect(schneideJson('kein json')).toBeNull();
  });

  it('wirft verständliche Fehler', () => {
    expect(() => parseKiJson('nichts')).toThrow(/kein JSON-Objekt/);
    expect(() => parseKiJson('{"a": ')).toThrow(/kein JSON-Objekt/);
    expect(() => parseKiJson('{"a": [1,}')).toThrow(/kein gültiges JSON/);
    expect(parseKiJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });
});

describe('Bilder in der KI-Antwort', () => {
  it('lässt fremde Bildadressen weg und meldet das', () => {
    const daten = kiLektion([
      kiFrage({ typ: 'wahrfalsch', richtigBool: true }),
    ]) as unknown as Record<string, any>;
    daten['fragen'][0].bild = { src: 'https://tracker.example/q.gif', alt: 'x' };
    daten['lernziele'][0].bilder = [
      { src: 'https://tracker.example/p.gif', alt: 'x' },
      { src: 'bilder/informatik/eva.svg', alt: 'EVA', legende: null },
    ];
    const { lektion, hinweise, fehler } = wandleKiAntwort(daten, opt);
    expect(fehler).toEqual([]);
    expect(lektion!.fragen[0]).not.toHaveProperty('bild');
    expect(lektion!.lernziele[0].bilder).toEqual([{ src: 'bilder/informatik/eva.svg', alt: 'EVA' }]);
    expect(hinweise.join(' ')).toContain('2 Bilder mit fremder Adresse wurden weggelassen');
  });
});
