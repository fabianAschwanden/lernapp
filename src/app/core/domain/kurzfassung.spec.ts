import { lesezeitMinuten, teileKurzfassung, zaehleWoerter } from './kurzfassung';

describe('teileKurzfassung', () => {
  it('teilt an «## »-Überschriften und behält die Einleitung', () => {
    const k = teileKurzfassung(
      'Worum es geht.\n\n## Atmung\nText A\n### Unterpunkt\n- x\n\n## **Lunge**\n> Merke\n',
    );
    expect(k.einleitung).toBe('Worum es geht.');
    expect(k.abschnitte).toEqual([
      { titel: 'Atmung', text: 'Text A\n### Unterpunkt\n- x' },
      { titel: 'Lunge', text: '> Merke' },
    ]);
  });

  it('liefert ohne Überschriften nur die Einleitung', () => {
    expect(teileKurzfassung('Nur Text\nzweite Zeile')).toEqual({
      einleitung: 'Nur Text\nzweite Zeile',
      abschnitte: [],
    });
  });

  it('kommt mit leerem Text, undefined und Windows-Zeilenenden zurecht', () => {
    expect(teileKurzfassung(undefined)).toEqual({ einleitung: '', abschnitte: [] });
    expect(teileKurzfassung('')).toEqual({ einleitung: '', abschnitte: [] });
    expect(teileKurzfassung('## A\r\nB\r\n## C').abschnitte).toEqual([
      { titel: 'A', text: 'B' },
      { titel: 'C', text: '' },
    ]);
  });

  it('nimmt «###», «#» und «##» ohne Titel nicht als Abschnitt', () => {
    const k = teileKurzfassung('# Titel\n### Zwischentitel\n##\n##kein Abstand');
    expect(k.abschnitte).toEqual([]);
    expect(k.einleitung).toContain('### Zwischentitel');
  });
});

describe('Lesezeit', () => {
  it('zählt Wörter ohne Markdown-Zeichen', () => {
    expect(zaehleWoerter('## Titel\n- **eins** zwei\n> drei | 4\n---')).toBe(5);
    expect(zaehleWoerter(undefined)).toBe(0);
  });

  it('rechnet mit 200 Wörtern pro Minute, mindestens 1 Minute', () => {
    expect(lesezeitMinuten('')).toBe(1);
    expect(lesezeitMinuten('wort '.repeat(99))).toBe(1);
    expect(lesezeitMinuten('wort '.repeat(500))).toBe(3);
    expect(lesezeitMinuten('wort '.repeat(1000))).toBe(5);
  });
});
