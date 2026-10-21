import { Injectable } from '@angular/core';
import type { PDFDocumentProxy } from 'pdfjs-dist';

/** Ein geöffnetes PDF (bleibt nur im Speicher, nie in IndexedDB). */
export interface PdfDokument {
  name: string;
  seitenzahl: number;
  doc: PDFDocumentProxy;
}

/** Material für die KI-Erstellung, wie es der Assistent übergibt. */
export type Material =
  | {
      art: 'pdf';
      id: string;
      dok: PdfDokument;
      /** ausgewählte PDF-Seiten (1-basiert) */ seiten: number[];
    }
  | {
      art: 'foto';
      id: string;
      name: string;
      /** verkleinertes JPEG als Data-URL */ dataUrl: string;
    }
  | { art: 'text'; id: string; titel: string; text: string };

type PdfJs = typeof import('pdfjs-dist');

/**
 * PDF-Verarbeitung im Browser mit pdf.js: Seiten als Vorschaubild oder JPEG
 * rendern und Text pro Seite auslesen. pdf.js wird erst beim ersten PDF
 * geladen (eigener Chunk), damit der Start schnell bleibt.
 */
@Injectable({ providedIn: 'root' })
export class MaterialService {
  private pdfjs: Promise<PdfJs> | null = null;

  private ladePdfJs(): Promise<PdfJs> {
    this.pdfjs ??= import('pdfjs-dist').then((pdfjs) => {
      // Der Worker wird vom Angular-Build als eigene Datei gebündelt
      // (new Worker(new URL(…, import.meta.url)) mit relativem Pfad).
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(
        new URL('../../../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
        { type: 'module' },
      );
      return pdfjs;
    });
    return this.pdfjs;
  }

  async ladePdf(datei: File): Promise<PdfDokument> {
    const pdfjs = await this.ladePdfJs();
    const daten = new Uint8Array(await datei.arrayBuffer());
    try {
      const doc = await pdfjs.getDocument({ data: daten }).promise;
      return { name: datei.name, seitenzahl: doc.numPages, doc };
    } catch (e) {
      if (e instanceof pdfjs.PasswordException)
        throw new Error(`«${datei.name}» ist passwortgeschützt.`);
      throw new Error(`«${datei.name}» konnte nicht als PDF gelesen werden.`);
    }
  }

  /** Kleines Vorschaubild (Breite ~160 px) als JPEG-Data-URL. */
  vorschau(dok: PdfDokument, seite: number, breite = 160): Promise<string> {
    return this.render(dok, seite, (b) => breite / b, 0.7);
  }

  /** Seite als JPEG, längste Kante ~maxKante Pixel (für Claude). */
  renderSeite(dok: PdfDokument, seite: number, maxKante = 1600, qualitaet = 0.8): Promise<string> {
    return this.render(dok, seite, (b, h) => maxKante / Math.max(b, h), qualitaet);
  }

  /** Text einer Seite (Zeilenumbrüche, wo pdf.js sie erkennt). */
  async seitenText(dok: PdfDokument, seite: number): Promise<string> {
    const page = await dok.doc.getPage(seite);
    try {
      const inhalt = await page.getTextContent();
      let text = '';
      for (const item of inhalt.items) {
        if (!('str' in item)) continue;
        text += item.str + (item.hasEOL ? '\n' : '');
      }
      return text
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    } finally {
      page.cleanup();
    }
  }

  async schliesse(dok: PdfDokument): Promise<void> {
    await dok.doc.loadingTask.destroy().catch(() => undefined);
  }

  private async render(
    dok: PdfDokument,
    seite: number,
    massstab: (breite: number, hoehe: number) => number,
    qualitaet: number,
  ): Promise<string> {
    const page = await dok.doc.getPage(seite);
    try {
      const basis = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: massstab(basis.width, basis.height) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      await page.render({ canvas, viewport, background: '#ffffff' }).promise;
      const url = canvas.toDataURL('image/jpeg', qualitaet);
      canvas.width = canvas.height = 0; // Speicher sofort freigeben (iOS)
      return url;
    } finally {
      page.cleanup();
    }
  }
}

/**
 * Liest Seitenbereiche wie «9-11, 21-24» oder «3; 5–7» → [3,5,6,7].
 * Sortiert, ohne Doppelte. Mit `max` werden Seiten ausserhalb 1..max gemeldet.
 */
export function parseSeitenbereich(
  eingabe: string,
  max?: number,
): { seiten: number[]; fehler: string | null } {
  const seiten = new Set<number>();
  const teile = eingabe
    .split(/[,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  for (const teil of teile) {
    const m = teil.match(/^(\d+)\s*(?:[-–—]|bis)\s*(\d+)$/i) ?? teil.match(/^(\d+)$/);
    if (!m)
      return {
        seiten: [],
        fehler: `«${teil}» ist kein gültiger Seitenbereich (Beispiel: 9-11, 21-24).`,
      };
    const von = Number(m[1]);
    const bis = Number(m[2] ?? m[1]);
    if (von < 1 || bis < von)
      return { seiten: [], fehler: `«${teil}»: Bereich muss aufsteigend sein und bei 1 beginnen.` };
    if (max !== undefined && bis > max)
      return { seiten: [], fehler: `«${teil}»: Das PDF hat nur ${max} Seiten.` };
    if (bis - von > 2000) return { seiten: [], fehler: `«${teil}» ist zu gross.` };
    for (let s = von; s <= bis; s++) seiten.add(s);
  }
  return { seiten: [...seiten].sort((a, b) => a - b), fehler: null };
}

/** [3,5,6,7,9] → «3, 5–7, 9» (für Anzeige und Quellenangabe). */
export function seitenbereichText(seiten: number[]): string {
  const s = [...new Set(seiten)].sort((a, b) => a - b);
  const teile: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const start = s[i];
    while (i + 1 < s.length && s[i + 1] === s[i] + 1) i++;
    teile.push(start === s[i] ? `${start}` : `${start}–${s[i]}`);
  }
  return teile.join(', ');
}
