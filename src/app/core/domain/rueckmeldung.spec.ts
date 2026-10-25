import { Lektion } from '../models/lektion.model';
import { PruefungsRueckmeldung } from '../models/rueckmeldung.model';
import {
  RUECKMELDUNG_GRENZEN,
  abgleichMitLektion,
  bereinigeRueckmeldung,
  folgerungen,
  lehrpersonProfile,
  neueRueckmeldung,
  profilAlsText,
  profilFuerFach,
  passungsBefund,
  profilSchluessel,
  pruefungsStil,
  schwierigkeitInWorten,
} from './rueckmeldung';

const JETZT = new Date('2026-10-25T10:00:00.000Z');

function lektion(teil: Partial<Lektion> = {}): Lektion {
  return {
    id: 'bio-p1',
    format: 1,
    version: 1,
    fach: 'Biologie',
    titel: 'Biologie P1',
    beschreibung: '',
    quellen: [],
    lernziele: [
      { id: 'lz-a', thema: 'T', text: 'Ziel A', zusammenfassung: '' },
      { id: 'lz-b', thema: 'T', text: 'Ziel B', zusammenfassung: '' },
    ],
    fragen: [],
    herkunft: 'manuell',
    erstelltAm: '2026-01-01T00:00:00.000Z',
    ...teil,
  };
}

function rm(teil: Partial<PruefungsRueckmeldung> = {}): PruefungsRueckmeldung {
  return { ...neueRueckmeldung(lektion(), JETZT), ...teil };
}

describe('profilSchluessel', () => {
  it('normalisiert Schreibweisen desselben Fachs', () => {
    expect(profilSchluessel(' Biologie ')).toBe('biologie');
    expect(profilSchluessel('BIOLOGIE')).toBe(profilSchluessel('biologie'));
    expect(profilSchluessel('Französisch')).toBe('franzoesisch');
  });
});

describe('neueRueckmeldung', () => {
  it('übernimmt die Lektion und lässt Passung, Stoff und Schwierigkeit offen', () => {
    const r = neueRueckmeldung(
      lektion({ lehrperson: ' Frau M. ', pruefungsdatum: '2026-10-20' }),
      JETZT,
    );
    expect(r).toEqual({
      id: 'rm-bio-p1',
      lektionId: 'bio-p1',
      lektionTitel: 'Biologie P1',
      fach: 'Biologie',
      lehrperson: 'Frau M.',
      pruefungsdatum: '2026-10-20',
      erstelltAm: JETZT.toISOString(),
      lernziele: [
        { lernzielId: 'lz-a', text: 'Ziel A', abdeckung: 'unklar' },
        { lernzielId: 'lz-b', text: 'Ziel B', abdeckung: 'unklar' },
      ],
      aufgabenarten: [],
      beispielfragen: [],
    });
  });

  it('lässt Lehrperson und Datum weg, wenn die Lektion keine hat', () => {
    const r = neueRueckmeldung(lektion(), JETZT);
    expect(r).not.toHaveProperty('lehrperson');
    expect(r).not.toHaveProperty('pruefungsdatum');
  });
});

describe('abgleichMitLektion', () => {
  it('ergänzt neue, aktualisiert den Wortlaut und behält entfernte nur, wenn beurteilt', () => {
    const r = rm({
      lernziele: [
        { lernzielId: 'lz-a', text: 'Alt A', abdeckung: 'ja' },
        { lernzielId: 'lz-weg1', text: 'Weg 1', abdeckung: 'nein' },
        { lernzielId: 'lz-weg2', text: 'Weg 2', abdeckung: 'unklar' },
      ],
    });
    const neu = lektion({
      titel: 'Neuer Titel',
      lernziele: [
        { id: 'lz-a', thema: 'T', text: 'Ziel A neu', zusammenfassung: '' },
        { id: 'lz-c', thema: 'T', text: 'Ziel C', zusammenfassung: '' },
      ],
    });
    const a = abgleichMitLektion(r, neu);
    expect(a.lernziele).toEqual([
      { lernzielId: 'lz-a', text: 'Ziel A neu', abdeckung: 'ja' },
      { lernzielId: 'lz-c', text: 'Ziel C', abdeckung: 'unklar' },
      { lernzielId: 'lz-weg1', text: 'Weg 1', abdeckung: 'nein' },
    ]);
    expect(a.lektionTitel).toBe('Neuer Titel');
    expect(r.lernziele.length).toBe(3); // Original unverändert
  });
});

describe('lehrpersonProfile', () => {
  const alt = rm({
    id: 'rm-alt',
    lektionId: 'alt',
    lektionTitel: 'Bio alt',
    fach: 'biologie',
    lehrperson: 'Hr. X',
    pruefungsdatum: '2026-03-01',
    schwierigkeit: 2,
    lernzielePassend: 2,
    stoffAbgefragt: 'teile',
    zeit: 'knapp',
    note: 4,
    aufgabenarten: ['erklaeren', 'transfer', 'erklaeren'],
    lernziele: [
      { lernzielId: 'lz-a', text: 'A', abdeckung: 'ja' },
      { lernzielId: 'lz-b', text: 'B', abdeckung: 'nein' },
    ],
  });
  const neu = rm({
    id: 'rm-neu',
    lektionId: 'neu',
    fach: 'Biologie',
    lehrperson: 'Frau Y',
    pruefungsdatum: '2026-10-20',
    schwierigkeit: 1,
    lernzielePassend: 4,
    stoffAbgefragt: 'alles',
    zeit: 'passend',
    aufgabenarten: ['erklaeren', 'rechnen'],
    lernziele: [
      { lernzielId: 'lz-a', text: 'A', abdeckung: 'teilweise' },
      { lernzielId: 'lz-b', text: 'B', abdeckung: 'unklar' },
    ],
  });
  const mathe = rm({
    id: 'rm-m',
    lektionId: 'm',
    fach: 'Mathematik',
    erstelltAm: '2026-05-01T00:00:00.000Z',
  });

  it('gruppiert nach Fach, neueste Prüfung zuerst', () => {
    const p = lehrpersonProfile([alt, mathe, neu]);
    expect(p.map((x) => x.schluessel)).toEqual(['biologie', 'mathematik']);
    expect(p[0].rueckmeldungen.map((r) => r.id)).toEqual(['rm-neu', 'rm-alt']);
    expect(p[0].fach).toBe('Biologie');
  });

  it('berechnet die Kennzahlen', () => {
    const [p] = lehrpersonProfile([alt, neu]);
    expect(p.anzahl).toBe(2);
    expect(p.lehrpersonen).toEqual(['Frau Y', 'Hr. X']);
    // gewichtet: neueste (1) zählt 1, ältere (2) zählt 0,5 → 2 / 1,5
    expect(p.schwierigkeitMittel).toBeCloseTo(4 / 3);
    expect(p.lernzielePassendMittel).toBe(3);
    expect(p.lernzieleBeurteilt).toBe(3);
    expect(p.lernzieleGesamt).toBe(4);
    expect(p.stoffAbgefragt).toEqual({ alles: 1, meiste: 0, teile: 1, wenig: 0 });
    // ja 1 + nein 0 + teilweise 0,5 (unklar zählt nicht) → 1,5 / 3
    expect(p.lernzielTreffer).toBe(0.5);
    expect(p.aufgabenarten).toEqual([
      { art: 'erklaeren', anzahl: 2 },
      { art: 'rechnen', anzahl: 1 },
      { art: 'transfer', anzahl: 1 },
    ]);
    expect(p.zeitKnapp).toBe(1);
    expect(p.noteMittel).toBe(4);
  });

  it('ohne beurteilte Lernziele und Noten: null', () => {
    const [p] = lehrpersonProfile([rm()]);
    expect(p.lernzielTreffer).toBeNull();
    expect(p.noteMittel).toBeNull();
  });

  it('mit Prüfungsdatum vor nachgetragenen Rückmeldungen ohne Datum', () => {
    const a = rm({
      id: 'A',
      fach: 'Biologie',
      pruefungsdatum: '2026-10-20',
      lehrperson: 'Herr B.',
      erstelltAm: '2026-10-21T08:00:00.000Z',
    });
    const b = rm({
      id: 'B',
      fach: 'biologie',
      lehrperson: 'Frau M.',
      erstelltAm: '2026-10-25T08:00:00.000Z',
    });
    delete b.pruefungsdatum;
    const [p] = lehrpersonProfile([b, a]);
    expect(p.lehrpersonen[0]).toBe('Herr B.');
    expect(p.fach).toBe('Biologie');
    expect(p.rueckmeldungen[0]).toBe(a);
  });

  it('ohne Passung, Stoff und Schwierigkeit: keine Wirkung auf Mittel und Text', () => {
    const mit = rm({ id: '1', schwierigkeit: 2, lernzielePassend: 4, stoffAbgefragt: 'alles' });
    const ohne = rm({ id: '2', erstelltAm: '2026-10-26T00:00:00.000Z' });
    const [p] = lehrpersonProfile([mit, ohne]);
    expect(p.schwierigkeitMittel).toBe(2);
    expect(p.lernzielePassendMittel).toBe(4);
    expect(p.stoffAbgefragt).toEqual({ alles: 1, meiste: 0, teile: 0, wenig: 0 });

    const [leer] = lehrpersonProfile([ohne]);
    expect(leer.schwierigkeitMittel).toBeNull();
    expect(leer.lernzielePassendMittel).toBeNull();
    expect(pruefungsStil(leer)!.schwierigkeitZiel).toBe(2);
    const t = profilAlsText(leer);
    expect(t).not.toContain('**Schwierigkeit:**');
    expect(t).not.toContain('etwa gleich');
    expect(t).not.toContain('Lernziele passten');
    expect(t).not.toContain('Abgefragter Stoff');
    expect(folgerungen(leer)).toEqual([]);
  });

  it('gewichtet die Schwierigkeit nach Aktualität', () => {
    const neuer = rm({ id: 'n', lektionTitel: 'Neu', pruefungsdatum: '2026-10-20', schwierigkeit: 0 });
    const aelter = rm({ id: 'a', lektionTitel: 'Alt', pruefungsdatum: '2026-05-10', schwierigkeit: 2 });
    const [p] = lehrpersonProfile([aelter, neuer]);
    expect(p.schwierigkeitMittel).toBeCloseTo(2 / 3);
    const t = profilAlsText(p);
    expect(t).toContain('zuletzt: etwa gleich');
    expect(t).toContain('«Neu» (2026-10-20, etwa gleich), «Alt» (2026-05-10, viel schwerer)');
  });

  it('nimmt erstelltAm, wenn kein Prüfungsdatum da ist', () => {
    const a = rm({ id: '1', erstelltAm: '2026-01-01T00:00:00.000Z' });
    const b = rm({ id: '2', erstelltAm: '2026-02-01T00:00:00.000Z' });
    expect(lehrpersonProfile([a, b])[0].rueckmeldungen.map((r) => r.id)).toEqual(['2', '1']);
  });

  it('profilFuerFach findet unabhängig von der Schreibweise', () => {
    expect(profilFuerFach([alt, neu, mathe], ' BIOLOGIE')?.anzahl).toBe(2);
    expect(profilFuerFach([alt, neu], 'Chemie')).toBeNull();
    expect(lehrpersonProfile([])).toEqual([]);
  });

  it('pruefungsStil: Typen ohne Duplikate, Schwierigkeit aus Mittel und Transfer', () => {
    const [p] = lehrpersonProfile([alt, neu]);
    const stil = pruefungsStil(p)!;
    expect(stil.bevorzugteTypen).toEqual(['offen', 'zahl']);
    // 2 + (4/3)/2 + 0,5 × (1/2 Transfer)
    expect(stil.schwierigkeitZiel).toBeCloseTo(2 + 2 / 3 + 0.25);
    const [schwer] = lehrpersonProfile([rm({ schwierigkeit: 2, aufgabenarten: ['transfer'] })]);
    expect(pruefungsStil(schwer)!.schwierigkeitZiel).toBe(3); // begrenzt
  });

  it('pruefungsStil: neutral bleibt 2, leichter senkt, nie unter 1', () => {
    expect(pruefungsStil(lehrpersonProfile([rm()])[0])).toEqual({
      bevorzugteTypen: [],
      schwierigkeitZiel: 2,
    });
    expect(
      pruefungsStil(lehrpersonProfile([rm({ schwierigkeit: -1 })])[0])!.schwierigkeitZiel,
    ).toBe(1.5);
    expect(
      pruefungsStil(lehrpersonProfile([rm({ schwierigkeit: -2 })])[0])!.schwierigkeitZiel,
    ).toBe(1);
    expect(
      pruefungsStil(lehrpersonProfile([rm({ schwierigkeit: 0, aufgabenarten: ['transfer'] })])[0])!
        .schwierigkeitZiel,
    ).toBe(2.5);
    expect(pruefungsStil(null)).toBeNull();
    expect(pruefungsStil(undefined)).toBeNull();
  });

  it('schwierigkeitInWorten', () => {
    expect(schwierigkeitInWorten(-2)).toContain('viel leichter');
    expect(schwierigkeitInWorten(0.2)).toContain('etwa gleich');
    expect(schwierigkeitInWorten(1.5)).toContain('viel schwerer');
  });
});

describe('profilAlsText', () => {
  const r = rm({
    lehrperson: 'Frau Y',
    pruefungsdatum: '2026-10-20',
    note: 5.5,
    schwierigkeit: 2,
    lernzielePassend: 2,
    stoffAbgefragt: 'teile',
    zeit: 'knapp',
    aufgabenarten: ['erklaeren', 'transfer'],
    lernziele: [
      { lernzielId: 'lz-a', text: 'Ziel A', abdeckung: 'ja' },
      { lernzielId: 'lz-b', text: 'Ziel B', abdeckung: 'nein' },
    ],
    ausserhalb: 'Versuch mit\nder Luftpumpe',
    beispielfragen: ['Erkläre, warum die Lunge\n\nsich dehnt.'],
    tipps: 'Will Fachbegriffe sehen.',
  });
  const text = profilAlsText(lehrpersonProfile([r])[0]);

  it('nennt die Lehrperson nur auf Wunsch (nie im KI-Auftrag)', () => {
    const p = lehrpersonProfile([rm({ lehrperson: 'Hr. Muster' })])[0];
    expect(profilAlsText(p)).not.toContain('Hr. Muster');
    expect(profilAlsText(p, { mitLehrperson: true })).toContain('(Lehrperson: Hr. Muster)');
  });

  it('enthält Kopf, Kennzahlen und Abschnitte', () => {
    expect(text).toMatch(/^Rückmeldungen zu früheren Prüfungen in Biologie\n/);
    expect(text).toContain('1 Prüfung: «Biologie P1» (2026-10-20, viel schwerer)');
    expect(text).toContain('viel schwerer als das Üben mit der App');
    expect(text).toContain('**Lernziele passten zur Prüfung:** wenig (2 von 5)');
    expect(text).toContain('**Abgefragter Stoff:** 1× nur Teile');
    expect(text).toContain('50 % der beurteilten Lernziele kamen dran (2 von 2 beurteilt)');
    expect(text).toContain('Neue Situationen, Anwendungs- und Transferaufgaben (1×)');
    expect(text).toContain('knapp bei 1 von 1');
    expect(text).toMatch(/### Lernziele früherer Lektionen, die NICHT drankamen\n\n- Ziel B/);
    expect(text).toMatch(/### Lernziele früherer Lektionen, die drankamen\n\n- Ziel A/);
    expect(text).toContain('- Versuch mit der Luftpumpe');
    expect(text).toContain('- «Erkläre, warum die Lunge sich dehnt.»');
    expect(text).toContain('- Will Fachbegriffe sehen.');
    expect(text).toContain('### Folgerungen für die nächste Lektion');
  });

  it('enthält keine Note (Datenschutz)', () => {
    expect(text).not.toMatch(/Note|5[.,]5/);
  });

  it('leitet Folgerungen ab', () => {
    expect(text).toContain('Schwierigkeit 3');
    expect(text).toContain('offene Erklärfragen');
    expect(text).toContain('über die Lernziele hinaus');
    expect(text).toContain('nur ein Teil des Stoffs');
    expect(text).toContain('Zeit war knapp');
    expect(text).toContain('Beispielfragen der Lehrperson');
  });

  it('leichtere Prüfungen und passende Lernziele ergeben andere Folgerungen', () => {
    const f = folgerungen(
      lehrpersonProfile([
        rm({ schwierigkeit: -2, lernzielePassend: 5, stoffAbgefragt: 'alles' }),
      ])[0],
    ).join(' ');
    expect(f).toContain('leichter als die App');
    expect(f).toContain('eng an den Lernzielen');
    expect(f).toContain('ganze Stoff');
    expect(f).not.toContain('Transfer)');
  });

  it('leichte Prüfung mit Transferaufgaben: keine widersprüchlichen Folgerungen', () => {
    const f = folgerungen(
      lehrpersonProfile([rm({ schwierigkeit: -2, aufgabenarten: ['transfer', 'auswahl'] })])[0],
    ).join('\n');
    expect(f).toContain('leichter als die App');
    expect(f).toContain('Einzelne Transferfragen');
    expect(f).not.toContain('Mehr Transferfragen');
  });

  it('Beschriften ohne Verweis auf eine Abbildung', () => {
    const t = profilAlsText(lehrpersonProfile([rm({ aufgabenarten: ['beschriften'] })])[0]);
    expect(t).toContain('`zuordnen`');
    expect(t).not.toContain('mit Abbildung');
  });

  describe('Passung der Lernziele', () => {
    const lz = (...a: ('ja' | 'nein')[]) =>
      a.map((abdeckung, i) => ({ lernzielId: `lz-${i}`, text: `Ziel ${i}`, abdeckung }));

    it('tiefe Passung, viele Lernziele nicht dran: nur teilweise geprüft, nicht «hinaus»', () => {
      const p = lehrpersonProfile([
        rm({ lernzielePassend: 2, lernziele: lz('ja', 'ja', 'nein', 'nein', 'nein', 'nein') }),
      ])[0];
      expect(passungsBefund(p)).toBe('teilweise');
      const f = folgerungen(p).join('\n');
      expect(f).not.toContain('über die Lernziele hinaus');
      expect(f).toContain('nur teilweise geprüft');
      // Mit Stoff «Nur Teile» keine doppelte Aussage
      const mitTeile = folgerungen(
        lehrpersonProfile([
          rm({ lernzielePassend: 2, stoffAbgefragt: 'teile', lernziele: lz('ja', 'nein', 'nein') }),
        ])[0],
      ).join('\n');
      expect(mitTeile).not.toContain('über die Lernziele hinaus');
      expect(mitTeile).not.toContain('nur teilweise geprüft');
      expect(mitTeile).toContain('nur ein Teil des Stoffs');
    });

    it('tiefe Passung, alle Lernziele dran: Stoff über die Lernziele hinaus', () => {
      const p = lehrpersonProfile([rm({ lernzielePassend: 2, lernziele: lz('ja', 'ja') })])[0];
      expect(passungsBefund(p)).toBe('hinaus');
      expect(folgerungen(p).join('\n')).toContain('über die Lernziele hinaus');
    });

    it('tiefe Passung ohne beurteilte Lernziele: unklar, eng am Material', () => {
      const p = lehrpersonProfile([rm({ lernzielePassend: 1 })])[0];
      expect(passungsBefund(p)).toBe('unklar');
      expect(folgerungen(p).join('\n')).toContain('eng am Material');
    });
  });

  it('nennt bei mehreren Prüfungen die Lektion zum Lernziel und kürzt lange Listen', () => {
    const viele = Array.from({ length: 45 }, (_, i) => ({
      lernzielId: `lz-${i}`,
      text: `Ziel ${i}`,
      abdeckung: 'nein' as const,
    }));
    const t = profilAlsText(
      lehrpersonProfile([
        rm({ id: '1', lernziele: viele }),
        rm({ id: '2', lektionTitel: 'Zweite' }),
      ])[0],
    );
    expect(t).toContain('2 Prüfungen');
    expect(t).toContain('- Ziel 0 — «Biologie P1»');
    expect(t).toContain('… und 5 weitere');
  });
});

describe('bereinigeRueckmeldung', () => {
  const gut = rm({
    lehrperson: 'Frau Y',
    pruefungsdatum: '2026-10-20',
    geaendertAm: '2026-10-21T08:00:00.000Z',
    note: 4.5,
    zeit: 'knapp',
    aufgabenarten: ['rechnen'],
    ausserhalb: 'Etwas',
    beispielfragen: ['Frage?'],
    tipps: 'Tipp',
  });

  it('übernimmt eine gültige Rückmeldung unverändert', () => {
    expect(bereinigeRueckmeldung(JSON.parse(JSON.stringify(gut)))).toEqual(gut);
  });

  it.each<[string, Record<string, unknown>]>([
    ['kein Objekt', { kaputt: true, lektionId: undefined }],
    ['ohne Fach', { fach: '  ' }],
    ['ungültiges erstelltAm', { erstelltAm: 'gestern' }],
    ['lernzielePassend 6', { lernzielePassend: 6 }],
    ['lernzielePassend 2.5', { lernzielePassend: 2.5 }],
    ['schwierigkeit 3', { schwierigkeit: 3 }],
    ['unbekannter Stoff', { stoffAbgefragt: 'viel' }],
  ])('verwirft: %s', (_name, teil) => {
    expect(bereinigeRueckmeldung({ ...gut, ...teil })).toBeNull();
  });

  it('verwirft Nicht-Objekte', () => {
    expect(bereinigeRueckmeldung(null)).toBeNull();
    expect(bereinigeRueckmeldung([gut])).toBeNull();
    expect(bereinigeRueckmeldung('x')).toBeNull();
  });

  it('lässt ungültige Zusatzfelder weg, filtert Listen und leitet die id ab', () => {
    const r = bereinigeRueckmeldung({
      ...gut,
      id: 'fremd',
      note: 7,
      zeit: 'ewig',
      pruefungsdatum: '20.10.2026',
      geaendertAm: 'nie',
      lehrperson: 42,
      ausserhalb: '   ',
      aufgabenarten: ['rechnen', 'tanzen', 'rechnen', 5],
      beispielfragen: ['  A  ', '', 3, 'B'],
      lernziele: [
        { lernzielId: 'lz-a', text: 'A', abdeckung: 'ja' },
        { lernzielId: 'lz-a', text: 'doppelt', abdeckung: 'nein' },
        { lernzielId: 'lz-b', text: 'B', abdeckung: 'vielleicht' },
        { lernzielId: 'lz-c', abdeckung: 'nein' },
        'kaputt',
      ],
      boese: '<script>',
    })!;
    expect(r.id).toBe('rm-bio-p1');
    expect(r.aufgabenarten).toEqual(['rechnen']);
    expect(r.beispielfragen).toEqual(['A', 'B']);
    expect(r.lernziele).toEqual([
      { lernzielId: 'lz-a', text: 'A', abdeckung: 'ja' },
      { lernzielId: 'lz-c', text: '', abdeckung: 'nein' },
    ]);
    for (const feld of [
      'note',
      'zeit',
      'pruefungsdatum',
      'geaendertAm',
      'lehrperson',
      'ausserhalb',
      'boese',
    ])
      expect(r).not.toHaveProperty(feld);
  });

  it('begrenzt Längen und Anzahl', () => {
    const G = RUECKMELDUNG_GRENZEN;
    const r = bereinigeRueckmeldung({
      ...gut,
      tipps: 'x'.repeat(G.text + 100),
      beispielfragen: Array.from({ length: G.beispielfragen + 10 }, () =>
        'y'.repeat(G.beispielfrage + 5),
      ),
      lernziele: Array.from({ length: G.lernziele + 10 }, (_, i) => ({
        lernzielId: `lz-${i}`,
        text: 'T',
        abdeckung: 'ja',
      })),
    })!;
    expect(r.tipps!.length).toBe(G.text);
    expect(r.beispielfragen.length).toBe(G.beispielfragen);
    expect(r.beispielfragen[0].length).toBe(G.beispielfrage);
    expect(r.lernziele.length).toBe(G.lernziele);
  });

  it('übernimmt fehlenden Titel als lektionId', () => {
    const roh: Record<string, unknown> = { ...gut };
    delete roh['lektionTitel'];
    expect(bereinigeRueckmeldung(roh)!.lektionTitel).toBe('bio-p1');
  });
});
