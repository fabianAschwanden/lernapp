/** Reine Hilfsfunktionen des Lektions-Editors (ohne Angular). */

import { freieId, slug } from '../../core/domain/id';
import { Frage, FrageTyp, Lektion, Lernziel } from '../../core/models/lektion.model';

export { freieId, slug };

/** Lernziel-id aus Text oder Thema: `lz-<slug>`. */
export function lernzielId(lz: Pick<Lernziel, 'text' | 'thema'>, belegt: ReadonlySet<string>): string {
  const kern = lz.text.replace(/^\s*(ich kann|du kannst|sie können|die lernenden können|sie kennen|ich kenne)\s+/i, '');
  const s = slug(kern.split(/\s+/).slice(0, 5).join(' ')) || slug(lz.thema) || 'ziel';
  return freieId(`lz-${s}`, belegt);
}

/** Zufällige, eindeutige Frage-id: `f-<zufall>`. */
export function neueFrageId(belegt: ReadonlySet<string>, zufall: () => number = Math.random): string {
  for (;;) {
    const id = `f-${Math.floor(zufall() * 36 ** 6)
      .toString(36)
      .padStart(6, '0')}`;
    if (!belegt.has(id)) return id;
  }
}

/** Sinnvolle, leere Vorlage je Fragetyp. */
export function frageVorlage(typ: FrageTyp, id: string, lernzielId: string): Frage {
  const basis = { id, lernzielId, frage: '', erklaerung: '', schwierigkeit: 1 as const };
  switch (typ) {
    case 'einfachwahl':
      return { ...basis, typ, optionen: ['', '', '', ''], richtig: 0 };
    case 'mehrfachwahl':
      return { ...basis, typ, optionen: ['', '', '', ''], richtig: [0] };
    case 'wahrfalsch':
      return { ...basis, typ, richtig: true };
    case 'zuordnen':
      return {
        ...basis,
        typ,
        paare: [
          { links: '', rechts: '' },
          { links: '', rechts: '' },
          { links: '', rechts: '' },
        ],
      };
    case 'reihenfolge':
      return { ...basis, typ, elemente: ['', '', ''] };
    case 'zahl':
      return { ...basis, typ, richtig: 0 };
    case 'kurzantwort':
      return { ...basis, typ, akzeptiert: [''] };
    case 'offen':
      return { ...basis, typ, musterloesung: '', stichworte: [] };
  }
}

/** Fragetext ohne Markdown, gekürzt — für die Liste. */
export function kurztext(text: string, max = 90): string {
  const rein = text
    .replace(/[*`#>|_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!rein) return '(ohne Fragetext)';
  return rein.length > max ? `${rein.slice(0, max - 1)}…` : rein;
}

const leerZuUndefined = (s: string | undefined): string | undefined => (s && s.trim() ? s : undefined);
const ohneLeere = (l: string[] | undefined): string[] => (l ?? []).filter((s) => s.trim());

/**
 * Räumt eine Arbeitskopie für Validierung und Speichern auf: leere optionale
 * Felder (auch eine leere Kurzfassung) und leere Listeneinträge (Hinweise, Merksätze, akzeptierte Antworten,
 * Stichworte) fallen weg. Optionen, Paare und Elemente bleiben, damit die
 * Validierung Lücken meldet und die Indizes der richtigen Antworten stimmen.
 */
export function bereinige(l: Lektion): Lektion {
  const k = structuredClone(l);
  k.klasse = leerZuUndefined(k.klasse);
  k.lehrperson = leerZuUndefined(k.lehrperson);
  k.pruefungsdatum = leerZuUndefined(k.pruefungsdatum);
  k.kurzfassung = leerZuUndefined(k.kurzfassung);
  const hinweise = ohneLeere(k.hinweise);
  k.hinweise = hinweise.length ? hinweise : undefined;
  for (const lz of k.lernziele) {
    const merksaetze = ohneLeere(lz.merksaetze);
    lz.merksaetze = merksaetze.length ? merksaetze : undefined;
    lz.quellenhinweis = leerZuUndefined(lz.quellenhinweis);
    if (!lz.ergaenzt) delete lz.ergaenzt;
  }
  for (const f of k.fragen) {
    f.tipp = leerZuUndefined(f.tipp);
    if (f.typ === 'kurzantwort') f.akzeptiert = ohneLeere(f.akzeptiert);
    if (f.typ === 'offen') {
      const stichworte = ohneLeere(f.stichworte);
      f.stichworte = stichworte.length ? stichworte : undefined;
    }
    if (f.typ === 'zahl') {
      if (f.toleranz === undefined || Number.isNaN(f.toleranz) || f.toleranz === 0)
        delete f.toleranz;
      f.einheit = leerZuUndefined(f.einheit);
    }
  }
  // undefined-Felder entfernen, damit das JSON sauber bleibt
  return JSON.parse(JSON.stringify(k)) as Lektion;
}

/** Ordnet eine Fehlermeldung von validiereLektion einer Frage oder einem Lernziel zu. */
export function fehlerZiel(meldung: string): { art: 'frage' | 'lernziel'; index: number } | null {
  const m = /^(Frage|Lernziel) (\d+)/.exec(meldung);
  if (!m) return null;
  return { art: m[1] === 'Frage' ? 'frage' : 'lernziel', index: Number(m[2]) - 1 };
}

/** Verschiebt ein Element innerhalb einer Liste (in place). */
export function verschiebe<T>(liste: T[], index: number, richtung: -1 | 1): void {
  const ziel = index + richtung;
  if (ziel < 0 || ziel >= liste.length) return;
  [liste[index], liste[ziel]] = [liste[ziel], liste[index]];
}
