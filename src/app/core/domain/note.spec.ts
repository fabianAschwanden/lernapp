import { berechneNote, halbeNote, istGenuegend } from './note';

describe('berechneNote', () => {
  it('0 Punkte → 1, volle Punktzahl → 6, Hälfte → 3.5', () => {
    expect(berechneNote(0, 20)).toBe(1);
    expect(berechneNote(20, 20)).toBe(6);
    expect(berechneNote(10, 20)).toBe(3.5);
  });

  it('ist linear: 60 % → 4', () => {
    expect(berechneNote(12, 20)).toBe(4);
    expect(berechneNote(15, 20)).toBe(4.75);
  });

  it('rundet nicht zwischendurch (genaue Note)', () => {
    expect(berechneNote(1, 3)).toBeCloseTo(2.6667, 4);
    expect(berechneNote(2, 3)).toBeCloseTo(4.3333, 4);
    expect(berechneNote(68.92, 100)).toBeCloseTo(4.446, 6);
  });

  it('begrenzt auf 1 bis 6', () => {
    expect(berechneNote(-5, 20)).toBe(1);
    expect(berechneNote(25, 20)).toBe(6);
  });

  it('gibt 1 bei maximal 0 oder negativen Punkten', () => {
    expect(berechneNote(0, 0)).toBe(1);
    expect(berechneNote(3, 0)).toBe(1);
    expect(berechneNote(3, -1)).toBe(1);
  });

  it('versteht Teilpunkte', () => {
    expect(berechneNote(7.5, 10)).toBe(4.75);
  });
});

describe('halbeNote', () => {
  it.each([
    [1, 1],
    [3.5, 3.5],
    [4.24, 4],
    [4.25, 4.5],
    [4.74, 4.5],
    [4.75, 5],
    [5.9, 6],
    [6, 6],
  ])('%s → %s', (note, erwartet) => {
    expect(halbeNote(note)).toBe(erwartet);
  });
});

describe('istGenuegend', () => {
  it('massgebend ist die gerundete Note: ab 3.75 (→ 4) genügend', () => {
    expect(istGenuegend(4)).toBe(true);
    expect(istGenuegend(6)).toBe(true);
    expect(istGenuegend(3.75)).toBe(true);
    expect(istGenuegend(3.74)).toBe(false);
    expect(istGenuegend(1)).toBe(false);
  });

  it('passt zur Anzeige: 11 von 20 Punkten → Note 4.0 und genügend', () => {
    const note = berechneNote(11, 20);
    expect(halbeNote(note)).toBe(4);
    expect(istGenuegend(note)).toBe(true);
  });

  it('keine doppelte Rundung: 3.746 wird zu 3.5 und ist ungenügend', () => {
    const note = berechneNote(54.92, 100); // 3.746
    expect(halbeNote(note)).toBe(3.5);
    expect(istGenuegend(note)).toBe(false);
  });

  it('gleicht Gleitkomma-Reste aus', () => {
    expect(halbeNote(3.7499999999999996)).toBe(4);
  });
});
