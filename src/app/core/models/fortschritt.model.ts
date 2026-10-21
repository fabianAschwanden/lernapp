/**
 * Lernstand pro Frage — ein Leitner-Karteikasten mit fünf Fächern.
 *
 * Fach 0 = noch nie beantwortet. Eine richtige Antwort schiebt die Frage ein
 * Fach weiter, eine falsche zurück in Fach 1. Je höher das Fach, desto später
 * wird die Frage wieder fällig (siehe planer.ts).
 */

export const MAX_FACH = 5;

export interface FrageFortschritt {
  /** `${lektionId}::${frageId}` — Primärschlüssel in IndexedDB. */
  schluessel: string;
  lektionId: string;
  frageId: string;
  /** 0 (neu) bis MAX_FACH (sitzt). */
  fach: number;
  richtig: number;
  falsch: number;
  /** ISO-Zeitstempel der letzten Antwort. */
  zuletzt?: string;
  /** ISO-Zeitstempel, ab wann die Frage wieder fällig ist. */
  faelligAb?: string;
  /** Die letzten (max. 5) Ergebnisse, neuestes zuletzt. */
  verlauf: Bewertung[];
}

/**
 * Ergebnis einer beantworteten Frage. `teilweise` gibt es bei Teilpunkten
 * und bei der Selbsteinschätzung offener Fragen.
 */
export type Bewertung = 'richtig' | 'teilweise' | 'falsch';

export function fortschrittSchluessel(lektionId: string, frageId: string): string {
  return `${lektionId}::${frageId}`;
}

export function neuerFortschritt(lektionId: string, frageId: string): FrageFortschritt {
  return {
    schluessel: fortschrittSchluessel(lektionId, frageId),
    lektionId,
    frageId,
    fach: 0,
    richtig: 0,
    falsch: 0,
    verlauf: [],
  };
}

/** Ergebnis einer abgeschlossenen Probeprüfung (für die Verlaufsanzeige). */
export interface PruefungsErgebnis {
  id: string;
  lektionId: string;
  /** ISO-Zeitstempel. */
  am: string;
  punkte: number;
  maxPunkte: number;
  note: number;
  dauerSekunden: number;
  /** Punkte pro Lernziel, um Schwächen anzuzeigen. */
  proLernziel: Record<string, { punkte: number; max: number }>;
}
