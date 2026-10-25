/**
 * Rückmeldung nach der echten Prüfung.
 *
 * Nach der Prüfung hält die lernende Person fest, wie gut Lernziele und Lernstoff
 * zur Prüfung gepasst haben, was drankam und wie schwierig es im Vergleich zur
 * App war. Jede Lehrperson hat ihren eigenen Stil: Die Rückmeldungen eines
 * Fachs werden zu einem Profil zusammengefasst (siehe domain/rueckmeldung.ts),
 * das die Probeprüfung und die Erstellung der nächsten Lektionen beeinflusst.
 *
 * Gespeichert nur lokal (IndexedDB, Store `rueckmeldungen`) und im Backup.
 */

import { FrageTyp } from './lektion.model';

/** Kam das Lernziel an der Prüfung dran? */
export type LernzielAbdeckung = 'ja' | 'teilweise' | 'nein' | 'unklar';

/** Wie viel vom Lernstoff wurde abgefragt? */
export type StoffAbdeckung = 'alles' | 'meiste' | 'teile' | 'wenig';

/** Schwierigkeit der Prüfung im Vergleich zum Üben mit der App: −2 viel leichter … +2 viel schwerer. */
export type SchwierigkeitVergleich = -2 | -1 | 0 | 1 | 2;

/** Zeit an der Prüfung. */
export type PruefungsZeit = 'knapp' | 'passend' | 'reichlich';

/** Aufgabenarten, wie sie an Prüfungen vorkommen (unabhängig von den Fragetypen der App). */
export type Aufgabenart =
  | 'auswahl'
  | 'wahrfalsch'
  | 'begriffe'
  | 'erklaeren'
  | 'rechnen'
  | 'zuordnen'
  | 'beschriften'
  | 'reihenfolge'
  | 'skizze'
  | 'transfer';

export const AUFGABENART_LABEL: Record<Aufgabenart, string> = {
  auswahl: 'Multiple Choice (eine oder mehrere Antworten)',
  wahrfalsch: 'Wahr oder falsch',
  begriffe: 'Begriffe und Definitionen (kurz hinschreiben)',
  erklaeren: 'Erklären, begründen, beschreiben (ganze Sätze)',
  rechnen: 'Rechnen',
  zuordnen: 'Zuordnen, Tabellen ausfüllen',
  beschriften: 'Abbildungen beschriften',
  reihenfolge: 'Reihenfolge, Abläufe',
  skizze: 'Zeichnen, Skizzieren',
  transfer: 'Neue Situationen, Anwendungs- und Transferaufgaben',
};

/** Passende Fragetypen der App je Aufgabenart (für Probeprüfung und KI-Erstellung). */
export const AUFGABENART_FRAGETYPEN: Record<Aufgabenart, readonly FrageTyp[]> = {
  auswahl: ['einfachwahl', 'mehrfachwahl'],
  wahrfalsch: ['wahrfalsch'],
  begriffe: ['kurzantwort'],
  erklaeren: ['offen'],
  rechnen: ['zahl'],
  zuordnen: ['zuordnen'],
  beschriften: ['zuordnen', 'kurzantwort'],
  reihenfolge: ['reihenfolge'],
  skizze: ['offen'],
  transfer: [],
};

export interface LernzielRueckmeldung {
  lernzielId: string;
  /** Wortlaut des Lernziels (bleibt erhalten, auch wenn die Lektion gelöscht wird). */
  text: string;
  abdeckung: LernzielAbdeckung;
}

export interface PruefungsRueckmeldung {
  /** Eindeutig; eine Rückmeldung pro Lektion: `rm-${lektionId}`. */
  id: string;
  lektionId: string;
  lektionTitel: string;
  /** Fach — Schlüssel des Profils (eine Lehrperson pro Fach). */
  fach: string;
  /** Name oder Kürzel der Lehrperson (optional, nur zur Anzeige). */
  lehrperson?: string;
  /** ISO-Datum (JJJJ-MM-TT) der Prüfung. */
  pruefungsdatum?: string;
  /** ISO-Zeitstempel. */
  erstelltAm: string;
  geaendertAm?: string;
  /** Erhaltene Note (1–6), falls bekannt. */
  note?: number;
  /**
   * Wie gut passten die Lernziele zu dem, was drankam? 1 = gar nicht … 5 = genau.
   * Diese drei Angaben sind freiwillig (fehlt = keine Angabe; ältere Rückmeldungen
   * haben sie immer).
   */
  lernzielePassend?: 1 | 2 | 3 | 4 | 5;
  stoffAbgefragt?: StoffAbdeckung;
  schwierigkeit?: SchwierigkeitVergleich;
  zeit?: PruefungsZeit;
  /** Pro Lernziel: kam es dran? */
  lernziele: LernzielRueckmeldung[];
  aufgabenarten: Aufgabenart[];
  /** Was kam dran, das nicht (oder zu wenig) in der App war? */
  ausserhalb?: string;
  /** Erinnerte Prüfungsfragen, möglichst im Wortlaut — zeigen den Stil der Lehrperson. */
  beispielfragen: string[];
  /** Tipps fürs nächste Mal, Eigenheiten der Lehrperson. */
  tipps?: string;
}

/** Zusammenfassung aller Rückmeldungen eines Fachs (= einer Lehrperson). */
export interface LehrpersonProfil {
  /** Normalisiertes Fach (normalisiereText), z. B. `biologie`. */
  schluessel: string;
  /** Fach in der Schreibweise der neuesten Rückmeldung. */
  fach: string;
  /** Genannte Lehrpersonen (ohne Duplikate, neueste zuerst). */
  lehrpersonen: string[];
  anzahl: number;
  /**
   * Gewichteter Mittelwert −2 … +2, neuere Prüfungen zählen mehr (positiv =
   * Prüfungen schwerer als in der App); null ohne Angaben.
   */
  schwierigkeitMittel: number | null;
  /** Mittelwert 1 … 5; null ohne Angaben. */
  lernzielePassendMittel: number | null;
  stoffAbgefragt: Record<StoffAbdeckung, number>;
  /** Anteil drangekommener Lernziele (ja = 1, teilweise = 0,5) unter den beurteilten; null, wenn keine beurteilt. */
  lernzielTreffer: number | null;
  /** Anzahl beurteilter Lernziele (nicht «weiss nicht») über alle Rückmeldungen. */
  lernzieleBeurteilt: number;
  /** Anzahl Lernziele über alle Rückmeldungen. */
  lernzieleGesamt: number;
  /** Wie oft jede Aufgabenart vorkam, häufigste zuerst (nur vorgekommene). */
  aufgabenarten: { art: Aufgabenart; anzahl: number }[];
  /** Anzahl Rückmeldungen mit knapper Zeit. */
  zeitKnapp: number;
  /** Mittelwert der angegebenen Noten oder null. */
  noteMittel: number | null;
  /** Neueste Rückmeldung zuerst. */
  rueckmeldungen: PruefungsRueckmeldung[];
}

/**
 * Stil der Lehrperson für die Probeprüfung: welche Fragetypen bevorzugt und
 * welche Schwierigkeit angestrebt wird.
 */
export interface PruefungsStil {
  /** Fragetypen, die an den Prüfungen vorkamen (leer = keine Vorliebe). */
  bevorzugteTypen: FrageTyp[];
  /** Angestrebte mittlere Schwierigkeit 1 … 3 (2 = wie bisher gemischt). */
  schwierigkeitZiel: number;
}
