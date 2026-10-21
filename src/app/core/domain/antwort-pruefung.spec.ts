import { Frage } from '../models/lektion.model';
import { Antwort, formatZahl, loesungAlsText, pruefeAntwort } from './antwort-pruefung';

const basis = { lernzielId: 'lz-1', frage: 'Frage?', erklaerung: 'Weil.', schwierigkeit: 1 as const };

const einfach: Frage = { ...basis, id: 'f1', typ: 'einfachwahl', optionen: ['A', 'B', 'C'], richtig: 1 };
const mehrfach: Frage = { ...basis, id: 'f2', typ: 'mehrfachwahl', optionen: ['A', 'B', 'C', 'D'], richtig: [0, 2] };
const wahr: Frage = { ...basis, id: 'f3', typ: 'wahrfalsch', richtig: true };
const falschAussage: Frage = { ...basis, id: 'f3b', typ: 'wahrfalsch', richtig: false };
const zuordnen: Frage = {
  ...basis,
  id: 'f4',
  typ: 'zuordnen',
  paare: [
    { links: 'Tastatur', rechts: 'Eingabe' },
    { links: 'Maus', rechts: 'Eingabe' },
    { links: 'CPU', rechts: 'Verarbeitung' },
    { links: 'Bildschirm', rechts: 'Ausgabe' },
  ],
};
const reihenfolge: Frage = { ...basis, id: 'f5', typ: 'reihenfolge', elemente: ['Eingabe', 'Verarbeitung', 'Ausgabe'] };
const zahl: Frage = { ...basis, id: 'f6', typ: 'zahl', richtig: 3.125, einheit: 'MB' };
const zahlTol: Frage = { ...basis, id: 'f6b', typ: 'zahl', richtig: 100, toleranz: 2 };
const kurz: Frage = { ...basis, id: 'f7', typ: 'kurzantwort', akzeptiert: ['USB-C', 'USB Typ C'] };
const offen: Frage = { ...basis, id: 'f8', typ: 'offen', musterloesung: 'Das EVA-Prinzip …' };

describe('pruefeAntwort', () => {
  describe('einfachwahl', () => {
    it('richtig', () => {
      expect(pruefeAntwort(einfach, { typ: 'einfachwahl', wahl: 1 })).toEqual({ bewertung: 'richtig', anteil: 1 });
    });
    it('falsch', () => {
      expect(pruefeAntwort(einfach, { typ: 'einfachwahl', wahl: 0 })).toEqual({ bewertung: 'falsch', anteil: 0 });
      expect(pruefeAntwort(einfach, { typ: 'einfachwahl', wahl: -1 }).bewertung).toBe('falsch');
    });
  });

  describe('mehrfachwahl', () => {
    const mw = (wahl: number[]) => pruefeAntwort(mehrfach, { typ: 'mehrfachwahl', wahl });

    it('alle richtigen und keine falschen → richtig', () => {
      expect(mw([2, 0])).toEqual({ bewertung: 'richtig', anteil: 1 });
    });
    it('die Hälfte der richtigen → teilweise mit Teilpunkten', () => {
      expect(mw([0])).toEqual({ bewertung: 'teilweise', anteil: 0.5 });
    });
    it('ein Fehlgriff hebt einen Treffer auf', () => {
      expect(mw([0, 2, 1])).toEqual({ bewertung: 'teilweise', anteil: 0.5 });
      expect(mw([0, 1])).toEqual({ bewertung: 'falsch', anteil: 0 });
    });
    it('alles ankreuzen lohnt sich nicht', () => {
      expect(mw([0, 1, 2, 3])).toEqual({ bewertung: 'falsch', anteil: 0 });
    });
    it('nie unter 0', () => {
      expect(mw([1, 3])).toEqual({ bewertung: 'falsch', anteil: 0 });
    });
    it('nichts gewählt → falsch', () => {
      expect(mw([])).toEqual({ bewertung: 'falsch', anteil: 0 });
    });
    it('doppelt gewählte Indizes zählen einmal', () => {
      expect(mw([0, 0])).toEqual({ bewertung: 'teilweise', anteil: 0.5 });
    });
  });

  describe('wahrfalsch', () => {
    it('erkennt wahr und falsch', () => {
      expect(pruefeAntwort(wahr, { typ: 'wahrfalsch', wert: true }).bewertung).toBe('richtig');
      expect(pruefeAntwort(wahr, { typ: 'wahrfalsch', wert: false }).bewertung).toBe('falsch');
      expect(pruefeAntwort(falschAussage, { typ: 'wahrfalsch', wert: false }).bewertung).toBe('richtig');
      expect(pruefeAntwort(falschAussage, { typ: 'wahrfalsch', wert: true }).bewertung).toBe('falsch');
    });
  });

  describe('zuordnen', () => {
    const zu = (zuordnung: Record<number, string>) => pruefeAntwort(zuordnen, { typ: 'zuordnen', zuordnung });

    it('alles richtig zugeordnet (Kategorien dürfen sich wiederholen)', () => {
      expect(zu({ 0: 'Eingabe', 1: 'Eingabe', 2: 'Verarbeitung', 3: 'Ausgabe' })).toEqual({
        bewertung: 'richtig',
        anteil: 1,
      });
    });
    it('Teilpunkte pro richtigem Paar', () => {
      expect(zu({ 0: 'Eingabe', 1: 'Ausgabe', 2: 'Verarbeitung', 3: 'Eingabe' })).toEqual({
        bewertung: 'teilweise',
        anteil: 0.5,
      });
    });
    it('fehlende Zuordnungen zählen als falsch', () => {
      expect(zu({ 2: 'Verarbeitung' })).toEqual({ bewertung: 'teilweise', anteil: 0.25 });
      expect(zu({})).toEqual({ bewertung: 'falsch', anteil: 0 });
    });
  });

  describe('reihenfolge', () => {
    const rf = (r: string[]) => pruefeAntwort(reihenfolge, { typ: 'reihenfolge', reihenfolge: r });

    it('richtige Reihenfolge', () => {
      expect(rf(['Eingabe', 'Verarbeitung', 'Ausgabe'])).toEqual({ bewertung: 'richtig', anteil: 1 });
    });
    it('Teilpunkte für Elemente am richtigen Platz', () => {
      const e = rf(['Eingabe', 'Ausgabe', 'Verarbeitung']);
      expect(e.bewertung).toBe('teilweise');
      expect(e.anteil).toBeCloseTo(1 / 3);
    });
    it('alles verschoben → falsch', () => {
      expect(rf(['Ausgabe', 'Eingabe', 'Verarbeitung'])).toEqual({ bewertung: 'falsch', anteil: 0 });
    });
  });

  describe('zahl', () => {
    const z = (f: Frage, eingabe: string) => pruefeAntwort(f, { typ: 'zahl', eingabe }).bewertung;

    it('akzeptiert Komma, Punkt und Einheit', () => {
      expect(z(zahl, '3,125')).toBe('richtig');
      expect(z(zahl, '3.125')).toBe('richtig');
      expect(z(zahl, '3,125 MB')).toBe('richtig');
    });
    it('ohne Toleranz zählt nur der genaue Wert', () => {
      expect(z(zahl, '3,12')).toBe('falsch');
      expect(z(zahl, '3,13')).toBe('falsch');
    });
    it('verträgt Rundungsfehler von Kommazahlen', () => {
      const f: Frage = { ...basis, id: 'x', typ: 'zahl', richtig: 0.3 };
      expect(z(f, '0,3')).toBe('richtig');
      const g: Frage = { ...basis, id: 'y', typ: 'zahl', richtig: 0.1 + 0.2 };
      expect(z(g, '0.3')).toBe('richtig');
    });
    it('mit Toleranz: Grenzen eingeschlossen', () => {
      expect(z(zahlTol, '98')).toBe('richtig');
      expect(z(zahlTol, '102')).toBe('richtig');
      expect(z(zahlTol, '101,5')).toBe('richtig');
      expect(z(zahlTol, '97,9')).toBe('falsch');
      expect(z(zahlTol, '102,1')).toBe('falsch');
    });
    it('Tausendertrennzeichen und Potenzen', () => {
      const f: Frage = { ...basis, id: 'z', typ: 'zahl', richtig: 1024 };
      expect(z(f, "1'024")).toBe('richtig');
      expect(z(f, '2^10')).toBe('richtig');
    });
    it('keine Zahl → falsch', () => {
      expect(pruefeAntwort(zahl, { typ: 'zahl', eingabe: 'abc' })).toEqual({ bewertung: 'falsch', anteil: 0 });
      expect(z(zahl, '')).toBe('falsch');
    });
  });

  describe('kurzantwort', () => {
    const k = (eingabe: string) => pruefeAntwort(kurz, { typ: 'kurzantwort', eingabe }).bewertung;

    it('vergleicht ohne Gross-/Kleinschreibung, Leerzeichen und Bindestriche', () => {
      for (const e of ['USB-C', 'usb-c', 'usb c', 'USBC', '  Usb - C ', 'usb typ c', 'USB-Typ-C']) {
        expect(k(e)).toBe('richtig');
      }
    });
    it('falsche Antwort', () => {
      expect(k('USB-A')).toBe('falsch');
      expect(k('Lightning')).toBe('falsch');
    });
    it('leere Eingabe ist nie richtig', () => {
      expect(k('')).toBe('falsch');
      expect(k(' - ')).toBe('falsch');
    });
  });

  describe('offen (Selbsteinschätzung)', () => {
    it('übernimmt die Selbsteinschätzung', () => {
      expect(pruefeAntwort(offen, { typ: 'offen', selbst: 'richtig' })).toEqual({ bewertung: 'richtig', anteil: 1 });
      expect(pruefeAntwort(offen, { typ: 'offen', selbst: 'teilweise' })).toEqual({
        bewertung: 'teilweise',
        anteil: 0.5,
      });
      expect(pruefeAntwort(offen, { typ: 'offen', selbst: 'falsch' })).toEqual({ bewertung: 'falsch', anteil: 0 });
    });
  });

  describe('Typ-Mismatch', () => {
    it('wertet eine Antwort des falschen Typs als falsch, ohne zu werfen', () => {
      const faelle: [Frage, Antwort][] = [
        [einfach, { typ: 'mehrfachwahl', wahl: [1] }],
        [mehrfach, { typ: 'einfachwahl', wahl: 0 }],
        [wahr, { typ: 'kurzantwort', eingabe: 'wahr' }],
        [zahl, { typ: 'kurzantwort', eingabe: '3,125' }],
        [kurz, { typ: 'zahl', eingabe: 'USB-C' }],
        [offen, { typ: 'wahrfalsch', wert: true }],
        [zuordnen, { typ: 'reihenfolge', reihenfolge: [] }],
        [reihenfolge, { typ: 'zuordnen', zuordnung: {} }],
      ];
      for (const [f, a] of faelle) {
        expect(pruefeAntwort(f, a)).toEqual({ bewertung: 'falsch', anteil: 0 });
      }
    });
  });
});

describe('loesungAlsText', () => {
  it('liefert für jeden Fragetyp eine lesbare Lösung', () => {
    expect(loesungAlsText(einfach)).toBe('B');
    expect(loesungAlsText(mehrfach)).toBe('A · C');
    expect(loesungAlsText(wahr)).toBe('Wahr');
    expect(loesungAlsText(falschAussage)).toBe('Falsch');
    expect(loesungAlsText(zuordnen)).toBe(
      'Tastatur → Eingabe · Maus → Eingabe · CPU → Verarbeitung · Bildschirm → Ausgabe',
    );
    expect(loesungAlsText(reihenfolge)).toBe('Eingabe → Verarbeitung → Ausgabe');
    expect(loesungAlsText(zahl)).toBe('3.125 MB');
    expect(loesungAlsText(zahlTol)).toBe('100');
    expect(loesungAlsText(kurz)).toBe('USB-C');
    expect(loesungAlsText(offen)).toBe('Das EVA-Prinzip …');
  });

  it('formatiert grosse Zahlen mit Tausendertrennzeichen', () => {
    const f: Frage = { ...basis, id: 'g', typ: 'zahl', richtig: 1_000_000, einheit: 'Bytes' };
    expect(loesungAlsText(f)).toMatch(/^1['’]000['’]000 Bytes$/);
  });

  it('liefert einen leeren Text statt undefined bei ungültigem Index', () => {
    expect(loesungAlsText({ ...einfach, richtig: 9 } as Frage)).toBe('');
    expect(loesungAlsText({ ...kurz, akzeptiert: [] } as Frage)).toBe('');
  });
});

describe('formatZahl', () => {
  it('nutzt das Schweizer Format mit Apostroph und Dezimalpunkt', () => {
    expect(formatZahl(0)).toBe('0');
    expect(formatZahl(999)).toBe('999');
    expect(formatZahl(1000)).toMatch(/^1['’]000$/);
    expect(formatZahl(1234567.5)).toMatch(/^1['’]234['’]567\.5$/);
    expect(formatZahl(3.125)).toBe('3.125');
  });

  it('rundet auf höchstens sechs Nachkommastellen', () => {
    expect(formatZahl(1 / 3)).toBe('0.333333');
    expect(formatZahl(0.1 + 0.2)).toBe('0.3');
  });

  it('zeigt negative Zahlen mit Minus', () => {
    expect(formatZahl(-1500)).toMatch(/^[-−]1['’]500$/);
  });
});
