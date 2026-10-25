/**
 * Anweisungen an Claude für die Lektionserstellung — einmal für die API
 * (System-Prompt + Auftrag, Antwortformat per JSON-Schema) und einmal als
 * «Prompt zum Kopieren» für claude.ai (mit Zielformat als Beispiel-JSON).
 */

import { FRAGE_TYP_LABEL, FrageTyp, Lektion } from '../models/lektion.model';
import { FRAGE_TYPEN } from './ki-schema';

/** Was die Person im Assistenten angegeben hat. */
export interface KiAuftrag {
  fach: string;
  /** Leer = Claude schlägt einen Titel vor. */
  titel: string;
  klasse?: string;
  /** JJJJ-MM-TT */
  pruefungsdatum?: string;
  /** Freie Hinweise zur Prüfung (eine Zeile pro Hinweis). */
  hinweise: string[];
  /** null = nicht angegeben. */
  taschenrechner: boolean | null;
  /** Z. B. «FMS, 1. Jahr». */
  niveau: string;
  fragenProLernziel: number;
  fragetypen: FrageTyp[];
  /** Lernziele, eine pro Eintrag. Leer, wenn sie im Material stehen. */
  lernziele: string[];
  lernzieleImMaterial: boolean;
  /** Kurzbeschreibung des Materials, z. B. «Skript.pdf: PDF-Seiten 9–11». */
  materialListe: string[];
}

const MINI_MARKDOWN = [
  'Absätze durch Leerzeile',
  '`### Zwischentitel`',
  'Listen mit `- ` oder `1. `',
  'Tabellen mit `| Spalte | Spalte |` (Kopfzeile, dann `|---|---|`)',
  '`**fett**`, `*kursiv*`, `` `code` ``',
  '`2^10` für hochgestellte Zahlen',
].join('; ');

/** Syntax der Kurzfassung: Mini-Markdown plus «## »-Abschnitte und «> »-Merke-Kasten. */
const KURZFASSUNG_SYNTAX = `Mini-Markdown wie bei den Lernzetteln, dazu: \`## Abschnitt\` (Thema), \`### Zwischentitel\`, \`> \` am Zeilenanfang für einen Merke-Kasten (aufeinanderfolgende «> »-Zeilen bilden einen Kasten, Listen darin mit \`> - \`). Erlaubt sonst: ${MINI_MARKDOWN}.`;

/** Rolle und feste Regeln (stabil, unabhängig vom Auftrag). */
export function systemPrompt(): string {
  return `Du bist eine erfahrene Lehrperson und Didaktik-Profi. Du erstellst aus Unterrichtsmaterial eine Lektion für eine Lern-App, mit der sich eine Schülerin oder ein Schüler gezielt auf eine Prüfung vorbereitet.

## Grundsätze
- **Die Lernziele sind massgebend.** Jedes Lernziel bekommt einen Lernzettel (Feld «zusammenfassung») mit 2–5 Merksätzen und die verlangte Anzahl Fragen; dazu kommt eine Kurzfassung der ganzen Lektion (Feld «kurzfassung»). Die Fragen prüfen genau das, was das Lernziel verlangt (Verb beachten: «nennen» → Wissen abfragen, «erklären» → offene Erklärfrage, «berechnen» → Rechenaufgabe, «unterscheiden» → Zuordnen usw.).
- **Nur Stoff aus dem Material.** Lernzettel und Fragen stützen sich auf das mitgegebene Material. Muss etwas ergänzt werden, damit ein Lernziel verständlich wird, markiere das Lernziel mit «ergaenzt»: true und halte Ergänzungen knapp und fachlich gesichert. Nenne im «quellenhinweis» die Fundstelle (z. B. «Skript, PDF-Seite 11»).
- **Handschriftliche Notizen**, Markierungen und Unterstreichungen im Material sind Hinweise der Lehrperson auf Prüfungsschwerpunkte: gewichte diese Themen stärker.
- **Sprache:** Schweizer Hochdeutsch ohne Eszett (immer «ss»), Anrede in der Du-Form, klare und kurze Sätze, Fachbegriffe wie im Material.

## Lernzettel
- Mini-Markdown, sonst nichts (kein HTML, keine Links, keine Bilder). Erlaubt: ${MINI_MARKDOWN}.
- Kompakt und prüfungsorientiert: Definitionen, Zusammenhänge, Beispiele, typische Fehler. Tabellen für Vergleiche.

## Kurzfassung
- Im Feld «kurzfassung» schreibst du zusätzlich eine Kurzfassung der ganzen Lektion zum Durchlesen und Studieren am Stück, angelehnt an die Lernziele und die Lerninhalte. Umfang je nach Stoffmenge etwa 600–1500 Wörter.
- ${KURZFASSUNG_SYNTAX}
- **Bezug auf die Lernziele:** Gliedere mit «## » nach den Themen der Lernziele, in ihrer Reihenfolge; der Titel ist **genau das Thema** (gleicher Wortlaut wie im Feld «thema»). Die App zeigt dann zu Beginn jedes Abschnitts die Lernziele dieses Themas mit Links zu Lernzettel und Üben. Jeder Abschnitt wird eine eigene Karte mit Sprungmarke; Text vor der ersten «## »-Überschrift erscheint als kurze Einleitung.
- Im Abschnitt **je Lernziel ein «### »-Zwischentitel**, in der Reihenfolge der Lernziele, formuliert als Leitfrage zum Lernziel (z. B. Lernziel «Sie wissen, wozu die Zellatmung dient» → «### Wozu dient die Zellatmung?»). Darunter steht genau das, was das Lernziel verlangt: die Kernaussagen in ganzen, verständlichen Sätzen, wichtige Zahlen und Begriffe (fett). Am Ende des Abschnitts ein Merke-Kasten mit «> » für das Wichtigste.
- Am Schluss ein Abschnitt «## Prüfungs-Check» mit typischen Fallen und Verwechslungen.
- Es gelten dieselben Regeln wie für die Lernzettel: nur Stoff aus dem Material, Ergänzungen knapp und fachlich gesichert.

## Fragen
- Gute Mischung der erlaubten Fragetypen, inklusive offener Erklärfragen (Typ «offen» mit Musterlösung und Stichworten), wenn dieser Typ erlaubt ist.
- Schwierigkeit gemischt: 1 = Grundwissen, 2 = Anwenden, 3 = Transfer.
- Jede Frage hat eine «erklaerung»: warum die Lösung stimmt (und bei Auswahlfragen, warum die häufigste falsche Antwort falsch ist). Beginne sie direkt mit der Begründung, nicht mit «Richtig.» oder «Falsch.» — die App zeigt das Ergebnis schon an.
- Distraktoren sind plausibel (typische Verwechslungen), aber eindeutig falsch. Keine Optionen wie «alle obigen» oder «keine davon». Optionen ähnlich lang.
- Die Position der richtigen Antwort variiert (nicht immer die erste oder zweite Option).
- Rechenaufgaben: Zahlen so wählen, dass sie ohne Taschenrechner lösbar sind, wenn kein Taschenrechner erlaubt ist. Bei Typ «zahl» Einheit angeben und bei gerundeten Ergebnissen eine Toleranz.
- Kurzantworten: alle sinnvollen Schreibweisen in «akzeptiert» aufführen (z. B. «RAM», «Arbeitsspeicher»).
- Zuordnen: «rechts» darf sich wiederholen (Kategorien). Reihenfolge: «elemente» in der richtigen Reihenfolge.
- Fragen sind eigenständig verständlich und verweisen nicht auf «das Skript» oder «die Abbildung oben».

## Felder je Fragetyp
- einfachwahl: optionen + richtigIndex (ab 0)
- mehrfachwahl: optionen + richtigIndizes (mindestens einer)
- wahrfalsch: richtigBool
- zuordnen: paare (mindestens zwei, linke Seite eindeutig)
- reihenfolge: elemente (mindestens zwei)
- zahl: richtigZahl, optional toleranz und einheit
- kurzantwort: akzeptiert
- offen: musterloesung und stichworte
Alle nicht passenden Felder sind null. ids sind eindeutig und in kebab-case (Lernziele «lz-…», Fragen «f-…»).`;
}

/** Der konkrete Auftrag (kommt am Ende der Nachricht, nach dem Material). */
export function auftragsText(a: KiAuftrag): string {
  const zeilen: string[] = ['# Auftrag', ''];
  zeilen.push(
    `Erstelle eine Lektion im Fach **${a.fach || 'unbekannt'}**${a.titel ? ` mit dem Titel «${a.titel}»` : ' und schlage einen kurzen Titel vor'}.`,
  );
  if (a.klasse) zeilen.push(`Klasse: ${a.klasse}.`);
  if (a.niveau)
    zeilen.push(
      `Niveau der Lernenden: ${a.niveau}. Formuliere Lernzettel und Fragen passend zu diesem Niveau.`,
    );
  if (a.pruefungsdatum) zeilen.push(`Prüfungsdatum: ${a.pruefungsdatum}.`);
  if (a.taschenrechner === false)
    zeilen.push(
      '**Kein Taschenrechner erlaubt:** Rechenaufgaben müssen von Hand oder im Kopf lösbar sein.',
    );
  if (a.taschenrechner === true) zeilen.push('Taschenrechner ist erlaubt.');
  if (a.hinweise.length) {
    zeilen.push('', 'Hinweise zur Prüfung (übernimm sie in «hinweise»):');
    zeilen.push(...a.hinweise.map((h) => `- ${h}`));
  }

  zeilen.push('');
  if (a.lernziele.length) {
    zeilen.push(
      '## Lernziele (massgebend, Reihenfolge beibehalten, Text möglichst wörtlich übernehmen)',
    );
    zeilen.push(...a.lernziele.map((lz, i) => `${i + 1}. ${lz}`));
    if (a.lernzieleImMaterial)
      zeilen.push(
        '',
        'Weitere Lernziele können im Material stehen (z. B. Foto eines Lernziel-Blatts); übernimm auch diese.',
      );
  } else {
    zeilen.push('## Lernziele');
    zeilen.push(
      a.lernzieleImMaterial
        ? 'Die Lernziele stehen im Material (z. B. ein Lernziel-Blatt). Übernimm sie möglichst wörtlich und in derselben Reihenfolge.'
        : 'Es sind keine Lernziele angegeben. Leite 4–10 sinnvolle, prüfbare Lernziele aus dem Material ab.',
    );
  }

  zeilen.push('', '## Umfang');
  zeilen.push(`- ${a.fragenProLernziel} Fragen pro Lernziel.`);
  const typen = a.fragetypen.length ? a.fragetypen : [...FRAGE_TYPEN];
  zeilen.push(
    `- Erlaubte Fragetypen: ${typen.map((t) => `${t} (${FRAGE_TYP_LABEL[t]})`).join(', ')}. Verwende keine anderen Typen.`,
  );
  if (a.materialListe.length) {
    zeilen.push('', '## Material');
    zeilen.push(...a.materialListe.map((m) => `- ${m}`));
  }
  return zeilen.join('\n');
}

/** Teil der Nachricht an Claude: Bild (base64-JPEG) oder Text. */
export type InhaltsTeil = { art: 'bild'; base64: string } | { art: 'text'; text: string };

/** Ein Inhaltsblock, wie ihn die Messages-API erwartet (Teilmenge). */
export type InhaltsBlock =
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg'; data: string } }
  | { type: 'text'; text: string };

/**
 * Setzt die Nachricht zusammen: Material (Bilder und Texte in der gegebenen
 * Reihenfolge), am Schluss der Auftrag. Leere Texte fallen weg.
 */
export function baueInhalt(
  teile: InhaltsTeil[],
  auftrag: KiAuftrag,
  nurJson = false,
): InhaltsBlock[] {
  const bloecke: InhaltsBlock[] = [];
  for (const t of teile) {
    if (t.art === 'bild')
      bloecke.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: t.base64 },
      });
    else if (t.text.trim()) bloecke.push({ type: 'text', text: t.text });
  }
  let anweisung = auftragsText(auftrag);
  if (nurJson) anweisung += `\n\n${NUR_JSON_KI}`;
  bloecke.push({ type: 'text', text: anweisung });
  return bloecke;
}

/** Zusatz, falls die API ohne Schema aufgerufen werden muss. */
const NUR_JSON_KI = `## Antwortformat
Antworte nur mit einem JSON-Objekt (ohne Text davor oder danach, ohne Codeblock) mit den Feldern fach, titel, beschreibung, hinweise (Liste), lernziele (Liste von {id, thema, text, zusammenfassung, merksaetze, quellenhinweis, ergaenzt}), kurzfassung (Text, Mini-Markdown mit «## »-Abschnitten) und fragen (Liste von {id, lernzielId, typ, frage, erklaerung, schwierigkeit, tipp, optionen, richtigIndex, richtigIndizes, richtigBool, paare, elemente, richtigZahl, toleranz, einheit, akzeptiert, musterloesung, stichworte}; nicht passende Felder null).`;

/** Kompaktes Beispiel im echten Lektionsformat (für den Kopier-Prompt). */
export const BEISPIEL_LEKTION: Omit<
  Lektion,
  'id' | 'format' | 'version' | 'herkunft' | 'erstelltAm' | 'quellen'
> = {
  fach: 'Informatik',
  titel: 'Grundlagen der Informatik',
  beschreibung: 'EVA-Prinzip, Hardware und Speichereinheiten.',
  hinweise: ['Kein Taschenrechner erlaubt'],
  lernziele: [
    {
      id: 'lz-eva',
      thema: 'Grundlagen',
      text: 'Du kannst das EVA-Prinzip erklären.',
      zusammenfassung:
        '### EVA-Prinzip\nJeder Computer arbeitet nach **E**ingabe – **V**erarbeitung – **A**usgabe.\n\n- Eingabe: Tastatur, Maus\n- Ausgabe: Bildschirm',
      merksaetze: ['Eingabe → Verarbeitung → Ausgabe'],
      quellenhinweis: 'Skript, PDF-Seite 9',
    },
  ],
  kurzfassung:
    'Wie ein Computer Daten verarbeitet.\n\n## Grundlagen\n### Wie funktioniert das EVA-Prinzip?\nJeder Computer arbeitet nach **E**ingabe – **V**erarbeitung – **A**usgabe. Tastatur und Maus sind Eingabegeräte, die **CPU** verarbeitet, Bildschirm und Drucker geben aus.\n\n> **Merke:** Eingabe → Verarbeitung → Ausgabe\n\n## Prüfungs-Check\n- Der Drucker ist ein Ausgabe-, kein Eingabegerät.\n- 1 Byte = 8 Bit',
  fragen: [
    {
      id: 'f-eva-01',
      lernzielId: 'lz-eva',
      typ: 'einfachwahl',
      frage: 'Wofür steht das V in EVA?',
      optionen: ['Vernetzung', 'Verarbeitung', 'Verwaltung'],
      richtig: 1,
      erklaerung: 'EVA = Eingabe, Verarbeitung, Ausgabe.',
      schwierigkeit: 1,
    },
    {
      id: 'f-eva-02',
      lernzielId: 'lz-eva',
      typ: 'mehrfachwahl',
      frage: 'Welche Geräte sind Eingabegeräte?',
      optionen: ['Tastatur', 'Drucker', 'Maus', 'Bildschirm'],
      richtig: [0, 2],
      erklaerung: 'Tastatur und Maus geben Daten in den Computer ein.',
      schwierigkeit: 1,
    },
    {
      id: 'f-eva-03',
      lernzielId: 'lz-eva',
      typ: 'wahrfalsch',
      frage: 'Der Drucker ist ein Ausgabegerät.',
      richtig: true,
      erklaerung: 'Er gibt Daten auf Papier aus.',
      schwierigkeit: 1,
    },
    {
      id: 'f-eva-04',
      lernzielId: 'lz-eva',
      typ: 'zuordnen',
      frage: 'Ordne zu.',
      paare: [
        { links: 'Tastatur', rechts: 'Eingabe' },
        { links: 'Bildschirm', rechts: 'Ausgabe' },
        { links: 'Maus', rechts: 'Eingabe' },
      ],
      erklaerung: '…',
      schwierigkeit: 2,
    },
    {
      id: 'f-eva-05',
      lernzielId: 'lz-eva',
      typ: 'reihenfolge',
      frage: 'Bringe in die richtige Reihenfolge.',
      elemente: ['Eingabe', 'Verarbeitung', 'Ausgabe'],
      erklaerung: '…',
      schwierigkeit: 1,
    },
    {
      id: 'f-eva-06',
      lernzielId: 'lz-eva',
      typ: 'zahl',
      frage: 'Wie viele Bit hat ein Byte?',
      richtig: 8,
      einheit: 'Bit',
      erklaerung: '1 Byte = 8 Bit.',
      schwierigkeit: 1,
    },
    {
      id: 'f-eva-07',
      lernzielId: 'lz-eva',
      typ: 'kurzantwort',
      frage: 'Wie heisst der Hauptprozessor (Abkürzung)?',
      akzeptiert: ['CPU'],
      erklaerung: 'CPU = Central Processing Unit.',
      schwierigkeit: 1,
    },
    {
      id: 'f-eva-08',
      lernzielId: 'lz-eva',
      typ: 'offen',
      frage: 'Erkläre das EVA-Prinzip an einem Beispiel.',
      musterloesung: 'Beim Taschenrechner tippe ich Zahlen ein (Eingabe) …',
      stichworte: ['Eingabe', 'Verarbeitung', 'Ausgabe'],
      erklaerung: 'Ein Beispiel mit allen drei Schritten zeigt das Verständnis.',
      schwierigkeit: 2,
      tipp: 'Denk an ein Gerät aus dem Alltag.',
    },
  ],
};

/**
 * Prompt zum Kopieren in claude.ai (ohne API-Schlüssel): dieselbe Anweisung,
 * dazu das Zielformat (echtes Lektionsformat) und die Bitte, nur JSON zu
 * antworten. PDFs und Fotos hängt die Person selbst an; eingefügte Texte
 * (`texte`) gibt es nur in der App und stehen darum direkt im Prompt.
 */
export function kopierPrompt(
  a: KiAuftrag,
  texte: readonly { titel: string; text: string }[] = [],
): string {
  const eingefuegt = texte.length
    ? `\n\n## Eingefügte Texte\n${texte.map((t) => `\n### Text «${t.titel || 'eingefügter Text'}»\n\n${t.text}`).join('\n')}`
    : '';
  const angehaengt =
    a.materialListe.length > texte.length || !texte.length
      ? `\n\n${texte.length ? 'Das übrige Material (PDFs, Fotos)' : 'Das Material'} habe ich an diese Nachricht angehängt. Verwende bei PDFs nur die oben genannten Seiten (PDF-Seiten, nicht die gedruckten Seitenzahlen).`
      : '';
  return `${systemPrompt()}

${auftragsText(a)}${eingefuegt}${angehaengt}

## Zielformat
Antworte im folgenden Lektionsformat (Beispiel mit je einer Frage pro Typ). Abweichend von der Feldliste oben heisst die Lösung hier immer «richtig»: Index (einfachwahl), Liste von Indizes (mehrfachwahl), true/false (wahrfalsch) oder Zahl (zahl). Felder, die nicht passen, lässt du weg.

${JSON.stringify(BEISPIEL_LEKTION)}

## Wichtig
Antworte NUR mit dem JSON-Objekt der Lektion (gern in einem einzigen \`\`\`json-Codeblock, damit ich es vollständig kopieren kann) — ohne weiteren Text davor oder danach.`;
}
