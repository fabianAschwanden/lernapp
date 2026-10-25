/**
 * Rückmeldungen nach der echten Prüfung und das daraus abgeleitete Profil pro
 * Fach (= Lehrperson). Reine Funktionen ohne Angular.
 */

import { Lektion } from '../models/lektion.model';
import {
  AUFGABENART_FRAGETYPEN,
  AUFGABENART_LABEL,
  Aufgabenart,
  LehrpersonProfil,
  LernzielAbdeckung,
  LernzielRueckmeldung,
  PruefungsRueckmeldung,
  PruefungsStil,
  PruefungsZeit,
  SchwierigkeitVergleich,
  StoffAbdeckung,
} from '../models/rueckmeldung.model';
import { istObjekt } from './pruefhilfen';
import { normalisiereText } from './text';

// ---------- Bezeichnungen für die Anzeige ----------

export const ABDECKUNG_LABEL: Record<LernzielAbdeckung, string> = {
  ja: 'Ja',
  teilweise: 'Teilweise',
  nein: 'Nein',
  unklar: 'Weiss nicht',
};

export const STOFF_LABEL: Record<StoffAbdeckung, string> = {
  alles: 'Ja, alles',
  meiste: 'Das meiste',
  teile: 'Nur Teile',
  wenig: 'Nur wenig',
};

export const SCHWIERIGKEIT_LABEL: Record<SchwierigkeitVergleich, string> = {
  [-2]: 'Viel leichter',
  [-1]: 'Etwas leichter',
  0: 'Etwa gleich',
  1: 'Etwas schwerer',
  2: 'Viel schwerer',
};

export const PASSEND_LABEL: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'Gar nicht',
  2: 'Wenig',
  3: 'Teilweise',
  4: 'Gut',
  5: 'Genau',
};

export const ZEIT_LABEL: Record<PruefungsZeit, string> = {
  knapp: 'Knapp',
  passend: 'Passend',
  reichlich: 'Reichlich',
};

/** Längengrenzen (auch für `maxlength` im Formular). */
export const RUECKMELDUNG_GRENZEN = {
  kurz: 120,
  text: 4000,
  beispielfrage: 2000,
  beispielfragen: 50,
  lernziele: 300,
} as const;

const AUFGABENARTEN = Object.keys(AUFGABENART_LABEL) as Aufgabenart[];
const ABDECKUNGEN = Object.keys(ABDECKUNG_LABEL) as LernzielAbdeckung[];
export const STOFFE = Object.keys(STOFF_LABEL) as StoffAbdeckung[];
const ZEITEN = Object.keys(ZEIT_LABEL) as PruefungsZeit[];

// ---------- Rückmeldung anlegen und abgleichen ----------

/** Schlüssel des Profils: das normalisierte Fach (eine Lehrperson pro Fach). */
export function profilSchluessel(fach: string): string {
  return normalisiereText(fach);
}

/**
 * Neue Rückmeldung zu einer Lektion. Passung, Stoff und Schwierigkeit bleiben
 * offen (keine Vorbelegung, die als echte Antwort ins Profil einginge).
 */
export function neueRueckmeldung(lektion: Lektion, jetzt = new Date()): PruefungsRueckmeldung {
  const r: PruefungsRueckmeldung = {
    id: `rm-${lektion.id}`,
    lektionId: lektion.id,
    lektionTitel: lektion.titel,
    fach: lektion.fach,
    erstelltAm: jetzt.toISOString(),
    lernziele: lektion.lernziele.map((lz) => ({
      lernzielId: lz.id,
      text: lz.text,
      abdeckung: 'unklar',
    })),
    aufgabenarten: [],
    beispielfragen: [],
  };
  if (lektion.lehrperson?.trim()) r.lehrperson = lektion.lehrperson.trim();
  if (lektion.pruefungsdatum) r.pruefungsdatum = lektion.pruefungsdatum;
  return r;
}

/**
 * Passt die Lernziel-Liste an die aktuelle Lektion an: neue Lernziele kommen
 * als «unklar» dazu, der Wortlaut wird aktualisiert, entfernte Lernziele
 * bleiben nur, wenn sie schon beurteilt sind (am Ende der Liste).
 */
export function abgleichMitLektion(
  r: PruefungsRueckmeldung,
  lektion: Lektion,
): PruefungsRueckmeldung {
  const alt = new Map(r.lernziele.map((x) => [x.lernzielId, x]));
  const ids = new Set(lektion.lernziele.map((lz) => lz.id));
  const lernziele: LernzielRueckmeldung[] = [
    ...lektion.lernziele.map((lz) => ({
      lernzielId: lz.id,
      text: lz.text,
      abdeckung: alt.get(lz.id)?.abdeckung ?? ('unklar' as const),
    })),
    ...r.lernziele.filter((x) => !ids.has(x.lernzielId) && x.abdeckung !== 'unklar'),
  ];
  return { ...r, lektionTitel: lektion.titel, lernziele };
}

// ---------- Profil ----------

/**
 * Zeitpunkt für «neueste zuerst»: Prüfungsdatum, sonst Erfassung. Nur innerhalb
 * derselben Art vergleichbar (siehe lehrpersonProfile: mit Prüfungsdatum zuerst).
 */
function zeitpunkt(r: PruefungsRueckmeldung): string {
  return r.pruefungsdatum || r.erstelltAm || '';
}

const mittel = (zahlen: number[]): number | null =>
  zahlen.length ? zahlen.reduce((s, z) => s + z, 0) / zahlen.length : null;

/** Mittel nach Aktualität gewichtet: die i-te Zahl (0 = neueste) zählt 0,5^i. */
const gewichtetesMittel = (zahlen: number[]): number | null => {
  if (!zahlen.length) return null;
  const g = zahlen.map((_, i) => 0.5 ** i);
  return zahlen.reduce((s, z, i) => s + g[i] * z, 0) / g.reduce((a, b) => a + b, 0);
};

const definiert = <T>(werte: (T | undefined)[]): T[] =>
  werte.filter((w): w is T => w !== undefined);

const TREFFER: Record<LernzielAbdeckung, number | null> = {
  ja: 1,
  teilweise: 0.5,
  nein: 0,
  unklar: null,
};

function erstelleProfil(rs: PruefungsRueckmeldung[]): LehrpersonProfil {
  const lehrpersonen: string[] = [];
  const gesehen = new Set<string>();
  for (const r of rs) {
    const name = r.lehrperson?.trim();
    if (name && !gesehen.has(normalisiereText(name))) {
      gesehen.add(normalisiereText(name));
      lehrpersonen.push(name);
    }
  }
  const stoffAbgefragt = { alles: 0, meiste: 0, teile: 0, wenig: 0 } as Record<
    StoffAbdeckung,
    number
  >;
  for (const r of rs) if (r.stoffAbgefragt) stoffAbgefragt[r.stoffAbgefragt]++;
  const treffer = rs.flatMap((r) => r.lernziele.flatMap((lz) => TREFFER[lz.abdeckung] ?? []));
  const arten = new Map<Aufgabenart, number>();
  for (const r of rs)
    for (const a of new Set(r.aufgabenarten)) arten.set(a, (arten.get(a) ?? 0) + 1);

  return {
    schluessel: profilSchluessel(rs[0].fach),
    fach: rs[0].fach.trim(),
    lehrpersonen,
    anzahl: rs.length,
    schwierigkeitMittel: gewichtetesMittel(definiert(rs.map((r) => r.schwierigkeit))),
    lernzielePassendMittel: mittel(definiert(rs.map((r) => r.lernzielePassend))),
    stoffAbgefragt,
    lernzielTreffer: mittel(treffer),
    lernzieleBeurteilt: treffer.length,
    lernzieleGesamt: rs.reduce((s, r) => s + r.lernziele.length, 0),
    aufgabenarten: [...arten.entries()]
      .map(([art, anzahl]) => ({ art, anzahl }))
      .sort(
        (a, b) =>
          b.anzahl - a.anzahl || AUFGABENARTEN.indexOf(a.art) - AUFGABENARTEN.indexOf(b.art),
      ),
    zeitKnapp: rs.filter((r) => r.zeit === 'knapp').length,
    noteMittel: mittel(rs.flatMap((r) => (typeof r.note === 'number' ? [r.note] : []))),
    rueckmeldungen: rs,
  };
}

/**
 * Fasst die Rückmeldungen pro Fach zusammen. Rückmeldungen und Profile sind
 * sortiert: mit Prüfungsdatum zuerst (neueste zuerst), danach ohne Datum nach
 * Erfassung (neueste zuerst). Eine nachgetragene ältere Prüfung ohne Datum
 * gilt so nicht als neueste.
 */
export function lehrpersonProfile(rs: readonly PruefungsRueckmeldung[]): LehrpersonProfil[] {
  const sortiert = [...rs].sort(
    (a, b) =>
      Number(!!b.pruefungsdatum) - Number(!!a.pruefungsdatum) ||
      zeitpunkt(b).localeCompare(zeitpunkt(a)),
  );
  const gruppen = new Map<string, PruefungsRueckmeldung[]>();
  for (const r of sortiert) {
    const s = profilSchluessel(r.fach);
    gruppen.set(s, [...(gruppen.get(s) ?? []), r]);
  }
  return [...gruppen.values()].map(erstelleProfil);
}

export function profilFuerFach(
  rs: readonly PruefungsRueckmeldung[],
  fach: string,
): LehrpersonProfil | null {
  const s = profilSchluessel(fach);
  const passend = rs.filter((r) => profilSchluessel(r.fach) === s);
  return passend.length ? lehrpersonProfile(passend)[0] : null;
}

/** Anteil der Prüfungen, an denen diese Aufgabenart vorkam (0–1). */
function anteilArt(p: LehrpersonProfil, art: Aufgabenart): number {
  return p.anzahl ? (p.aufgabenarten.find((a) => a.art === art)?.anzahl ?? 0) / p.anzahl : 0;
}

/**
 * Stil der Lehrperson für die Probeprüfung. Schwierigkeit: 2 + Mittel/2
 * (Prüfungen viel schwerer → 3, viel leichter → 1, ohne Angabe 2); Transfer-
 * Aufgaben heben das Ziel zusätzlich um bis zu 0,5.
 */
export function pruefungsStil(p: LehrpersonProfil | null | undefined): PruefungsStil | null {
  if (!p || !p.anzahl) return null;
  const bevorzugteTypen = [
    ...new Set(p.aufgabenarten.flatMap((a) => AUFGABENART_FRAGETYPEN[a.art])),
  ];
  const ziel = 2 + (p.schwierigkeitMittel ?? 0) / 2 + 0.5 * anteilArt(p, 'transfer');
  return { bevorzugteTypen, schwierigkeitZiel: Math.min(3, Math.max(1, ziel)) };
}

// ---------- Profil als Text (KI-Prompt, Kopieren, Export) ----------

/** Schwierigkeit −2 … +2 in Worten. */
export function schwierigkeitInWorten(mittelwert: number): string {
  if (mittelwert <= -1.25) return 'viel leichter als das Üben mit der App';
  if (mittelwert <= -0.5) return 'eher leichter als das Üben mit der App';
  if (mittelwert < 0.5) return 'etwa gleich schwer wie das Üben mit der App';
  if (mittelwert < 1.25) return 'eher schwerer als das Üben mit der App';
  return 'viel schwerer als das Üben mit der App';
}

/** Mittelwert 1 … 5 auf die nächste ganze Stufe gerundet. */
export function stufe(mittel: number): 1 | 2 | 3 | 4 | 5 {
  return Math.min(5, Math.max(1, Math.round(mittel))) as 1 | 2 | 3 | 4 | 5;
}

/** Wie gut die Lernziele passten (Mittel 1 … 5) in Worten. */
export function passendInWorten(mittelwert: number): string {
  return PASSEND_LABEL[stufe(mittelwert)].toLowerCase();
}

/** Zahl im Schweizer Format, z. B. 4.5 → «4.5». */
export const zahl = (x: number, stellen = 1): string =>
  x.toLocaleString('de-CH', { maximumFractionDigits: stellen, minimumFractionDigits: 0 });
const vorzeichen = (x: number): string => (x > 0 ? `+${zahl(x)}` : x < 0 ? `−${zahl(-x)}` : '0');
/** Eingaben einzeilig und begrenzt, damit sie die Markdown-Struktur nicht stören. */
const zeile = (t: string, max = 600): string => {
  const s = t.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

const STOFF_TEXT: Record<StoffAbdeckung, string> = {
  alles: 'der ganze Stoff',
  meiste: 'das meiste',
  teile: 'nur Teile',
  wenig: 'nur wenig',
};

const MAX_LISTE = 40;

function liste(eintraege: string[]): string[] {
  const zeilen = eintraege.slice(0, MAX_LISTE).map((e) => `- ${e}`);
  if (eintraege.length > MAX_LISTE) zeilen.push(`- … und ${eintraege.length - MAX_LISTE} weitere`);
  return zeilen;
}

/**
 * Wie die Lernziele zur Prüfung passten:
 * - `hinaus`: Es kam Stoff über die Lernziele hinaus dran (ausdrücklich genannt
 *   oder: Lernziele kamen fast alle dran und passten trotzdem schlecht).
 * - `teilweise`: Passung tief, weil viele Lernziele nicht drankamen.
 * - `unklar`: Passung tief, aber keine Lernziele beurteilt.
 * - `gut`: Passung hoch. null: nichts Auffälliges oder keine Angabe.
 */
export function passungsBefund(
  p: LehrpersonProfil,
): 'hinaus' | 'teilweise' | 'unklar' | 'gut' | null {
  if (p.rueckmeldungen.some((r) => r.ausserhalb?.trim())) return 'hinaus';
  const m = p.lernzielePassendMittel;
  if (m === null) return null;
  if (m <= 2.5) {
    if (p.lernzielTreffer === null) return 'unklar';
    return p.lernzielTreffer < 0.75 ? 'teilweise' : 'hinaus';
  }
  return m >= 4 ? 'gut' : null;
}

/** Konkrete Folgerungen für die nächste Lektion. */
export function folgerungen(p: LehrpersonProfil): string[] {
  const f: string[] = [];
  const m = p.schwierigkeitMittel ?? 0;
  const anteil = (art: Aufgabenart) => anteilArt(p, art);
  if (m >= 1.25) {
    f.push(
      'Die Prüfungen waren deutlich schwerer als die App: mindestens ein Drittel der Fragen mit Schwierigkeit 3 (Anwenden in neuen Situationen, Transfer), weniger reine Wiedergabe.',
    );
  } else if (m >= 0.5) {
    f.push(
      'Die Prüfungen waren schwerer als die App: mehr Fragen mit Schwierigkeit 3 (Transfer) und 2 (Anwenden).',
    );
  } else if (m <= -0.5) {
    f.push(
      'Die Prüfungen waren leichter als die App: Schwerpunkt auf sicherem Grundwissen (Schwierigkeit 1–2), Transferfragen nur vereinzelt.',
    );
  }
  if (anteil('transfer') > 0 && m < 1.25)
    f.push(
      m <= -0.5
        ? 'Einzelne Transferfragen (Schwierigkeit 3) einbauen, da die Lehrperson Transferaufgaben stellt; Schwerpunkt bleibt aber das Grundwissen.'
        : 'Mehr Transferfragen mit Schwierigkeit 3: Gelerntes auf neue Beispiele anwenden.',
    );
  if (anteil('erklaeren') > 0 || anteil('skizze') > 0)
    f.push(
      'Mehr offene Erklärfragen (Typ `offen`) mit Musterlösung und Stichworten: Die Lehrperson verlangt Antworten in ganzen Sätzen.',
    );
  if (anteil('rechnen') > 0)
    f.push('Rechenaufgaben (Typ `zahl`) zu allen Formeln und Grössen einbauen.');
  if (anteil('begriffe') > 0)
    f.push('Fachbegriffe auch frei abfragen (Typ `kurzantwort`), nicht nur zum Auswählen.');
  if (anteil('beschriften') > 0)
    f.push(
      'Beschriftungsaufgaben nachbilden: Bauteile/Strukturen mit Lage und Funktion zuordnen (Typ `zuordnen`) oder benennen (Typ `kurzantwort`), ohne auf eine Abbildung zu verweisen.',
    );
  const typen = pruefungsStil(p)?.bevorzugteTypen ?? [];
  if (typen.length)
    f.push(
      `Fragetypen nach diesen Aufgabenarten gewichten: ${typen.map((t) => `\`${t}\``).join(', ')}.`,
    );

  const teilweise = p.stoffAbgefragt.teile + p.stoffAbgefragt.wenig;
  const mitStoff = STOFFE.reduce((s, x) => s + p.stoffAbgefragt[x], 0);
  const nurTeile = mitStoff > 0 && teilweise * 2 >= mitStoff;
  switch (passungsBefund(p)) {
    case 'hinaus':
      f.push(
        'Stoff aus dem Unterricht über die Lernziele hinaus einbeziehen: auch Inhalte des Materials abfragen, die in keinem Lernziel ausdrücklich stehen (dem passendsten Lernziel zuordnen).',
      );
      break;
    case 'teilweise':
      if (!nurTeile)
        f.push(
          'Die Lernziele wurden nur teilweise geprüft: Schwerpunkte bei Themen ähnlich den früher geprüften Lernzielen (siehe Liste) setzen, die übrigen knapper behandeln, aber nicht weglassen; die Fragenzahl pro Lernziel bleibt.',
        );
      break;
    case 'unklar':
      f.push(
        'Die Lernziele passten wenig zur Prüfung; aus den Angaben geht nicht hervor, ob Stoff ausserhalb der Lernziele drankam: eng am Material bleiben.',
      );
      break;
    case 'gut':
      f.push('Die Lernziele passten gut zur Prüfung: eng an den Lernzielen bleiben.');
      break;
  }
  if (nurTeile) {
    f.push(
      'Meist wurde nur ein Teil des Stoffs geprüft: Themen ähnlich den früher geprüften Lernzielen (siehe oben) gründlich üben; Lernzettel und Kurzfassung zu Themen, die selten drankamen, knapper halten, aber nicht weglassen; die Fragenzahl pro Lernziel bleibt.',
    );
  } else if (p.stoffAbgefragt.alles * 2 > mitStoff) {
    f.push('Meist wurde der ganze Stoff geprüft: alle Lernziele gleichmässig abdecken.');
  }
  if (p.zeitKnapp * 2 >= p.anzahl && p.zeitKnapp > 0)
    f.push('Die Zeit war knapp: Fragen so stellen, dass schnelles, sicheres Abrufen geübt wird.');
  if (p.rueckmeldungen.some((r) => r.beispielfragen.length))
    f.push(
      'Formulierungen und Aufgabenstellungen an die Beispielfragen der Lehrperson anlehnen (Operatoren wie «erkläre», «begründe», «vergleiche»).',
    );
  return f;
}

/**
 * Das Profil als Markdown-Text für die Lektionserstellung (KI-Prompt,
 * «Prompt kopieren», Export). Noten sind bewusst NICHT enthalten: Sie helfen
 * beim Erstellen von Fragen kaum (die Schwierigkeit im Vergleich zur App sagt
 * mehr) und gehören nicht in Texte, die an Claude gehen oder in Dateien landen.
 * Den Namen der Lehrperson nur mit `mitLehrperson` (Datei-Export und Kopie für
 * die Person selbst), nie im KI-Auftrag. Die freien Texte (Beispielfragen,
 * Tipps, «ausserhalb») bleiben drin, weil sie den Stil zeigen; die App weist
 * darauf hin, dass sie bei der KI-Erstellung an Anthropic gehen.
 */
export function profilAlsText(
  p: LehrpersonProfil,
  opt: { mitLehrperson?: boolean } = {},
): string {
  const rs = p.rueckmeldungen;
  const z: string[] = [];
  const lp =
    opt.mitLehrperson && p.lehrpersonen.length
      ? ` (Lehrperson: ${p.lehrpersonen.map((l) => zeile(l, 80)).join(', ')})`
      : '';
  const schwer = (r: PruefungsRueckmeldung) =>
    r.schwierigkeit !== undefined ? SCHWIERIGKEIT_LABEL[r.schwierigkeit].toLowerCase() : '';
  z.push(`Rückmeldungen zu früheren Prüfungen in ${zeile(p.fach, 80)}${lp}`, '');
  z.push(
    `Grundlage: ${p.anzahl === 1 ? '1 Prüfung' : `${p.anzahl} Prüfungen`}: ${rs
      .map((r) => {
        const zusatz = [r.pruefungsdatum, schwer(r)].filter(Boolean).join(', ');
        return `«${zeile(r.lektionTitel, 120)}»${zusatz ? ` (${zusatz})` : ''}`;
      })
      .join(', ')}.`,
    '',
  );

  if (p.schwierigkeitMittel !== null) {
    const zuletzt = rs.find((r) => r.schwierigkeit !== undefined);
    z.push(
      `- **Schwierigkeit:** ${schwierigkeitInWorten(p.schwierigkeitMittel)} (gewichtetes Mittel, neuere Prüfungen zählen mehr: ${vorzeichen(p.schwierigkeitMittel)} auf der Skala −2 viel leichter … +2 viel schwerer${p.anzahl > 1 && zuletzt ? `; zuletzt: ${schwer(zuletzt)}` : ''})`,
    );
  }
  if (p.lernzielePassendMittel !== null)
    z.push(
      `- **Lernziele passten zur Prüfung:** ${passendInWorten(p.lernzielePassendMittel)} (${zahl(p.lernzielePassendMittel)} von 5)`,
    );
  const stoff = STOFFE.filter((s) => p.stoffAbgefragt[s]);
  if (stoff.length)
    z.push(
      `- **Abgefragter Stoff:** ${stoff.map((s) => `${p.stoffAbgefragt[s]}× ${STOFF_TEXT[s]}`).join(', ')}`,
    );
  if (p.lernzielTreffer !== null)
    z.push(
      `- **Lernziel-Treffer:** ${Math.round(p.lernzielTreffer * 100)} % der beurteilten Lernziele kamen dran (${p.lernzieleBeurteilt} von ${p.lernzieleGesamt} beurteilt)`,
    );
  if (p.aufgabenarten.length)
    z.push(
      `- **Aufgabenarten:** ${p.aufgabenarten.map((a) => `${AUFGABENART_LABEL[a.art]} (${a.anzahl}×)`).join('; ')}`,
    );
  const mitZeit = rs.filter((r) => r.zeit).length;
  if (mitZeit) z.push(`- **Zeit:** knapp bei ${p.zeitKnapp} von ${mitZeit} Prüfungen mit Angabe`);

  const lzListe = (welche: LernzielAbdeckung[]) =>
    rs.flatMap((r) =>
      r.lernziele
        .filter((lz) => welche.includes(lz.abdeckung))
        .map(
          (lz) =>
            `${zeile(lz.text, 300)}${lz.abdeckung === 'teilweise' ? ' (teilweise)' : ''}${rs.length > 1 ? ` — «${zeile(r.lektionTitel, 80)}»` : ''}`,
        ),
    );
  const abschnitt = (titel: string, eintraege: string[]) => {
    if (eintraege.length) z.push('', `### ${titel}`, '', ...liste(eintraege));
  };
  abschnitt('Lernziele früherer Lektionen, die NICHT drankamen', lzListe(['nein']));
  abschnitt('Lernziele früherer Lektionen, die drankamen', lzListe(['ja', 'teilweise']));
  abschnitt(
    'Was drankam, aber nicht (oder zu wenig) in der App war',
    rs.flatMap((r) => (r.ausserhalb?.trim() ? [zeile(r.ausserhalb)] : [])),
  );
  abschnitt(
    'Beispielfragen aus den Prüfungen (Wortlaut)',
    rs
      .flatMap((r) => r.beispielfragen.filter((b) => b.trim()).map((b) => `«${zeile(b)}»`))
      .slice(0, 20),
  );
  abschnitt(
    'Tipps und Eigenheiten der Lehrperson',
    rs.flatMap((r) => (r.tipps?.trim() ? [zeile(r.tipps)] : [])),
  );
  abschnitt('Folgerungen für die nächste Lektion', folgerungen(p));
  return z.join('\n');
}

// ---------- Prüfung für den Backup-Import ----------

const istDatum = (x: unknown): x is string => typeof x === 'string' && !Number.isNaN(Date.parse(x));
const ISO_TAG = /^\d{4}-\d{2}-\d{2}$/;

function text(x: unknown, max: number): string | undefined {
  if (typeof x !== 'string') return undefined;
  const t = x.trim().slice(0, max);
  return t || undefined;
}

/**
 * Übernimmt eine Rückmeldung aus einem Backup nur mit gültigen Werten:
 * Pflichtfelder und Wertebereiche geprüft, Texte gekürzt, unbekannte Einträge
 * weggelassen. Die id wird aus der Lektion abgeleitet. null, wenn unbrauchbar.
 */
export function bereinigeRueckmeldung(x: unknown): PruefungsRueckmeldung | null {
  if (!istObjekt(x)) return null;
  const G = RUECKMELDUNG_GRENZEN;
  const lektionId = text(x['lektionId'], 200);
  const fach = text(x['fach'], G.kurz);
  const { lernzielePassend, stoffAbgefragt, schwierigkeit } = x;
  if (!lektionId || !fach || !istDatum(x['erstelltAm'])) return null;
  // Passung, Stoff und Schwierigkeit sind freiwillig; nur vorhandene Werte prüfen
  const fehlt = (w: unknown) => w === undefined || w === null;
  if (
    !fehlt(lernzielePassend) &&
    (!Number.isInteger(lernzielePassend) ||
      (lernzielePassend as number) < 1 ||
      (lernzielePassend as number) > 5)
  )
    return null;
  if (
    !fehlt(schwierigkeit) &&
    (!Number.isInteger(schwierigkeit) || Math.abs(schwierigkeit as number) > 2)
  )
    return null;
  if (!fehlt(stoffAbgefragt) && !(STOFFE as unknown[]).includes(stoffAbgefragt)) return null;

  const gesehen = new Set<string>();
  const lernziele: LernzielRueckmeldung[] = [];
  for (const lz of Array.isArray(x['lernziele']) ? x['lernziele'] : []) {
    if (lernziele.length >= G.lernziele) break;
    if (!istObjekt(lz)) continue;
    const id = text(lz['lernzielId'], 200);
    if (!id || gesehen.has(id) || !(ABDECKUNGEN as unknown[]).includes(lz['abdeckung'])) continue;
    gesehen.add(id);
    lernziele.push({
      lernzielId: id,
      text: text(lz['text'], 1000) ?? '',
      abdeckung: lz['abdeckung'] as LernzielAbdeckung,
    });
  }

  const r: PruefungsRueckmeldung = {
    id: `rm-${lektionId}`,
    lektionId,
    lektionTitel: text(x['lektionTitel'], 200) ?? lektionId,
    fach,
    erstelltAm: x['erstelltAm'] as string,
    lernziele,
    aufgabenarten: [
      ...new Set(
        (Array.isArray(x['aufgabenarten']) ? x['aufgabenarten'] : []).filter(
          (a): a is Aufgabenart => (AUFGABENARTEN as unknown[]).includes(a),
        ),
      ),
    ],
    beispielfragen: (Array.isArray(x['beispielfragen']) ? x['beispielfragen'] : [])
      .flatMap((b) => text(b, G.beispielfrage) ?? [])
      .slice(0, G.beispielfragen),
  };
  if (!fehlt(lernzielePassend))
    r.lernzielePassend = lernzielePassend as NonNullable<PruefungsRueckmeldung['lernzielePassend']>;
  if (!fehlt(stoffAbgefragt)) r.stoffAbgefragt = stoffAbgefragt as StoffAbdeckung;
  if (!fehlt(schwierigkeit))
    r.schwierigkeit = ((schwierigkeit as number) || 0) as SchwierigkeitVergleich;
  const lehrperson = text(x['lehrperson'], G.kurz);
  if (lehrperson) r.lehrperson = lehrperson;
  if (
    typeof x['pruefungsdatum'] === 'string' &&
    ISO_TAG.test(x['pruefungsdatum']) &&
    istDatum(x['pruefungsdatum'])
  )
    r.pruefungsdatum = x['pruefungsdatum'];
  if (istDatum(x['geaendertAm'])) r.geaendertAm = x['geaendertAm'];
  const note = x['note'];
  if (typeof note === 'number' && Number.isFinite(note) && note >= 1 && note <= 6) r.note = note;
  if ((ZEITEN as unknown[]).includes(x['zeit'])) r.zeit = x['zeit'] as PruefungsZeit;
  const ausserhalb = text(x['ausserhalb'], G.text);
  if (ausserhalb) r.ausserhalb = ausserhalb;
  const tipps = text(x['tipps'], G.text);
  if (tipps) r.tipps = tipps;
  return r;
}
