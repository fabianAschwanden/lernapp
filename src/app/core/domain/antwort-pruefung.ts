import { Bewertung } from '../models/fortschritt.model';
import { Frage } from '../models/lektion.model';
import { normalisiereText, parseZahl } from './text';

/** Die Eingabe der lernenden Person — je Fragetyp eine eigene Form. */
export type Antwort =
  | { typ: 'einfachwahl'; wahl: number }
  | { typ: 'mehrfachwahl'; wahl: number[] }
  | { typ: 'wahrfalsch'; wert: boolean }
  /** Index des Paares → gewählter `rechts`-Wert. */
  | { typ: 'zuordnen'; zuordnung: Record<number, string> }
  /** Die Elemente in der Reihenfolge, wie die Person sie angeordnet hat. */
  | { typ: 'reihenfolge'; reihenfolge: string[] }
  | { typ: 'zahl'; eingabe: string }
  | { typ: 'kurzantwort'; eingabe: string }
  /** Offene Fragen bewertet die Person selbst anhand der Musterlösung. */
  | { typ: 'offen'; selbst: Bewertung };

export interface Pruefergebnis {
  bewertung: Bewertung;
  /** Erreichter Anteil zwischen 0 und 1 (für Teilpunkte in der Probeprüfung). */
  anteil: number;
}

function ausAnteil(anteil: number): Pruefergebnis {
  const a = Number.isFinite(anteil) ? Math.max(0, Math.min(1, anteil)) : 0;
  return { anteil: a, bewertung: a >= 1 ? 'richtig' : a > 0 ? 'teilweise' : 'falsch' };
}

/**
 * Prüft eine Antwort gegen die Frage. Passt der Antworttyp nicht zur Frage,
 * gilt sie als falsch (statt zu werfen) — die Oberfläche soll nie hängen bleiben.
 */
export function pruefeAntwort(frage: Frage, antwort: Antwort): Pruefergebnis {
  if (frage.typ !== antwort.typ) return ausAnteil(0);

  switch (frage.typ) {
    case 'einfachwahl': {
      const a = antwort as Extract<Antwort, { typ: 'einfachwahl' }>;
      return ausAnteil(a.wahl === frage.richtig ? 1 : 0);
    }
    case 'mehrfachwahl': {
      const a = antwort as Extract<Antwort, { typ: 'mehrfachwahl' }>;
      const richtig = new Set(frage.richtig);
      const gewaehlt = new Set(a.wahl);
      let treffer = 0;
      let fehlgriffe = 0;
      for (const w of gewaehlt) {
        if (richtig.has(w)) treffer++;
        else fehlgriffe++;
      }
      // Jeder Fehlgriff hebt einen Treffer auf — sonst lohnt «alles ankreuzen».
      return ausAnteil((treffer - fehlgriffe) / richtig.size);
    }
    case 'wahrfalsch': {
      const a = antwort as Extract<Antwort, { typ: 'wahrfalsch' }>;
      return ausAnteil(a.wert === frage.richtig ? 1 : 0);
    }
    case 'zuordnen': {
      const a = antwort as Extract<Antwort, { typ: 'zuordnen' }>;
      const korrekt = frage.paare.filter((p, i) => a.zuordnung[i] === p.rechts).length;
      return ausAnteil(korrekt / frage.paare.length);
    }
    case 'reihenfolge': {
      const a = antwort as Extract<Antwort, { typ: 'reihenfolge' }>;
      const korrekt = frage.elemente.filter((e, i) => a.reihenfolge[i] === e).length;
      return ausAnteil(korrekt / frage.elemente.length);
    }
    case 'zahl': {
      const a = antwort as Extract<Antwort, { typ: 'zahl' }>;
      const wert = parseZahl(a.eingabe);
      if (wert === null) return ausAnteil(0);
      const toleranz = frage.toleranz ?? 0;
      // Kleiner Puffer gegen Rundungsfehler bei Kommazahlen.
      return ausAnteil(Math.abs(wert - frage.richtig) <= toleranz + 1e-9 ? 1 : 0);
    }
    case 'kurzantwort': {
      const a = antwort as Extract<Antwort, { typ: 'kurzantwort' }>;
      const eingabe = normalisiereText(a.eingabe);
      if (!eingabe) return ausAnteil(0);
      return ausAnteil(frage.akzeptiert.some((x) => normalisiereText(x) === eingabe) ? 1 : 0);
    }
    case 'offen': {
      const a = antwort as Extract<Antwort, { typ: 'offen' }>;
      return ausAnteil(a.selbst === 'richtig' ? 1 : a.selbst === 'teilweise' ? 0.5 : 0);
    }
  }
}

/** Menschlich lesbare richtige Lösung — für die Anzeige nach dem Antworten. */
export function loesungAlsText(frage: Frage): string {
  switch (frage.typ) {
    case 'einfachwahl':
      return frage.optionen[frage.richtig] ?? '';
    case 'mehrfachwahl':
      return frage.richtig.map((i) => frage.optionen[i]).join(' · ');
    case 'wahrfalsch':
      return frage.richtig ? 'Wahr' : 'Falsch';
    case 'zuordnen':
      return frage.paare.map((p) => `${p.links} → ${p.rechts}`).join(' · ');
    case 'reihenfolge':
      return frage.elemente.join(' → ');
    case 'zahl':
      return `${formatZahl(frage.richtig)}${frage.einheit ? ' ' + frage.einheit : ''}`;
    case 'kurzantwort':
      return frage.akzeptiert[0] ?? '';
    case 'offen':
      return frage.musterloesung;
  }
}

/** Schweizer Zahlformat mit Apostroph als Tausendertrennzeichen. */
export function formatZahl(n: number): string {
  return new Intl.NumberFormat('de-CH', { maximumFractionDigits: 6 }).format(n);
}
