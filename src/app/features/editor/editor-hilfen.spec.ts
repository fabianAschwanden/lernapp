import { KurzantwortFrage, Lektion } from '../../core/models/lektion.model';
import { bereinige, fehlerZiel, freieId, frageVorlage, kurztext, lernzielId, neueFrageId, slug } from './editor-hilfen';

describe('editor-hilfen', () => {
  it('slug und freie ids', () => {
    expect(slug('Datenfluss im Computer: EVA!')).toBe('datenfluss-im-computer-eva');
    expect(freieId('lz-a', new Set(['lz-a', 'lz-a-2']))).toBe('lz-a-3');
    expect(lernzielId({ text: 'Ich kann das EVA-Prinzip erklären', thema: '' }, new Set())).toBe(
      'lz-das-eva-prinzip-erklaeren',
    );
  });

  it('neue Frage-ids sind eindeutig', () => {
    let n = 0;
    const werte = [0.5, 0.5, 0.25];
    const id = neueFrageId(new Set([`f-${Math.floor(0.5 * 36 ** 6).toString(36)}`]), () => werte[n++]);
    expect(id).toBe(`f-${Math.floor(0.25 * 36 ** 6).toString(36)}`);
  });

  it('kurztext entfernt Markdown und kürzt', () => {
    expect(kurztext('**Was** ist `RAM`?')).toBe('Was ist RAM?');
    expect(kurztext('')).toBe('(ohne Fragetext)');
    expect(kurztext('a'.repeat(100), 10)).toHaveLength(10);
  });

  it('fehlerZiel erkennt Frage und Lernziel', () => {
    expect(fehlerZiel('Frage 3 (f-x): Fragetext fehlt.')).toEqual({ art: 'frage', index: 2 });
    expect(fehlerZiel('Lernziel 1: Text fehlt.')).toEqual({ art: 'lernziel', index: 0 });
    expect(fehlerZiel('Feld «titel» fehlt.')).toBeNull();
  });

  it('bereinige entfernt leere optionale Einträge', () => {
    const l: Lektion = {
      id: 'x',
      format: 1,
      version: 1,
      fach: 'F',
      titel: 'T',
      beschreibung: '',
      klasse: '',
      hinweise: ['', 'Taschenrechner erlaubt'],
      kurzfassung: '  \n ',
      quellen: [],
      lernziele: [{ id: 'lz-a', thema: 'A', text: 'A', zusammenfassung: '', merksaetze: [''], ergaenzt: false }],
      fragen: [{ ...(frageVorlage('kurzantwort', 'f-1', 'lz-a') as KurzantwortFrage), akzeptiert: ['', 'RAM'] }],
      herkunft: 'manuell',
      erstelltAm: '2026-01-01',
    };
    const b = bereinige(l);
    expect(b.klasse).toBeUndefined();
    expect('kurzfassung' in b).toBe(false);
    expect(bereinige({ ...l, kurzfassung: '## A\nText' }).kurzfassung).toBe('## A\nText');
    expect(b.hinweise).toEqual(['Taschenrechner erlaubt']);
    expect(b.lernziele[0].merksaetze).toBeUndefined();
    expect('ergaenzt' in b.lernziele[0]).toBe(false);
    expect(b.fragen[0].typ === 'kurzantwort' && b.fragen[0].akzeptiert).toEqual(['RAM']);
    expect(l.hinweise).toHaveLength(2);
  });
});
