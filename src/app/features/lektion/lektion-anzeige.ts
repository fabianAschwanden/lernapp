/** Kleine Anzeige-Hilfen für Lektionen (Startseite, Übersicht, Lernzettel). */

import { LektionHerkunft } from '../../core/models/lektion.model';
import { StandStufe } from '../../core/domain/planer';

const TAG_MS = 24 * 60 * 60 * 1000;

/**
 * Ganze Kalendertage von heute bis zum Datum (JJJJ-MM-TT), in lokaler Zeit.
 * 0 = heute, negativ = vorbei, null = kein gültiges Datum.
 */
export function tageBis(datum: string | undefined, jetzt = new Date()): number | null {
  const m = datum ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum) : null;
  if (!m) return null;
  const ziel = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const heute = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate());
  return Math.round((ziel.getTime() - heute.getTime()) / TAG_MS);
}

/** «Prüfung heute», «Prüfung morgen», «Prüfung in 5 Tagen»; vergangene → null. */
export function countdownText(tage: number | null): string | null {
  if (tage === null || tage < 0) return null;
  if (tage === 0) return 'Prüfung heute';
  if (tage === 1) return 'Prüfung morgen';
  return `Prüfung in ${tage} Tagen`;
}

/** Datum (JJJJ-MM-TT) lesbar, z. B. «Mo., 27.10.2026». */
export function datumLang(datum: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum);
  if (!m) return datum;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('de-CH', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/** Chip-Text für die Herkunft; mitgelieferte Lektionen bekommen keinen Chip. */
export const HERKUNFT_LABEL: Record<LektionHerkunft, string | null> = {
  mitgeliefert: null,
  ki: 'Mit KI erstellt',
  import: 'Importiert',
  manuell: 'Eigene Lektion',
};

/** Farbklasse für `.balken` und `.chip` je Lernstand-Stufe. */
export const STUFE_KLASSE: Record<StandStufe, string> = {
  neu: '',
  'am-lernen': 'mittel',
  fast: 'primaer',
  sitzt: 'gut',
};
