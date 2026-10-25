import { lehrpersonProfile } from '../../core/domain/rueckmeldung';
import { PruefungsRueckmeldung } from '../../core/models/rueckmeldung.model';
import {
  exportDateiname,
  fachAnker,
  kennzahlen,
  kurzArt,
  profilExport,
  tippsFuerDich,
} from './profil-anzeige';

function rm(teil: Partial<PruefungsRueckmeldung> = {}): PruefungsRueckmeldung {
  return {
    id: 'rm-bio',
    lektionId: 'bio',
    lektionTitel: 'Biologie P1',
    fach: 'Biologie',
    erstelltAm: '2026-10-20T10:00:00.000Z',
    lernzielePassend: 4,
    stoffAbgefragt: 'meiste',
    schwierigkeit: 1,
    lernziele: [
      { lernzielId: 'a', text: 'Ziel A', abdeckung: 'ja' },
      { lernzielId: 'b', text: 'Ziel B', abdeckung: 'nein' },
    ],
    aufgabenarten: ['erklaeren', 'rechnen'],
    beispielfragen: ['Erkläre die Zellatmung.'],
    ...teil,
  };
}

const profil = (...rs: PruefungsRueckmeldung[]) => lehrpersonProfile(rs)[0];

describe('profil-anzeige', () => {
  it('zeigt Kennzahlen, den Notenschnitt nur auf Wunsch', () => {
    const p = profil(rm({ note: 4.5, zeit: 'knapp' }));
    const ohne = kennzahlen(p);
    expect(ohne.map((k) => k.name)).not.toContain('Notenschnitt');
    expect(ohne.find((k) => k.name === 'Schwierigkeit')?.wert).toBe(
      'Eher schwerer als das Üben mit der App',
    );
    expect(ohne.find((k) => k.name === 'Lernziele dran')?.wert).toBe(
      '50 % der beurteilten Lernziele (2 von 2 beurteilt)',
    );
    expect(ohne.find((k) => k.name === 'Zeit knapp')?.wert).toBe('bei 1 von 1 Prüfungen');
    expect(kennzahlen(p, true).find((k) => k.name === 'Notenschnitt')?.wert).toBe('4.5');
  });

  it('leitet Tipps aus dem Profil ab', () => {
    const tipps = tippsFuerDich(profil(rm({ zeit: 'knapp' })));
    expect(tipps.some((t) => t.includes('Transfer'))).toBe(true);
    expect(tipps.some((t) => t.includes('ganzen Sätzen'))).toBe(true);
    expect(tipps.some((t) => t.includes('Zeitlimit'))).toBe(true);
  });

  it('Tipp «über die Lernziele hinaus» nur, wenn die Angaben das stützen', () => {
    // Passung 2, nur Teile, 4 von 6 Lernzielen nicht dran, «ausserhalb» leer
    const lz = ['ja', 'ja', 'nein', 'nein', 'nein', 'nein'] as const;
    const tipps = tippsFuerDich(
      profil(
        rm({
          lernzielePassend: 2,
          stoffAbgefragt: 'teile',
          lernziele: lz.map((abdeckung, i) => ({ lernzielId: `${i}`, text: `Z${i}`, abdeckung })),
        }),
      ),
    );
    expect(tipps.some((t) => t.includes('nicht ausdrücklich in den Lernzielen'))).toBe(false);
    expect(tipps.some((t) => t.includes('Nicht alle Lernziele kamen dran'))).toBe(true);
    const mitAusserhalb = tippsFuerDich(profil(rm({ ausserhalb: 'Versuch' })));
    expect(mitAusserhalb.some((t) => t.includes('nicht ausdrücklich in den Lernzielen'))).toBe(true);
  });

  it('zeigt fehlende Angaben nicht als Kennzahl', () => {
    const r = rm();
    delete r.schwierigkeit;
    delete r.lernzielePassend;
    delete r.stoffAbgefragt;
    const namen = kennzahlen(profil(r)).map((k) => k.name);
    expect(namen).not.toContain('Schwierigkeit');
    expect(namen).not.toContain('Lernziele passten');
    expect(namen).not.toContain('Abgefragter Stoff');
  });

  it('exportiert ohne Noten, mit Text', () => {
    const e = profilExport(profil(rm({ note: 3 })), new Date('2026-10-25T00:00:00.000Z'));
    expect(e.rueckmeldungen[0]).not.toHaveProperty('note');
    expect(e.text).toContain('Rückmeldungen zu früheren Prüfungen in Biologie');
    expect(profilExport(profil(rm({ lehrperson: 'Frau M.' }))).text).toContain('Frau M.');
    expect(JSON.stringify(e)).not.toContain('"note"');
  });

  it('bildet Dateinamen, Anker und kurze Bezeichnungen', () => {
    expect(exportDateiname(profil(rm({ fach: 'Mensch & Umwelt' })))).toBe(
      'rueckmeldungen-mensch-umwelt.json',
    );
    expect(fachAnker('biologie')).toBe('fach-biologie');
    expect(kurzArt('Erklären, begründen (ganze Sätze)')).toBe('Erklären, begründen');
  });
});
