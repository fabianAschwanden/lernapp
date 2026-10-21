import { KiGeneratorService, quellenAus, zaehleVorkommen } from './ki-generator.service';
import { Material, PdfDokument } from './material.service';

const dok = { name: 'Skript.pdf', seitenzahl: 40, doc: {} } as unknown as PdfDokument;
const material: Material[] = [
  { art: 'pdf', id: 'm1', dok, seiten: [9, 10, 11, 21] },
  { art: 'foto', id: 'm2', name: 'Lernziele.jpg', dataUrl: 'data:image/jpeg;base64,AAA' },
  { art: 'text', id: 'm3', titel: '', text: 'Notizen' },
];

describe('KiGeneratorService (reine Hilfen)', () => {
  it('zählt Bilder: PDF-Seiten + Fotos', () => {
    expect(KiGeneratorService.anzahlBilder(material)).toBe(5);
  });

  it('zählt Vorkommen ohne Überlappung', () => {
    expect(zaehleVorkommen('{"lernzielId":"a"},{"lernzielId":"b"}', '"lernzielId"')).toBe(2);
    expect(zaehleVorkommen('aaaa', 'aa')).toBe(2);
    expect(zaehleVorkommen('', 'x')).toBe(0);
  });

  it('leitet Quellen aus dem Material ab', () => {
    expect(quellenAus(material)).toEqual([
      { id: 'q1', titel: 'Skript.pdf', umfang: 'PDF-Seiten 9–11, 21' },
      { id: 'q2', titel: 'Lernziele.jpg' },
      { id: 'q3', titel: 'Eingefügter Text' },
    ]);
  });
});
