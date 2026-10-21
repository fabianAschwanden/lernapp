/**
 * Wandelt eine KI-Antwort in eine Lektion um.
 *
 * Akzeptiert sowohl das flache KI-Format (`richtigIndex`, `richtigBool`, …,
 * siehe ki-schema.ts) als auch das echte Lektionsformat (`richtig`), damit
 * auch Antworten aus «Prompt kopieren» (claude.ai) eingefügt werden können.
 * Ungültige einzelne Fragen werden verworfen und gezählt, statt die ganze
 * Antwort abzulehnen.
 */

import { freieId, slug } from '../domain/id';
import { validiereLektion } from '../domain/lektion-validierung';
import { istErlaubteBildQuelle, istObjekt, nichtLeer } from '../domain/pruefhilfen';
import {
  Bild,
  Frage,
  FrageTyp,
  LEKTION_FORMAT_VERSION,
  Lektion,
  LektionHerkunft,
  Lernziel,
  Quelle,
} from '../models/lektion.model';
import { FRAGE_TYPEN } from './ki-schema';

export interface UmwandlungsOptionen {
  /** Liefert eine freie Lektions-id zum Titel (LektionService.freieId). */
  idFuer: (titel: string) => string;
  /** Vorgaben der Person haben Vorrang vor der KI-Antwort. */
  fach?: string;
  titel?: string;
  klasse?: string;
  pruefungsdatum?: string;
  /** Hinweise der Person; werden vor die Hinweise der KI gestellt. */
  hinweise?: string[];
  quellen?: Quelle[];
  herkunft?: LektionHerkunft;
  jetzt?: Date;
}

export interface VerworfeneFrage {
  /** 1-basierte Position in der KI-Antwort. */
  nummer: number;
  frage: string;
  gruende: string[];
}

export interface UmwandlungsErgebnis {
  /** null, wenn die Antwort gar keine Lektion enthält. */
  lektion: Lektion | null;
  verworfen: VerworfeneFrage[];
  /** Hinweise zur Umwandlung, z. B. verworfene Lernziele. */
  hinweise: string[];
  /** Fehler von validiereLektion (leer = gültig). */
  fehler: string[];
}

type Roh = Record<string, unknown>;

export function wandleKiAntwort(daten: unknown, opt: UmwandlungsOptionen): UmwandlungsErgebnis {
  if (!istObjekt(daten)) {
    return {
      lektion: null,
      verworfen: [],
      hinweise: [],
      fehler: ['Die Antwort enthält keine Lektion (kein JSON-Objekt).'],
    };
  }
  const hinweise: string[] = [];

  // --- Lernziele ---------------------------------------------------------
  const lernziele: Lernziel[] = [];
  const lzIdMap = new Map<string, string>();
  const belegteLz = new Set<string>();
  liste(daten['lernziele']).forEach((roh, i) => {
    if (!istObjekt(roh) || !nichtLeer(roh['text'])) {
      hinweise.push(`Lernziel ${i + 1} ohne Text wurde weggelassen.`);
      return;
    }
    const alteId = typeof roh['id'] === 'string' ? roh['id'] : '';
    const id = eindeutig(bereinigeId(alteId, 'lz-', i + 1), belegteLz);
    if (alteId) {
      if (!lzIdMap.has(alteId)) lzIdMap.set(alteId, id);
      const slug = bereinigeId(alteId, 'lz-', i + 1);
      if (!lzIdMap.has(slug)) lzIdMap.set(slug, id);
    }
    lernziele.push(wandleLernziel(roh, id));
  });

  // --- Fragen ------------------------------------------------------------
  const fragen: Frage[] = [];
  const verworfen: VerworfeneFrage[] = [];
  const belegteFragen = new Set<string>();
  const proLernziel = new Map<string, number>();
  liste(daten['fragen']).forEach((roh, i) => {
    const nummer = i + 1;
    if (!istObjekt(roh)) {
      verworfen.push({ nummer, frage: '', gruende: ['keine gültige Frage'] });
      return;
    }
    const rohLz = typeof roh['lernzielId'] === 'string' ? roh['lernzielId'] : '';
    const lernzielId = lzIdMap.get(rohLz) ?? lzIdMap.get(bereinigeId(rohLz, 'lz-', 0)) ?? '';
    const n = (proLernziel.get(lernzielId) ?? 0) + 1;
    const ersatzId = `f-${lernzielId.replace(/^lz-/, '') || 'x'}-${String(n).padStart(2, '0')}`;
    const rohId = typeof roh['id'] === 'string' && roh['id'].trim() ? roh['id'] : ersatzId;
    const kandidat = wandleFrage(roh, bereinigeId(rohId, 'f-', nummer), lernzielId || rohLz);

    const gruende = pruefeEinzelfrage(kandidat, lernziele);
    if (gruende.length) {
      verworfen.push({
        nummer,
        frage: typeof roh['frage'] === 'string' ? roh['frage'] : '',
        gruende,
      });
      return;
    }
    kandidat.id = eindeutig(kandidat.id, belegteFragen);
    proLernziel.set(lernzielId, n);
    fragen.push(kandidat);
  });

  // --- Kopf --------------------------------------------------------------
  const fach = (opt.fach?.trim() || str(daten['fach']) || 'Allgemein').trim();
  const titel = (opt.titel?.trim() || str(daten['titel']) || 'Neue Lektion').trim();
  const kiHinweise = liste(daten['hinweise'])
    .filter(nichtLeer)
    .map((h) => h.trim());
  const alleHinweise = eindeutigeTexte([...(opt.hinweise ?? []), ...kiHinweise]);

  const lektion: Lektion = {
    id: opt.idFuer(titel),
    format: LEKTION_FORMAT_VERSION,
    version: 1,
    fach,
    titel,
    beschreibung: str(daten['beschreibung']).trim(),
    quellen: opt.quellen ?? quellenAus(daten['quellen']),
    lernziele,
    fragen,
    herkunft: opt.herkunft ?? 'ki',
    erstelltAm: (opt.jetzt ?? new Date()).toISOString(),
  };
  const klasse = opt.klasse?.trim() || str(daten['klasse']).trim();
  if (klasse) lektion.klasse = klasse;
  const datum = opt.pruefungsdatum?.trim() || str(daten['pruefungsdatum']).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(datum)) lektion.pruefungsdatum = datum;
  if (alleHinweise.length) lektion.hinweise = alleHinweise;
  const kurzfassung = str(daten['kurzfassung']).trim();
  if (kurzfassung) lektion.kurzfassung = kurzfassung;

  for (const lz of lernziele) {
    if (!proLernziel.get(lz.id)) hinweise.push(`Lernziel «${lz.text}» hat keine Fragen.`);
  }
  const fremde = fremdeBilder(daten);
  if (fremde) {
    hinweise.push(
      `${fremde === 1 ? 'Ein Bild mit fremder Adresse wurde' : `${fremde} Bilder mit fremder Adresse wurden`} weggelassen (nur Bilder der App oder eingebettete Bilder sind erlaubt).`,
    );
  }

  return { lektion, verworfen, hinweise, fehler: validiereLektion(lektion) };
}

function wandleLernziel(roh: Roh, id: string): Lernziel {
  const lz: Lernziel = {
    id,
    thema: str(roh['thema']).trim() || 'Allgemein',
    text: str(roh['text']).trim(),
    zusammenfassung: str(roh['zusammenfassung']),
  };
  const merksaetze = liste(roh['merksaetze']).filter(nichtLeer);
  if (merksaetze.length) lz.merksaetze = merksaetze;
  const bilder = liste(roh['bilder']).filter(istBild).map(sauberesBild);
  if (bilder.length) lz.bilder = bilder;
  if (nichtLeer(roh['quellenhinweis'])) lz.quellenhinweis = roh['quellenhinweis'];
  if (roh['ergaenzt'] === true) lz.ergaenzt = true;
  return lz;
}

/**
 * Baut aus einer rohen Frage (flaches KI-Format oder Lektionsformat) eine
 * Frage. Nur die zum Typ passenden Felder werden übernommen, null fällt weg.
 * Die Gültigkeit prüft danach `pruefeEinzelfrage`.
 */
export function wandleFrage(roh: Roh, id: string, lernzielId: string): Frage {
  const typ = (FRAGE_TYPEN as readonly string[]).includes(str(roh['typ']))
    ? (roh['typ'] as FrageTyp)
    : roh['typ'];
  const basis: Roh = {
    id,
    lernzielId,
    typ,
    frage: str(roh['frage']),
    erklaerung: str(roh['erklaerung']),
    schwierigkeit: zahlOderText(roh['schwierigkeit']),
  };
  if (nichtLeer(roh['tipp'])) basis['tipp'] = roh['tipp'];
  if (istBild(roh['bild'])) basis['bild'] = sauberesBild(roh['bild']);

  const wert = (kiFeld: string) => ((roh[kiFeld] ?? null) !== null ? roh[kiFeld] : roh['richtig']);
  switch (typ) {
    case 'einfachwahl':
      basis['optionen'] = roh['optionen'];
      basis['richtig'] = zahlOderText(wert('richtigIndex'));
      break;
    case 'mehrfachwahl':
      basis['optionen'] = roh['optionen'];
      basis['richtig'] = Array.isArray(wert('richtigIndizes'))
        ? (wert('richtigIndizes') as unknown[]).map(zahlOderText)
        : wert('richtigIndizes');
      break;
    case 'wahrfalsch':
      basis['richtig'] = wert('richtigBool');
      break;
    case 'zuordnen':
      basis['paare'] = Array.isArray(roh['paare'])
        ? roh['paare'].map((p) => (istObjekt(p) ? { links: p['links'], rechts: p['rechts'] } : p))
        : roh['paare'];
      break;
    case 'reihenfolge':
      basis['elemente'] = roh['elemente'];
      break;
    case 'zahl':
      basis['richtig'] = zahlOderText(wert('richtigZahl'));
      if (typeof roh['toleranz'] === 'number') basis['toleranz'] = roh['toleranz'];
      if (nichtLeer(roh['einheit'])) basis['einheit'] = roh['einheit'];
      break;
    case 'kurzantwort':
      basis['akzeptiert'] = roh['akzeptiert'];
      break;
    case 'offen': {
      basis['musterloesung'] = roh['musterloesung'];
      const stichworte = liste(roh['stichworte']).filter(nichtLeer);
      if (stichworte.length) basis['stichworte'] = stichworte;
      break;
    }
  }
  return basis as unknown as Frage;
}

/** Prüft eine einzelne Frage mit validiereLektion; liefert die Gründe ohne Präfix. */
function pruefeEinzelfrage(f: Frage, lernziele: Lernziel[]): string[] {
  if (lernziele.length === 0) return ['kein Lernziel vorhanden'];
  const fehler = validiereLektion({
    id: 'pruefung',
    fach: 'x',
    titel: 'x',
    lernziele,
    fragen: [f],
  });
  return fehler.map((m) => m.replace(/^Frage \d+(?: \([^)]*\))?: /, ''));
}

/** Macht aus einer beliebigen Zeichenkette eine id (kebab-case, a–z, 0–9). */
export function bereinigeId(roh: string, praefix: string, nummer: number): string {
  return slug(roh, 60) || `${praefix}${nummer}`;
}

/** Hängt -2, -3, … an, bis die id frei ist, und belegt sie. */
function eindeutig(id: string, belegt: Set<string>): string {
  const frei = freieId(id, belegt);
  belegt.add(frei);
  return frei;
}

/**
 * Schneidet das JSON-Objekt aus einer Textantwort, z. B. wenn Claude es in
 * einen ```json-Block packt oder einen Satz davorschreibt. Gibt null zurück,
 * wenn kein Objekt gefunden wird.
 */
export function schneideJson(text: string): string | null {
  const t = text.trim();
  const block = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  const kandidat = block && block[1].includes('{') ? block[1] : t;
  const start = kandidat.indexOf('{');
  const ende = kandidat.lastIndexOf('}');
  if (start < 0 || ende <= start) return null;
  return kandidat.slice(start, ende + 1);
}

/** JSON.parse mit schneideJson; wirft eine verständliche Meldung. */
export function parseKiJson(text: string): unknown {
  const json = schneideJson(text);
  if (!json) throw new Error('In der Antwort wurde kein JSON-Objekt gefunden.');
  try {
    return JSON.parse(json);
  } catch {
    throw new Error('Die Antwort ist kein gültiges JSON (vielleicht unvollständig kopiert?).');
  }
}

// --- kleine Helfer ---------------------------------------------------------

function str(x: unknown): string {
  return typeof x === 'string' ? x : '';
}

function liste(x: unknown): unknown[] {
  return Array.isArray(x) ? x : [];
}

/** «2» → 2 (Modelle liefern Zahlen manchmal als Text). */
function zahlOderText(x: unknown): unknown {
  if (typeof x === 'string' && /^-?\d+(\.\d+)?$/.test(x.trim())) return Number(x.trim());
  return x;
}

function istBild(x: unknown): x is Bild {
  return (
    istObjekt(x) &&
    istErlaubteBildQuelle(x['src']) &&
    typeof x['alt'] === 'string' &&
    (x['legende'] === undefined || x['legende'] === null || typeof x['legende'] === 'string')
  );
}

/** Nur die Felder eines Bildes, ohne null-Werte. */
function sauberesBild(b: Bild): Bild {
  return { src: b.src, alt: b.alt, ...(nichtLeer(b.legende) ? { legende: b.legende } : {}) };
}

/** Zählt Bilder in der Antwort, deren Adresse nicht erlaubt ist (z. B. https:). */
function fremdeBilder(daten: Roh): number {
  const kandidaten = [
    ...liste(daten['lernziele']).flatMap((lz) => (istObjekt(lz) ? liste(lz['bilder']) : [])),
    ...liste(daten['fragen']).map((f) => (istObjekt(f) ? f['bild'] : null)),
  ];
  return kandidaten.filter((b) => istObjekt(b) && !istErlaubteBildQuelle(b['src'])).length;
}

function quellenAus(x: unknown): Quelle[] {
  return liste(x)
    .filter((q): q is Roh => istObjekt(q) && nichtLeer(q['id']) && nichtLeer(q['titel']))
    .map((q) => ({
      id: str(q['id']),
      titel: str(q['titel']),
      ...(nichtLeer(q['umfang']) ? { umfang: q['umfang'] } : {}),
    }));
}

function eindeutigeTexte(texte: string[]): string[] {
  const gesehen = new Set<string>();
  return texte.filter((t) => {
    const k = t.trim().toLowerCase();
    if (!k || gesehen.has(k)) return false;
    gesehen.add(k);
    return true;
  });
}
