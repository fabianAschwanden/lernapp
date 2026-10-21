/**
 * Schweizer Notenskala: Note = 1 + 5 × erreichte Punkte / maximale Punkte.
 * 6 ist die Bestnote. Massgebend ist die auf halbe Noten gerundete Note:
 * ab (gerundet) 4 genügend.
 */
export function berechneNote(punkte: number, maxPunkte: number): number {
  if (maxPunkte <= 0) return 1;
  return 1 + (5 * Math.max(0, Math.min(punkte, maxPunkte))) / maxPunkte;
}

/**
 * Auf halbe Noten gerundet, wie es an vielen Schulen üblich ist. Rundet nur
 * einmal (keine Zwischenrundung); das kleine Epsilon gleicht Gleitkomma-Reste
 * aus, z. B. 3.7499999 statt 3.75.
 */
export function halbeNote(note: number): number {
  return Math.round(note * 2 + 1e-9) / 2;
}

/** Genügend, wenn die angezeigte (auf halbe Noten gerundete) Note mindestens 4 ist. */
export function istGenuegend(note: number): boolean {
  return halbeNote(note) >= 4;
}
