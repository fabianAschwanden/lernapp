/**
 * JSON-Schema für die KI-Antwort (Structured Outputs, `output_config.format`).
 *
 * Regeln von Structured Outputs: Wurzel ist ein Objekt, jedes Objekt hat
 * `additionalProperties: false` und führt ALLE Eigenschaften in `required`.
 * Optionale Werte sind `anyOf [{…}, {type: 'null'}]`. Erlaubt sind nur
 * type/properties/items/enum/anyOf/required/additionalProperties/description.
 *
 * Fragen sind bewusst flach (ein Objekt für alle Typen); die Umwandlung in
 * das echte Lektionsformat übernimmt `ki-umwandlung.ts`.
 */

import { FrageTyp } from '../models/lektion.model';

export const FRAGE_TYPEN: readonly FrageTyp[] = [
  'einfachwahl',
  'mehrfachwahl',
  'wahrfalsch',
  'zuordnen',
  'reihenfolge',
  'zahl',
  'kurzantwort',
  'offen',
];

/** Flache Frage, wie die KI sie liefert. */
export interface KiFrage {
  id: string;
  lernzielId: string;
  typ: FrageTyp;
  frage: string;
  erklaerung: string;
  schwierigkeit: 1 | 2 | 3;
  tipp: string | null;
  optionen: string[] | null;
  richtigIndex: number | null;
  richtigIndizes: number[] | null;
  richtigBool: boolean | null;
  paare: { links: string; rechts: string }[] | null;
  elemente: string[] | null;
  richtigZahl: number | null;
  toleranz: number | null;
  einheit: string | null;
  akzeptiert: string[] | null;
  musterloesung: string | null;
  stichworte: string[] | null;
}

export interface KiLernziel {
  id: string;
  thema: string;
  text: string;
  zusammenfassung: string;
  merksaetze: string[];
  quellenhinweis: string | null;
  ergaenzt: boolean;
}

export interface KiLektion {
  fach: string;
  titel: string;
  beschreibung: string;
  hinweise: string[];
  lernziele: KiLernziel[];
  fragen: KiFrage[];
}

type Schema = Record<string, unknown>;

const text = (description?: string): Schema =>
  description ? { type: 'string', description } : { type: 'string' };
const textListe = (description?: string): Schema => ({
  type: 'array',
  items: { type: 'string' },
  ...(description ? { description } : {}),
});
const oderNull = (s: Schema, description?: string): Schema => ({
  anyOf: [s, { type: 'null' }],
  ...(description ? { description } : {}),
});

/** Objekt mit allen Eigenschaften als Pflichtfeld und ohne Zusatzfelder. */
function objekt(properties: Record<string, Schema>, description?: string): Schema {
  return {
    type: 'object',
    ...(description ? { description } : {}),
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const FRAGE_SCHEMA = objekt(
  {
    id: text('Eindeutig, kebab-case, z. B. f-eva-03'),
    lernzielId: text('id des Lernziels, zu dem die Frage gehört'),
    typ: { type: 'string', enum: [...FRAGE_TYPEN] },
    frage: text('Fragetext (Mini-Markdown)'),
    erklaerung: text('Warum die Lösung stimmt (1–3 Sätze)'),
    schwierigkeit: {
      type: 'integer',
      enum: [1, 2, 3],
      description: '1 Grundwissen, 2 Anwenden, 3 Transfer',
    },
    tipp: oderNull(text(), 'Optionaler Hinweis vor dem Antworten'),
    optionen: oderNull(textListe(), 'einfachwahl/mehrfachwahl: Antwortoptionen'),
    richtigIndex: oderNull({ type: 'integer' }, 'einfachwahl: Index der richtigen Option (ab 0)'),
    richtigIndizes: oderNull(
      { type: 'array', items: { type: 'integer' } },
      'mehrfachwahl: Indizes aller richtigen Optionen',
    ),
    richtigBool: oderNull({ type: 'boolean' }, 'wahrfalsch: true oder false'),
    paare: oderNull(
      { type: 'array', items: objekt({ links: text(), rechts: text() }) },
      'zuordnen: Paare; rechts darf sich wiederholen (Kategorien)',
    ),
    elemente: oderNull(textListe(), 'reihenfolge: Elemente in der richtigen Reihenfolge'),
    richtigZahl: oderNull({ type: 'number' }, 'zahl: richtige Zahl'),
    toleranz: oderNull({ type: 'number' }, 'zahl: erlaubte absolute Abweichung'),
    einheit: oderNull(text(), 'zahl: Einheit, z. B. MB'),
    akzeptiert: oderNull(textListe(), 'kurzantwort: akzeptierte Antworten'),
    musterloesung: oderNull(text(), 'offen: Musterlösung'),
    stichworte: oderNull(textListe(), 'offen: Stichworte einer guten Antwort'),
  },
  'Eine Lernfrage. Nur die zum Typ passenden Felder füllen, alle anderen null.',
);

const LERNZIEL_SCHEMA = objekt({
  id: text('Eindeutig, kebab-case, z. B. lz-eva'),
  thema: text('Themenblock zum Gruppieren'),
  text: text('Formulierung des Lernziels (möglichst wörtlich)'),
  zusammenfassung: text('Lernzettel im Mini-Markdown'),
  merksaetze: textListe('2–5 kurze Merksätze'),
  quellenhinweis: oderNull(text(), 'Fundstelle im Material, z. B. «Skript S. 11»'),
  ergaenzt: { type: 'boolean', description: 'true, wenn der Stoff nicht im Material stand' },
});

/** Schema der gesamten KI-Antwort. */
export const LEKTION_SCHEMA: Schema = objekt({
  fach: text(),
  titel: text(),
  beschreibung: text('1–2 Sätze: worum es in der Lektion geht'),
  hinweise: textListe('Hinweise zur Prüfung, z. B. erlaubte Hilfsmittel'),
  lernziele: { type: 'array', items: LERNZIEL_SCHEMA },
  fragen: { type: 'array', items: FRAGE_SCHEMA },
});
