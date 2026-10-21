/**
 * Datenmodell einer Lektion (Lernpaket).
 *
 * Eine Lektion bündelt den Stoff für eine Prüfung: Lernziele mit Lernzettel
 * und die Fragen, mit denen der Stoff geübt wird. Jede Frage gehört genau
 * zu einem Lernziel — so lässt sich der Lernstand pro Lernziel ausweisen.
 *
 * Das Format ist bewusst reines JSON: Mitgelieferte Lektionen liegen unter
 * `public/lektionen/`, eigene Lektionen in IndexedDB, und Export/Import
 * tauscht dieselbe Struktur als Datei aus.
 */

export const LEKTION_FORMAT_VERSION = 1;

export type LektionHerkunft = 'mitgeliefert' | 'ki' | 'manuell' | 'import';

export interface Lektion {
  /** Stabil und eindeutig, kebab-case, z. B. `informatik-pruefung-1`. */
  id: string;
  /** Formatversion des JSON (siehe LEKTION_FORMAT_VERSION). */
  format: number;
  /** Inhaltsversion — erhöhen, wenn Fragen geändert werden. */
  version: number;
  fach: string;
  titel: string;
  beschreibung: string;
  klasse?: string;
  /** ISO-Datum (JJJJ-MM-TT) der Prüfung, falls bekannt. */
  pruefungsdatum?: string;
  /** Hinweise zur Prüfung, z. B. erlaubte Hilfsmittel. */
  hinweise?: string[];
  /**
   * Kurzfassung der ganzen Lektion zum Durchlesen (Mini-Markdown wie die
   * Lernzettel). `## Titel` gliedert in Abschnitte — die Kurzfassung-Seite zeigt
   * jeden Abschnitt als eigene Karte mit Sprungmarke.
   */
  kurzfassung?: string;
  quellen: Quelle[];
  lernziele: Lernziel[];
  fragen: Frage[];
  herkunft: LektionHerkunft;
  /** ISO-Zeitstempel. */
  erstelltAm: string;
  geaendertAm?: string;
}

export interface Quelle {
  id: string;
  titel: string;
  /** Z. B. «S. 9–11, 21–24». */
  umfang?: string;
}

export interface Bild {
  /** URL relativ zur App (`bilder/...svg`) oder `data:`-URL bei eigenen Bildern. */
  src: string;
  alt: string;
  legende?: string;
}

export interface Lernziel {
  /** Eindeutig innerhalb der Lektion, z. B. `lz-eva`. */
  id: string;
  /** Themenblock, nach dem die Lernziele gruppiert werden. */
  thema: string;
  /** Formulierung des Lernziels (möglichst wörtlich aus der Vorlage). */
  text: string;
  /**
   * Lernzettel im Mini-Markdown: Absätze, `- ` Listen, `**fett**`, `` `code` ``,
   * `### Zwischentitel`. Kein HTML.
   */
  zusammenfassung: string;
  merksaetze?: string[];
  bilder?: Bild[];
  /** Fundstellen im Material, z. B. «Skript 1.1, S. 11». */
  quellenhinweis?: string;
  /** true, wenn der Stoff nicht im mitgegebenen Material stand (ergänzt). */
  ergaenzt?: boolean;
}

export type FrageTyp =
  | 'einfachwahl'
  | 'mehrfachwahl'
  | 'wahrfalsch'
  | 'zuordnen'
  | 'reihenfolge'
  | 'zahl'
  | 'kurzantwort'
  | 'offen';

export const FRAGE_TYP_LABEL: Record<FrageTyp, string> = {
  einfachwahl: 'Eine Antwort',
  mehrfachwahl: 'Mehrere Antworten',
  wahrfalsch: 'Wahr oder falsch',
  zuordnen: 'Zuordnen',
  reihenfolge: 'Reihenfolge',
  zahl: 'Zahl',
  kurzantwort: 'Kurzantwort',
  offen: 'Erklären',
};

interface FrageBasis {
  /** Eindeutig innerhalb der Lektion, z. B. `f-eva-03`. */
  id: string;
  lernzielId: string;
  typ: FrageTyp;
  /** Fragetext im Mini-Markdown (wie Lernzettel, aber kurz). */
  frage: string;
  bild?: Bild;
  /** Erklärung, die nach dem Beantworten erscheint — warum die Lösung stimmt. */
  erklaerung: string;
  /** 1 = Grundwissen, 2 = Anwenden, 3 = Transfer. */
  schwierigkeit: 1 | 2 | 3;
  /** Optionaler Hinweis, der vor dem Antworten aufgedeckt werden kann. */
  tipp?: string;
}

export interface EinfachwahlFrage extends FrageBasis {
  typ: 'einfachwahl';
  optionen: string[];
  /** Index der richtigen Option. */
  richtig: number;
}

export interface MehrfachwahlFrage extends FrageBasis {
  typ: 'mehrfachwahl';
  optionen: string[];
  /** Indizes aller richtigen Optionen (mindestens einer). */
  richtig: number[];
}

export interface WahrFalschFrage extends FrageBasis {
  typ: 'wahrfalsch';
  richtig: boolean;
}

export interface ZuordnenFrage extends FrageBasis {
  typ: 'zuordnen';
  /**
   * Jedes `links`-Element wird einem `rechts`-Wert zugeordnet. `rechts` darf
   * sich wiederholen (Kategorien, z. B. Eingabe/Verarbeitung/Ausgabe).
   */
  paare: { links: string; rechts: string }[];
}

export interface ReihenfolgeFrage extends FrageBasis {
  typ: 'reihenfolge';
  /** Elemente in der richtigen Reihenfolge; die App mischt sie für die Anzeige. */
  elemente: string[];
}

export interface ZahlFrage extends FrageBasis {
  typ: 'zahl';
  richtig: number;
  /** Erlaubte absolute Abweichung (Standard 0). */
  toleranz?: number;
  /** Einheit, die neben dem Eingabefeld steht, z. B. «MB». */
  einheit?: string;
}

export interface KurzantwortFrage extends FrageBasis {
  typ: 'kurzantwort';
  /** Akzeptierte Antworten; verglichen ohne Gross-/Kleinschreibung und Leerzeichen. */
  akzeptiert: string[];
}

export interface OffeneFrage extends FrageBasis {
  typ: 'offen';
  /** Musterlösung, mit der sich die lernende Person selbst einschätzt. */
  musterloesung: string;
  /** Stichworte, die in einer guten Antwort vorkommen sollten. */
  stichworte?: string[];
}

export type Frage =
  | EinfachwahlFrage
  | MehrfachwahlFrage
  | WahrFalschFrage
  | ZuordnenFrage
  | ReihenfolgeFrage
  | ZahlFrage
  | KurzantwortFrage
  | OffeneFrage;

/** Kurzinfo für Listen, ohne alle Fragen laden zu müssen. */
export interface LektionKopf {
  id: string;
  fach: string;
  titel: string;
  beschreibung: string;
  klasse?: string;
  pruefungsdatum?: string;
  herkunft: LektionHerkunft;
  anzahlFragen: number;
  anzahlLernziele: number;
}

export function lektionKopf(l: Lektion): LektionKopf {
  return {
    id: l.id,
    fach: l.fach,
    titel: l.titel,
    beschreibung: l.beschreibung,
    klasse: l.klasse,
    pruefungsdatum: l.pruefungsdatum,
    herkunft: l.herkunft,
    anzahlFragen: l.fragen.length,
    anzahlLernziele: l.lernziele.length,
  };
}
