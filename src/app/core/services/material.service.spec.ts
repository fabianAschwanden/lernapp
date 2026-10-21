import { parseSeitenbereich, seitenbereichText } from './material.service';

describe('parseSeitenbereich', () => {
  it('liest Bereiche und Einzelseiten', () => {
    expect(parseSeitenbereich('9-11, 21-24').seiten).toEqual([9, 10, 11, 21, 22, 23, 24]);
    expect(parseSeitenbereich('3; 5–7 , 1').seiten).toEqual([1, 3, 5, 6, 7]);
    expect(parseSeitenbereich('2 bis 4').seiten).toEqual([2, 3, 4]);
  });

  it('entfernt Doppelte und sortiert', () => {
    expect(parseSeitenbereich('5, 3-5, 4').seiten).toEqual([3, 4, 5]);
  });

  it('leere Eingabe ergibt keine Seiten ohne Fehler', () => {
    expect(parseSeitenbereich('  ')).toEqual({ seiten: [], fehler: null });
  });

  it('meldet ungültige Eingaben', () => {
    expect(parseSeitenbereich('9-').fehler).toContain('kein gültiger Seitenbereich');
    expect(parseSeitenbereich('abc').fehler).not.toBeNull();
    expect(parseSeitenbereich('11-9').fehler).toContain('aufsteigend');
    expect(parseSeitenbereich('0').fehler).not.toBeNull();
  });

  it('prüft die Seitenzahl des PDFs', () => {
    expect(parseSeitenbereich('20-30', 25).fehler).toContain('nur 25 Seiten');
    expect(parseSeitenbereich('20-25', 25).seiten.length).toBe(6);
  });
});

describe('seitenbereichText', () => {
  it('fasst aufeinanderfolgende Seiten zusammen', () => {
    expect(seitenbereichText([9, 10, 11, 21, 22, 23, 24])).toBe('9–11, 21–24');
    expect(seitenbereichText([7, 3, 5, 6, 3])).toBe('3, 5–7');
    expect(seitenbereichText([])).toBe('');
  });
});
