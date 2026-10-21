import { FrageFortschritt, neuerFortschritt } from '../models/fortschritt.model';
import { Frage, Lektion } from '../models/lektion.model';
import {
  FortschrittMap,
  INTERVALL_MS,
  Zufall,
  istFaellig,
  lektionAnteil,
  lernzielStaende,
  mische,
  stufeAusAnteil,
  verbucheAntwort,
  waehleFragen,
  waehlePruefung,
} from './planer';

const TAG = 24 * 60 * 60 * 1000;
const STUNDE = 60 * 60 * 1000;
const LEK = 'lek';

/** Lokale Zeit, bewusst weit weg von der Sommerzeit-Umstellung. */
const JETZT = new Date(2026, 10, 2, 10, 0, 0);

function frage(id: string, lernzielId: string, schwierigkeit: 1 | 2 | 3 = 1): Frage {
  return { id, lernzielId, typ: 'wahrfalsch', frage: id, erklaerung: '', schwierigkeit, richtig: true };
}

function lektion(fragen: Frage[], lernzielIds = ['a', 'b', 'c']): Lektion {
  return {
    id: LEK,
    format: 1,
    version: 1,
    fach: 'Informatik',
    titel: 'Test',
    beschreibung: '',
    quellen: [],
    lernziele: lernzielIds.map((id) => ({ id, thema: 'T', text: id, zusammenfassung: '' })),
    fragen,
    herkunft: 'manuell',
    erstelltAm: '2026-01-01T00:00:00.000Z',
  };
}

function fs(frageId: string, fach: number, extra: Partial<FrageFortschritt> = {}): FrageFortschritt {
  return { ...neuerFortschritt(LEK, frageId), fach, ...extra };
}

/** Fällig seit einer Stunde. */
function faellig(frageId: string, fach: number, extra: Partial<FrageFortschritt> = {}): FrageFortschritt {
  return fs(frageId, fach, { faelligAb: new Date(JETZT.getTime() - STUNDE).toISOString(), ...extra });
}

/** Erst morgen wieder fällig. */
function spaeter(frageId: string, fach: number, extra: Partial<FrageFortschritt> = {}): FrageFortschritt {
  return fs(frageId, fach, { faelligAb: new Date(JETZT.getTime() + TAG).toISOString(), ...extra });
}

function karte(...eintraege: FrageFortschritt[]): FortschrittMap {
  return new Map(eintraege.map((e) => [e.schluessel, e]));
}

/** Einfacher, reproduzierbarer Zufallsgenerator (LCG). */
function seeded(seed: number): Zufall {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const ids = (fragen: Frage[]) => fragen.map((f) => f.id);

describe('mische', () => {
  it('liefert eine Permutation und verändert die Eingabe nicht', () => {
    const quelle = [1, 2, 3, 4, 5];
    const ergebnis = mische(quelle, seeded(7));
    expect(quelle).toEqual([1, 2, 3, 4, 5]);
    expect([...ergebnis].sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('ist mit eigener Zufallsfunktion deterministisch', () => {
    expect(mische([1, 2, 3], () => 0.999)).toEqual([1, 2, 3]);
    expect(mische([1, 2, 3], () => 0)).toEqual([2, 3, 1]);
    expect(mische([1, 2, 3, 4, 5, 6], seeded(42))).toEqual(mische([1, 2, 3, 4, 5, 6], seeded(42)));
  });
});

describe('verbucheAntwort', () => {
  it('neu und richtig → Fach 2, fällig in einem Tag', () => {
    const neu = verbucheAntwort(fs('f', 0), 'richtig', JETZT);
    expect(neu.fach).toBe(2);
    expect(neu.richtig).toBe(1);
    expect(neu.falsch).toBe(0);
    expect(neu.zuletzt).toBe(JETZT.toISOString());
    expect(neu.faelligAb).toBe(new Date(JETZT.getTime() + TAG).toISOString());
    expect(neu.verlauf).toEqual(['richtig']);
  });

  it('richtig schiebt ein Fach weiter, höchstens bis 5', () => {
    expect(verbucheAntwort(fs('f', 1), 'richtig', JETZT).fach).toBe(2);
    expect(verbucheAntwort(fs('f', 2), 'richtig', JETZT).fach).toBe(3);
    expect(verbucheAntwort(fs('f', 4), 'richtig', JETZT).fach).toBe(5);
    expect(verbucheAntwort(fs('f', 5), 'richtig', JETZT).fach).toBe(5);
  });

  it('setzt faelligAb gemäss Intervall des neuen Fachs', () => {
    for (const [alt, neuFach] of [
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 5],
    ]) {
      const neu = verbucheAntwort(fs('f', alt), 'richtig', JETZT);
      expect(neu.faelligAb).toBe(new Date(JETZT.getTime() + INTERVALL_MS[neuFach]).toISOString());
    }
    expect(INTERVALL_MS[3]).toBe(3 * TAG);
    expect(INTERVALL_MS[5]).toBe(14 * TAG);
  });

  it('teilweise behält das Fach (mindestens 1) und zählt weder richtig noch falsch', () => {
    const a = verbucheAntwort(fs('f', 3, { richtig: 2, falsch: 1 }), 'teilweise', JETZT);
    expect(a.fach).toBe(3);
    expect(a.richtig).toBe(2);
    expect(a.falsch).toBe(1);
    expect(a.verlauf).toEqual(['teilweise']);
    expect(verbucheAntwort(fs('f', 0), 'teilweise', JETZT).fach).toBe(1);
  });

  it('falsch → zurück in Fach 1 und sofort wieder fällig', () => {
    const a = verbucheAntwort(fs('f', 4, { richtig: 3 }), 'falsch', JETZT);
    expect(a.fach).toBe(1);
    expect(a.falsch).toBe(1);
    expect(a.richtig).toBe(3);
    expect(a.faelligAb).toBe(JETZT.toISOString());
    expect(istFaellig(a, JETZT)).toBe(true);
  });

  it('deckelt die nächste Wiederholung am Vortag der Prüfung', () => {
    // Fach 5 = 14 Tage → wäre nach der Prüfung am 10.11.
    const a = verbucheAntwort(fs('f', 4), 'richtig', JETZT, '2026-11-10');
    expect(a.faelligAb).toBe(new Date(2026, 10, 9, 0, 0, 0).toISOString());
  });

  it('lässt frühere Wiederholungen vor dem Vortag unverändert', () => {
    const a = verbucheAntwort(fs('f', 2), 'richtig', JETZT, '2026-11-10');
    expect(a.faelligAb).toBe(new Date(JETZT.getTime() + 3 * TAG).toISOString());
  });

  it('deckelt nicht, wenn der Vortag schon vorbei oder die Prüfung vorüber ist', () => {
    const amVortag = new Date(2026, 10, 9, 10, 0, 0);
    const a = verbucheAntwort(fs('f', 4), 'richtig', amVortag, '2026-11-10');
    expect(a.faelligAb).toBe(new Date(amVortag.getTime() + 14 * TAG).toISOString());
    const b = verbucheAntwort(fs('f', 4), 'richtig', JETZT, '2026-10-01');
    expect(b.faelligAb).toBe(new Date(JETZT.getTime() + 14 * TAG).toISOString());
  });

  it('behält höchstens die letzten 5 Ergebnisse im Verlauf', () => {
    const alt = fs('f', 2, { verlauf: ['falsch', 'richtig', 'richtig', 'teilweise', 'richtig'] });
    const a = verbucheAntwort(alt, 'falsch', JETZT);
    expect(a.verlauf).toEqual(['richtig', 'richtig', 'teilweise', 'richtig', 'falsch']);
  });

  it('verändert den alten Fortschritt nicht', () => {
    const alt = fs('f', 2, { verlauf: ['richtig'] });
    const kopie = structuredClone(alt);
    verbucheAntwort(alt, 'falsch', JETZT, '2026-11-10');
    expect(alt).toEqual(kopie);
  });
});

describe('istFaellig', () => {
  it('neue Fragen sind immer fällig', () => {
    expect(istFaellig(fs('f', 0, { faelligAb: new Date(JETZT.getTime() + TAG).toISOString() }), JETZT)).toBe(true);
  });
  it('ohne faelligAb fällig', () => {
    expect(istFaellig(fs('f', 3), JETZT)).toBe(true);
  });
  it('vergleicht faelligAb mit jetzt (Grenze eingeschlossen)', () => {
    expect(istFaellig(fs('f', 3, { faelligAb: JETZT.toISOString() }), JETZT)).toBe(true);
    expect(istFaellig(faellig('f', 3), JETZT)).toBe(true);
    expect(istFaellig(spaeter('f', 3), JETZT)).toBe(false);
  });
});

describe('waehleFragen', () => {
  // f1: Fach 1 fällig (Stufe 1) · f2/f3: neu (Stufe 2) · f4/f5: fällig (Stufe 3) · f6–f8: nicht fällig (Stufe 4)
  const fragen = [
    frage('f1', 'a'),
    frage('f2', 'b', 2),
    frage('f3', 'a', 1),
    frage('f4', 'c'),
    frage('f5', 'b'),
    frage('f6', 'a'),
    frage('f7', 'c'),
    frage('f8', 'b'),
  ];
  const lek = lektion(fragen);
  const map = karte(
    faellig('f1', 1, { verlauf: ['falsch'] }),
    faellig('f4', 3, { verlauf: ['richtig'] }),
    faellig('f5', 2, { verlauf: ['richtig', 'teilweise'] }),
    spaeter('f6', 4, { zuletzt: '2026-10-01T00:00:00.000Z', verlauf: ['richtig'] }),
    spaeter('f7', 4, { zuletzt: '2026-10-20T00:00:00.000Z', verlauf: ['richtig'] }),
    spaeter('f8', 2, { zuletzt: '2026-11-01T00:00:00.000Z', verlauf: ['falsch', 'richtig'] }),
  );

  it('ordnet nach Dringlichkeit: Fach-1-fällig, neu (leicht zuerst), fällig (tiefes Fach zuerst), Rest', () => {
    for (const seed of [1, 2, 3, 99]) {
      const r = waehleFragen(lek, map, { anzahl: 8, jetzt: JETZT, zufall: seeded(seed) });
      expect(ids(r)).toEqual(['f1', 'f3', 'f2', 'f5', 'f4', 'f8', 'f6', 'f7']);
    }
  });

  it('begrenzt auf die gewünschte Anzahl', () => {
    expect(ids(waehleFragen(lek, map, { anzahl: 3, jetzt: JETZT, zufall: seeded(1) }))).toEqual(['f1', 'f3', 'f2']);
    expect(waehleFragen(lek, map, { anzahl: 0, jetzt: JETZT })).toEqual([]);
  });

  it('liefert bei grosser Anzahl jede Frage genau einmal', () => {
    const r = waehleFragen(lek, map, { anzahl: 100, jetzt: JETZT, zufall: seeded(5) });
    expect(r.length).toBe(fragen.length);
    expect(new Set(ids(r)).size).toBe(fragen.length);
  });

  it('filtert nach Lernziel', () => {
    const r = waehleFragen(lek, map, { anzahl: 10, lernzielId: 'a', jetzt: JETZT, zufall: seeded(1) });
    expect(ids(r)).toEqual(['f1', 'f3', 'f6']);
  });

  it('nurFehler: nur Fragen, die zuletzt falsch oder teilweise waren', () => {
    const r = waehleFragen(lek, map, { anzahl: 10, nurFehler: true, jetzt: JETZT, zufall: seeded(1) });
    expect(ids(r)).toEqual(['f1', 'f5']);
  });

  it('nurFehler und Lernziel kombiniert', () => {
    const r = waehleFragen(lek, map, { anzahl: 10, nurFehler: true, lernzielId: 'b', jetzt: JETZT });
    expect(ids(r)).toEqual(['f5']);
  });

  it('wechselt innerhalb einer Stufe die Lernziele ab (Reissverschluss)', () => {
    const l = lektion([frage('a1', 'a'), frage('a2', 'a'), frage('b1', 'b'), frage('b2', 'b'), frage('c1', 'c')]);
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = waehleFragen(l, new Map(), { anzahl: 5, jetzt: JETZT, zufall: seeded(seed) });
      const lz = r.map((f) => f.lernzielId);
      for (let i = 1; i < lz.length; i++) expect(lz[i]).not.toBe(lz[i - 1]);
      expect(new Set(lz.slice(0, 3)).size).toBe(3);
    }
  });

  it('ist bei gleicher Zufallsfunktion reproduzierbar und nutzt sie', () => {
    const l = lektion(Array.from({ length: 6 }, (_, i) => frage(`n${i}`, 'a')));
    const r1 = ids(waehleFragen(l, new Map(), { anzahl: 6, jetzt: JETZT, zufall: seeded(11) }));
    const r2 = ids(waehleFragen(l, new Map(), { anzahl: 6, jetzt: JETZT, zufall: seeded(11) }));
    expect(r1).toEqual(r2);
    const ohne = ids(waehleFragen(l, new Map(), { anzahl: 6, jetzt: JETZT, zufall: () => 0.999 }));
    expect(ohne).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5']);
    const mitNull = ids(waehleFragen(l, new Map(), { anzahl: 6, jetzt: JETZT, zufall: () => 0 }));
    expect(mitNull).not.toEqual(ohne);
  });
});

describe('waehlePruefung', () => {
  const fragen = [
    frage('a1', 'a'),
    frage('a2', 'a'),
    frage('a3', 'a'),
    frage('a4', 'a'),
    frage('b1', 'b'),
    frage('c1', 'c'),
    frage('c2', 'c'),
    frage('x1', 'unbekannt'),
  ];
  const lek = lektion(fragen, ['a', 'b', 'c', 'd']);

  it('deckt alle Lernziele mit Fragen ab, sobald die Anzahl reicht', () => {
    for (const seed of [1, 2, 3, 4]) {
      const r = waehlePruefung(lek, 3, seeded(seed));
      expect(r.length).toBe(3);
      expect(new Set(r.map((f) => f.lernzielId))).toEqual(new Set(['a', 'b', 'c']));
    }
  });

  it('verteilt weitere Fragen reihum auf die Lernziele', () => {
    const r = waehlePruefung(lek, 5, seeded(9));
    const zaehle = (lz: string) => r.filter((f) => f.lernzielId === lz).length;
    expect(r.length).toBe(5);
    expect([zaehle('a'), zaehle('b'), zaehle('c')]).toEqual([2, 1, 2]);
  });

  it('liefert höchstens alle Fragen der Lernziele, ohne Doppelte', () => {
    const r = waehlePruefung(lek, 100, seeded(3));
    expect(r.length).toBe(7);
    expect(new Set(ids(r)).size).toBe(7);
    expect(ids(r)).not.toContain('x1');
  });

  it('liefert nichts bei Anzahl 0', () => {
    expect(waehlePruefung(lek, 0, seeded(1))).toEqual([]);
  });

  it('ist mit eigener Zufallsfunktion reproduzierbar', () => {
    expect(ids(waehlePruefung(lek, 6, seeded(21)))).toEqual(ids(waehlePruefung(lek, 6, seeded(21))));
  });
});

describe('stufeAusAnteil', () => {
  it('neu, wenn keine Fragen oder alle neu sind', () => {
    expect(stufeAusAnteil(0, 0, 0)).toBe('neu');
    expect(stufeAusAnteil(0, 4, 4)).toBe('neu');
  });
  it('Schwellen 0.5 und 0.8', () => {
    expect(stufeAusAnteil(0.1, 3, 4)).toBe('am-lernen');
    expect(stufeAusAnteil(0.49, 0, 4)).toBe('am-lernen');
    expect(stufeAusAnteil(0.5, 0, 4)).toBe('fast');
    expect(stufeAusAnteil(0.79, 0, 4)).toBe('fast');
    expect(stufeAusAnteil(0.8, 0, 4)).toBe('sitzt');
    expect(stufeAusAnteil(1, 0, 4)).toBe('sitzt');
  });
});

describe('lernzielStaende', () => {
  const lek = lektion([frage('a1', 'a'), frage('a2', 'a'), frage('b1', 'b'), frage('b2', 'b')]);

  it('berechnet Anteil, Stufe und Zähler pro Lernziel', () => {
    const map = karte(
      faellig('a1', 1, { verlauf: ['falsch'] }),
      spaeter('a2', 5, { verlauf: ['richtig'] }),
      spaeter('b1', 5, { verlauf: ['richtig'] }),
      spaeter('b2', 3, { verlauf: ['teilweise'] }),
    );
    const [a, b, c] = lernzielStaende(lek, map, JETZT);

    expect(a.lernziel.id).toBe('a');
    expect(a.anzahlFragen).toBe(2);
    expect(a.anteil).toBeCloseTo((1 / 5 + 5 / 5) / 2);
    expect(a.stufe).toBe('fast');
    expect(a.neu).toBe(0);
    expect(a.faellig).toBe(1);
    expect(a.fehler).toBe(1);

    expect(b.anteil).toBeCloseTo(0.8);
    expect(b.stufe).toBe('sitzt');
    expect(b.faellig).toBe(0);
    expect(b.fehler).toBe(1);

    expect(c.lernziel.id).toBe('c');
    expect(c.anzahlFragen).toBe(0);
    expect(c.anteil).toBe(0);
    expect(c.stufe).toBe('neu');
  });

  it('ohne Fortschritt ist alles neu und nichts fällig', () => {
    const [a] = lernzielStaende(lek, new Map(), JETZT);
    expect(a).toMatchObject({ anteil: 0, stufe: 'neu', neu: 2, faellig: 0, fehler: 0 });
  });

  it('teilweise geübt ohne viel Fortschritt → am Lernen', () => {
    const [a] = lernzielStaende(lek, karte(faellig('a1', 1, { verlauf: ['falsch'] })), JETZT);
    expect(a.neu).toBe(1);
    expect(a.anteil).toBeCloseTo(0.1);
    expect(a.stufe).toBe('am-lernen');
  });
});

describe('lektionAnteil', () => {
  it('mittelt Fach/5 über alle Fragen', () => {
    const lek = lektion([frage('a1', 'a'), frage('a2', 'a'), frage('b1', 'b'), frage('b2', 'b')]);
    expect(lektionAnteil(lek, new Map())).toBe(0);
    expect(lektionAnteil(lek, karte(fs('a1', 5), fs('a2', 5), fs('b1', 5), fs('b2', 5)))).toBe(1);
    expect(lektionAnteil(lek, karte(fs('a1', 5), fs('b1', 5)))).toBeCloseTo(0.5);
  });

  it('ist 0 für eine Lektion ohne Fragen', () => {
    expect(lektionAnteil(lektion([]), new Map())).toBe(0);
  });

  it('ignoriert Fortschritt anderer Lektionen', () => {
    const lek = lektion([frage('a1', 'a')]);
    const fremd = { ...neuerFortschritt('andere', 'a1'), fach: 5 };
    expect(lektionAnteil(lek, karte(fremd))).toBe(0);
  });
});
