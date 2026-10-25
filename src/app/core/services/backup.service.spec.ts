import { Lektion } from '../models/lektion.model';
import { PruefungsRueckmeldung } from '../models/rueckmeldung.model';
import {
  bereinigeEinstellungen,
  bereinigeFortschritt,
  bereinigePruefung,
  lektionStand,
  planeLektionImport,
  planeRueckmeldungImport,
  pruefeBackup,
} from './backup.service';

function lektion(id: string, teil: Partial<Lektion> = {}): Lektion {
  return {
    id,
    format: 1,
    version: 1,
    fach: 'Informatik',
    titel: `Titel ${id}`,
    beschreibung: '',
    quellen: [],
    lernziele: [{ id: 'lz-a', thema: 'A', text: 'Ziel A', zusammenfassung: '' }],
    fragen: [
      {
        id: 'f-1',
        lernzielId: 'lz-a',
        typ: 'wahrfalsch',
        frage: 'Stimmt das?',
        richtig: true,
        erklaerung: 'Darum.',
        schwierigkeit: 1,
      },
    ],
    herkunft: 'manuell',
    erstelltAm: '2026-01-01T00:00:00.000Z',
    ...teil,
  };
}

describe('pruefeBackup', () => {
  it('lehnt fremde Dateien ab', () => {
    expect('fehler' in pruefeBackup(null)).toBe(true);
    expect('fehler' in pruefeBackup({ app: 'andere', format: 1 })).toBe(true);
    expect('fehler' in pruefeBackup({ app: 'lernapp', format: 2 })).toBe(true);
  });

  it('akzeptiert ein gültiges Backup und filtert kaputte Einträge', () => {
    const r = pruefeBackup({
      app: 'lernapp',
      format: 1,
      erstelltAm: '2026-10-20T10:00:00.000Z',
      lektionen: [lektion('a')],
      fortschritt: [
        { schluessel: 'a::f-1', lektionId: 'a', frageId: 'f-1', fach: 2, richtig: 2, falsch: 0, verlauf: [] },
        { kaputt: true },
      ],
      pruefungen: 'nicht-liste',
      einstellungen: { rundenGroesse: 10, anthropicApiKey: 'sk-geheim' },
    });
    expect('backup' in r).toBe(true);
    if (!('backup' in r)) return;
    expect(r.backup.lektionen.length).toBe(1);
    expect(r.backup.fortschritt.length).toBe(1);
    expect(r.backup.pruefungen).toEqual([]);
    expect(r.backup.einstellungen).toEqual({ rundenGroesse: 10 });
  });
});

describe('lektionStand', () => {
  it('nimmt geaendertAm vor erstelltAm', () => {
    expect(lektionStand({ erstelltAm: '2026-01-01', geaendertAm: '2026-02-01' })).toBe('2026-02-01');
    expect(lektionStand({ erstelltAm: '2026-01-01' })).toBe('2026-01-01');
  });
});

describe('planeLektionImport', () => {
  it('fügt neue hinzu, ersetzt ältere, überspringt neuere und meldet ungültige', () => {
    const vorhandene = [
      lektion('alt', { geaendertAm: '2026-03-01T00:00:00.000Z' }),
      lektion('neuer-lokal', { geaendertAm: '2026-09-01T00:00:00.000Z' }),
    ];
    const { uebernehmen, ergebnis } = planeLektionImport(
      [
        lektion('neu'),
        lektion('alt', { geaendertAm: '2026-05-01T00:00:00.000Z' }),
        lektion('neuer-lokal', { geaendertAm: '2026-04-01T00:00:00.000Z' }),
        { id: 'kaputt', titel: 'Kaputt' },
      ],
      vorhandene,
    );
    expect(uebernehmen.map((l) => l.id)).toEqual(['neu', 'alt']);
    expect(ergebnis.neu).toEqual(['Titel neu']);
    expect(ergebnis.ersetzt).toEqual(['Titel alt']);
    expect(ergebnis.uebersprungen).toEqual(['Titel neuer-lokal']);
    expect(ergebnis.ungueltig.length).toBe(1);
    expect(ergebnis.ungueltig[0].titel).toBe('Kaputt');
  });

  it('überspringt gleich alte Lektionen und meldet doppelte ids', () => {
    const l = lektion('x');
    const { uebernehmen, ergebnis } = planeLektionImport([lektion('x'), lektion('y'), lektion('y')], [l]);
    expect(uebernehmen.map((x) => x.id)).toEqual(['y']);
    expect(ergebnis.uebersprungen).toEqual(['Titel x']);
    expect(ergebnis.ungueltig.length).toBe(1);
  });
});

describe('bereinigeEinstellungen', () => {
  it('übernimmt nur bekannte, gültige Werte', () => {
    expect(
      bereinigeEinstellungen({
        rundenGroesse: 100,
        pruefungAnzahl: 3,
        pruefungMinuten: 0,
        kiModell: 'claude-sonnet-5-5',
        farbschema: 'lila',
        apiKey: 'sk-x',
      }),
    ).toEqual({ rundenGroesse: 30, pruefungAnzahl: 5, pruefungMinuten: 0, kiModell: 'claude-sonnet-5-5' });
    expect(bereinigeEinstellungen('quatsch')).toEqual({});
  });
});

describe('bereinigeFortschritt', () => {
  const gut = {
    schluessel: 'l::f',
    lektionId: 'l',
    frageId: 'f',
    fach: 3,
    richtig: 2,
    falsch: 1,
    zuletzt: '2026-10-01T10:00:00.000Z',
    faelligAb: '2026-10-04T10:00:00.000Z',
    verlauf: ['richtig', 'falsch', 'richtig'],
  };

  it('übernimmt einen gültigen Lernstand', () => {
    expect(bereinigeFortschritt(gut)).toEqual(gut);
  });

  it.each([6, 9, 2.5, -1, '3', NaN])('verwirft Fach %s (ausserhalb 0…5)', (fach) => {
    expect(bereinigeFortschritt({ ...gut, fach })).toBeNull();
  });

  it('filtert ungültige Bewertungen, setzt Zähler und Schlüssel korrekt', () => {
    const f = bereinigeFortschritt({
      ...gut,
      schluessel: 'falsch',
      richtig: 'viele',
      falsch: -3,
      faelligAb: 'morgen',
      verlauf: ['richtig', 'super', 5, 'teilweise'],
    });
    expect(f).toMatchObject({ schluessel: 'l::f', richtig: 0, falsch: 0, verlauf: ['richtig', 'teilweise'] });
    expect(f).not.toHaveProperty('faelligAb');
  });
});

describe('bereinigePruefung', () => {
  const gut = {
    id: 'p1',
    lektionId: 'l',
    am: '2026-10-01T10:00:00.000Z',
    punkte: 11,
    maxPunkte: 20,
    note: 3.75,
    dauerSekunden: 600,
    proLernziel: { 'lz-a': { punkte: 1, max: 2 } },
  };

  it('übernimmt ein gültiges Ergebnis', () => {
    expect(bereinigePruefung(gut)).toEqual(gut);
  });

  it.each<[string, Record<string, unknown>]>([
    ['ungültiges Datum (DatePipe würde werfen)', { am: 'gestern' }],
    ['Note über 6', { note: 7 }],
    ['Punkte über Maximum', { punkte: 25 }],
    ['Maximum 0', { maxPunkte: 0 }],
  ])('verwirft: %s', (_name, teil) => {
    expect(bereinigePruefung({ ...gut, ...teil })).toBeNull();
  });
});

describe('Rückmeldungen im Backup', () => {
  function rm(lektionId: string, stand: Partial<PruefungsRueckmeldung> = {}): PruefungsRueckmeldung {
    return {
      id: `rm-${lektionId}`,
      lektionId,
      lektionTitel: lektionId,
      fach: 'Biologie',
      erstelltAm: '2026-10-01T00:00:00.000Z',
      lernzielePassend: 4,
      stoffAbgefragt: 'alles',
      schwierigkeit: 1,
      lernziele: [{ lernzielId: 'lz-a', text: 'A', abdeckung: 'ja' }],
      aufgabenarten: ['erklaeren'],
      beispielfragen: ['Erkläre …'],
      ...stand,
    };
  }

  it('alte Backups ohne Rückmeldungen bleiben gültig', () => {
    const r = pruefeBackup({ app: 'lernapp', format: 1, lektionen: [] });
    expect('backup' in r && r.backup.rueckmeldungen).toEqual([]);
  });

  it('übernimmt gültige und verwirft kaputte Rückmeldungen', () => {
    const r = pruefeBackup({
      app: 'lernapp',
      format: 1,
      rueckmeldungen: [rm('a'), { id: 'kaputt' }, rm('b', { schwierigkeit: 9 as never })],
    });
    expect('backup' in r && r.backup.rueckmeldungen).toEqual([rm('a')]);
  });

  it('planeRueckmeldungImport: neue und neuere gewinnen', () => {
    const vorhanden = [
      rm('alt', { geaendertAm: '2026-10-02T00:00:00.000Z' }),
      rm('lokal-neuer', { geaendertAm: '2026-10-09T00:00:00.000Z' }),
      rm('gleich'),
    ];
    const plan = planeRueckmeldungImport(
      [
        rm('neu'),
        rm('alt', { geaendertAm: '2026-10-05T00:00:00.000Z' }),
        rm('lokal-neuer', { geaendertAm: '2026-10-03T00:00:00.000Z' }),
        rm('gleich'),
        rm('doppelt', { geaendertAm: '2026-10-01T00:00:00.000Z' }),
        rm('doppelt', { geaendertAm: '2026-10-07T00:00:00.000Z' }),
      ],
      vorhanden,
    );
    expect(plan.map((r) => r.id)).toEqual(['rm-neu', 'rm-alt', 'rm-doppelt']);
    expect(plan[2].geaendertAm).toBe('2026-10-07T00:00:00.000Z');
  });
});

describe('planeLektionImport ergänzt fehlende Felder', () => {
  it('Lektion ohne quellen/beschreibung wird vollständig gespeichert', () => {
    const roh: Record<string, unknown> = { ...lektion('mini') };
    delete roh['quellen'];
    delete roh['beschreibung'];
    const { uebernehmen } = planeLektionImport([roh], []);
    expect(uebernehmen[0].quellen).toEqual([]);
    expect(uebernehmen[0].beschreibung).toBe('');
  });

  it('weist Lektionen mit fremden Bildadressen ab', () => {
    const l = lektion('mit-bild');
    l.lernziele[0].bilder = [{ src: 'https://tracker.example/p.gif', alt: '' }];
    const { uebernehmen, ergebnis } = planeLektionImport([l], []);
    expect(uebernehmen).toEqual([]);
    expect(ergebnis.ungueltig[0].fehler.join(' ')).toContain('Quelle nicht erlaubt');
  });
});
