import { Antwort } from '../../core/domain/antwort-pruefung';
import { Bewertung } from '../../core/models/fortschritt.model';

/** true, wenn die Antwort etwas enthält, das sich bewerten lässt (nicht leer). */
export function istBeantwortet(a: Antwort | null | undefined): boolean {
  if (!a) return false;
  switch (a.typ) {
    case 'mehrfachwahl':
      return a.wahl.length > 0;
    case 'zuordnen':
      return Object.keys(a.zuordnung).length > 0;
    case 'zahl':
    case 'kurzantwort':
      return a.eingabe.trim().length > 0;
    default:
      return true;
  }
}

export const BEWERTUNG_LABEL: Record<Bewertung, string> = {
  richtig: 'Richtig',
  teilweise: 'Teilweise',
  falsch: 'Falsch',
};

export const BEWERTUNG_CHIP: Record<Bewertung, string> = {
  richtig: 'gut',
  teilweise: 'mittel',
  falsch: 'schlecht',
};

/** Mini-Markdown als kurzer Klartext, z. B. für Listen und Überschriften. */
export function kurzText(md: string, max = 90): string {
  const text = md
    .replace(/[`*#|^]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
}
