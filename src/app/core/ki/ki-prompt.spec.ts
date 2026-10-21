import { validiereLektion } from '../domain/lektion-validierung';
import {
  BEISPIEL_LEKTION,
  KiAuftrag,
  auftragsText,
  baueInhalt,
  kopierPrompt,
  systemPrompt,
} from './ki-prompt';
import { LEKTION_SCHEMA } from './ki-schema';

const auftrag: KiAuftrag = {
  fach: 'Informatik',
  titel: 'Prüfung 1',
  klasse: '1a',
  hinweise: ['Hilfsmittel: keine'],
  taschenrechner: false,
  niveau: 'FMS, 1. Jahr',
  fragenProLernziel: 12,
  fragetypen: ['einfachwahl', 'offen'],
  lernziele: ['Du kannst das EVA-Prinzip erklären.', 'Du kannst Speichereinheiten umrechnen.'],
  lernzieleImMaterial: false,
  materialListe: ['PDF «Skript.pdf»: PDF-Seiten 9–11'],
};

describe('ki-prompt', () => {
  it('System-Prompt: kein ß, Du-Form, Mini-Markdown und ergaenzt erwähnt', () => {
    const s = systemPrompt();
    expect(s).not.toContain('ß');
    expect(s).toContain('ergaenzt');
    expect(s).toContain('Mini-Markdown');
    expect(s).toContain('Handschriftliche Notizen');
  });

  it('Auftrag enthält Lernziele, Umfang, Niveau und Taschenrechner-Regel', () => {
    const t = auftragsText(auftrag);
    expect(t).toContain('1. Du kannst das EVA-Prinzip erklären.');
    expect(t).toContain('12 Fragen pro Lernziel');
    expect(t).toContain('FMS, 1. Jahr');
    expect(t).toContain('Kein Taschenrechner');
    expect(t).toContain('einfachwahl');
    expect(t).not.toContain('mehrfachwahl');
    expect(t).not.toContain('ß');
  });

  it('Auftrag ohne Lernziele verweist aufs Material', () => {
    const t = auftragsText({ ...auftrag, lernziele: [], lernzieleImMaterial: true });
    expect(t).toContain('Die Lernziele stehen im Material');
  });

  it('baut Inhalt: Material in Reihenfolge, Anweisung zuletzt, leere Texte weg', () => {
    const b = baueInhalt(
      [
        { art: 'bild', base64: 'AAA' },
        { art: 'text', text: 'Seite 1 (Text): Hallo' },
        { art: 'text', text: '   ' },
      ],
      auftrag,
    );
    expect(b.length).toBe(3);
    expect(b[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'AAA' },
    });
    expect(b[2].type).toBe('text');
    expect(b[2].type === 'text' && b[2].text.startsWith('# Auftrag')).toBe(true);
    const mitJson = baueInhalt([], auftrag, true);
    expect(
      mitJson[0].type === 'text' && mitJson[0].text.includes('Antworte nur mit einem JSON-Objekt'),
    ).toBe(true);
  });

  it('Kopier-Prompt enthält Zielformat und Bitte um reines JSON', () => {
    const p = kopierPrompt(auftrag);
    expect(p).toContain('## Zielformat');
    expect(p).toContain('"lernzielId":"lz-eva"');
    expect(p).toContain('NUR mit dem JSON-Objekt');
    expect(p).not.toContain('## Eingefügte Texte');
  });

  it('Kopier-Prompt enthält eingefügte Texte im Wortlaut', () => {
    const p = kopierPrompt(auftrag, [
      { titel: 'Notizen', text: 'EVA heisst Eingabe, Verarbeitung, Ausgabe.' },
    ]);
    expect(p).toContain('## Eingefügte Texte');
    expect(p).toContain('### Text «Notizen»');
    expect(p).toContain('EVA heisst Eingabe, Verarbeitung, Ausgabe.');
  });

  it('Beispiel-Lektion ist gültig', () => {
    const l = {
      ...BEISPIEL_LEKTION,
      id: 'beispiel',
      format: 1,
      version: 1,
      herkunft: 'ki',
      erstelltAm: '',
      quellen: [],
    };
    expect(validiereLektion(l)).toEqual([]);
  });
});

describe('LEKTION_SCHEMA', () => {
  const erlaubt = new Set([
    'type',
    'properties',
    'items',
    'enum',
    'anyOf',
    'required',
    'additionalProperties',
    'description',
  ]);

  function pruefe(s: Record<string, unknown>, pfad: string, fehler: string[]): void {
    for (const k of Object.keys(s))
      if (!erlaubt.has(k)) fehler.push(`${pfad}: Schlüssel ${k} nicht erlaubt`);
    if (s['type'] === 'object') {
      const props = Object.keys(s['properties'] as object);
      if (s['additionalProperties'] !== false) fehler.push(`${pfad}: additionalProperties fehlt`);
      if (
        JSON.stringify([...(s['required'] as string[])].sort()) !==
        JSON.stringify([...props].sort())
      )
        fehler.push(`${pfad}: required ≠ properties`);
      for (const [k, v] of Object.entries(
        s['properties'] as Record<string, Record<string, unknown>>,
      ))
        pruefe(v, `${pfad}.${k}`, fehler);
    }
    if (s['items']) pruefe(s['items'] as Record<string, unknown>, `${pfad}[]`, fehler);
    if (s['anyOf'])
      (s['anyOf'] as Record<string, unknown>[]).forEach((a, i) =>
        pruefe(a, `${pfad}|${i}`, fehler),
      );
  }

  it('hält die Regeln für Structured Outputs ein', () => {
    const fehler: string[] = [];
    pruefe(LEKTION_SCHEMA, '$', fehler);
    expect(fehler).toEqual([]);
    expect(LEKTION_SCHEMA['type']).toBe('object');
  });

  it('hat höchstens 16 Felder mit anyOf (Grenze der API)', () => {
    const anzahl = (JSON.stringify(LEKTION_SCHEMA).match(/"anyOf"/g) ?? []).length;
    expect(anzahl).toBeLessThanOrEqual(16);
  });
});
