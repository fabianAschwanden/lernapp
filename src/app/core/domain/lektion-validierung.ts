import { Frage, LEKTION_FORMAT_VERSION, Lektion, LektionHerkunft } from '../models/lektion.model';
import { istErlaubteBildQuelle, istObjekt, istTextListe, nichtLeer, stringListe } from './pruefhilfen';

/**
 * Prüft eine Lektion (z. B. aus einem Import oder von der KI) und liefert
 * verständliche Fehlermeldungen. Leere Liste = gültig.
 */
export function validiereLektion(daten: unknown): string[] {
  const fehler: string[] = [];
  if (!istObjekt(daten)) return ['Die Datei enthält keine Lektion (kein JSON-Objekt).'];
  const l = daten as Partial<Lektion> & Record<string, unknown>;

  for (const feld of ['id', 'fach', 'titel'] as const) {
    if (typeof l[feld] !== 'string' || !(l[feld] as string).trim()) fehler.push(`Feld «${feld}» fehlt.`);
  }
  if (typeof l.id === 'string' && !/^[a-z0-9][a-z0-9-]*$/.test(l.id)) {
    fehler.push('Die id darf nur Kleinbuchstaben, Ziffern und Bindestriche enthalten.');
  }
  if (l.format !== undefined && l.format !== LEKTION_FORMAT_VERSION) {
    fehler.push(`Unbekanntes Format ${String(l.format)} (erwartet ${LEKTION_FORMAT_VERSION}).`);
  }
  fehler.push(...pruefeKopf(l));
  if (!Array.isArray(l.lernziele) || l.lernziele.length === 0) {
    fehler.push('Die Lektion braucht mindestens ein Lernziel.');
    return fehler;
  }
  if (!Array.isArray(l.fragen)) {
    fehler.push('Die Liste «fragen» fehlt.');
    return fehler;
  }

  const lzIds = new Set<string>();
  l.lernziele.forEach((lz, i) => {
    const ort = `Lernziel ${i + 1}`;
    if (!istObjekt(lz)) return fehler.push(`${ort}: ungültig.`);
    if (!nichtLeer(lz.id)) fehler.push(`${ort}: id fehlt.`);
    else if (lzIds.has(lz.id)) fehler.push(`${ort}: id «${lz.id}» doppelt.`);
    else lzIds.add(lz.id);
    if (!nichtLeer(lz.text)) fehler.push(`${ort}: Text fehlt.`);
    if (!nichtLeer(lz.thema)) fehler.push(`${ort}: Thema fehlt.`);
    if (typeof lz.zusammenfassung !== 'string') fehler.push(`${ort}: Zusammenfassung fehlt.`);
    if (lz.merksaetze !== undefined && !istTextListe(lz.merksaetze))
      fehler.push(`${ort}: «merksaetze» muss eine Liste von Texten sein.`);
    if (lz.quellenhinweis !== undefined && typeof lz.quellenhinweis !== 'string')
      fehler.push(`${ort}: «quellenhinweis» muss ein Text sein.`);
    if (lz.ergaenzt !== undefined && typeof lz.ergaenzt !== 'boolean')
      fehler.push(`${ort}: «ergaenzt» muss true oder false sein.`);
    if (lz.bilder !== undefined) {
      if (!Array.isArray(lz.bilder)) fehler.push(`${ort}: «bilder» muss eine Liste sein.`);
      else lz.bilder.forEach((b, j) => fehler.push(...pruefeBild(b).map((m) => `${ort}, Bild ${j + 1}: ${m}`)));
    }
    return;
  });

  const frageIds = new Set<string>();
  l.fragen.forEach((f, i) => {
    const ort = `Frage ${i + 1}${istObjekt(f) && nichtLeer(f.id) ? ` (${f.id})` : ''}`;
    if (!istObjekt(f)) return fehler.push(`${ort}: ungültig.`);
    if (!nichtLeer(f.id)) fehler.push(`${ort}: id fehlt.`);
    else if (frageIds.has(f.id)) fehler.push(`${ort}: id doppelt.`);
    else frageIds.add(f.id);
    if (!lzIds.has(f.lernzielId)) fehler.push(`${ort}: unbekanntes Lernziel «${String(f.lernzielId)}».`);
    if (!nichtLeer(f.frage)) fehler.push(`${ort}: Fragetext fehlt.`);
    if (typeof f.erklaerung !== 'string') fehler.push(`${ort}: Erklärung fehlt.`);
    if (![1, 2, 3].includes(f.schwierigkeit)) fehler.push(`${ort}: Schwierigkeit muss 1, 2 oder 3 sein.`);
    if (f.tipp !== undefined && typeof f.tipp !== 'string') fehler.push(`${ort}: «tipp» muss ein Text sein.`);
    if (f.bild !== undefined) fehler.push(...pruefeBild(f.bild).map((m) => `${ort}, Bild: ${m}`));
    fehler.push(...pruefeTyp(f as Frage).map((m) => `${ort}: ${m}`));
    return;
  });

  return fehler;
}

const HERKUENFTE: readonly LektionHerkunft[] = ['mitgeliefert', 'ki', 'manuell', 'import'];

/** Optionale bzw. ergänzbare Felder der Lektion: wenn vorhanden, dann mit dem richtigen Typ. */
function pruefeKopf(l: Record<string, unknown>): string[] {
  const m: string[] = [];
  for (const feld of ['beschreibung', 'klasse', 'pruefungsdatum', 'erstelltAm', 'geaendertAm'] as const) {
    if (l[feld] !== undefined && typeof l[feld] !== 'string') m.push(`Feld «${feld}» muss ein Text sein.`);
  }
  if (l['version'] !== undefined && typeof l['version'] !== 'number') m.push('Feld «version» muss eine Zahl sein.');
  if (l['herkunft'] !== undefined && !(HERKUENFTE as readonly unknown[]).includes(l['herkunft']))
    m.push(`Unbekannte Herkunft «${String(l['herkunft'])}».`);
  if (l['hinweise'] !== undefined && !istTextListe(l['hinweise']))
    m.push('«hinweise» muss eine Liste von Texten sein.');
  if (
    l['quellen'] !== undefined &&
    (!Array.isArray(l['quellen']) ||
      l['quellen'].some(
        (q) =>
          !istObjekt(q) ||
          typeof q['id'] !== 'string' ||
          typeof q['titel'] !== 'string' ||
          (q['umfang'] !== undefined && typeof q['umfang'] !== 'string'),
      ))
  )
    m.push('«quellen» muss eine Liste von {id, titel} sein.');
  return m;
}

/** Ein Bild braucht eine erlaubte Quelle (Bild der App oder eingebettet) und einen Alternativtext. */
function pruefeBild(b: unknown): string[] {
  if (!istObjekt(b)) return ['ungültig.'];
  const m: string[] = [];
  if (!istErlaubteBildQuelle(b['src']))
    m.push('Quelle nicht erlaubt (nur «bilder/…» oder eingebettete PNG/JPEG/WebP/GIF, keine fremden Adressen).');
  if (typeof b['alt'] !== 'string') m.push('Alternativtext («alt») fehlt.');
  if (b['legende'] !== undefined && typeof b['legende'] !== 'string') m.push('«legende» muss ein Text sein.');
  return m;
}

function pruefeTyp(f: Frage): string[] {
  const m: string[] = [];
  switch (f.typ) {
    case 'einfachwahl':
      if (!stringListe(f.optionen, 2)) m.push('mindestens zwei Optionen nötig.');
      else if (!Number.isInteger(f.richtig) || f.richtig < 0 || f.richtig >= f.optionen.length)
        m.push('«richtig» zeigt auf keine Option.');
      else if (new Set(f.optionen).size !== f.optionen.length) m.push('Optionen doppelt.');
      break;
    case 'mehrfachwahl':
      if (!stringListe(f.optionen, 2)) m.push('mindestens zwei Optionen nötig.');
      else if (
        !Array.isArray(f.richtig) ||
        f.richtig.length === 0 ||
        f.richtig.some((r) => !Number.isInteger(r) || r < 0 || r >= f.optionen.length) ||
        new Set(f.richtig).size !== f.richtig.length
      )
        m.push('«richtig» muss gültige, eindeutige Optionsindizes enthalten.');
      else if (new Set(f.optionen).size !== f.optionen.length) m.push('Optionen doppelt.');
      break;
    case 'wahrfalsch':
      if (typeof f.richtig !== 'boolean') m.push('«richtig» muss true oder false sein.');
      break;
    case 'zuordnen':
      if (
        !Array.isArray(f.paare) ||
        f.paare.length < 2 ||
        f.paare.some((p) => !istObjekt(p) || !nichtLeer(p.links) || !nichtLeer(p.rechts))
      )
        m.push('mindestens zwei vollständige Paare nötig.');
      else if (new Set(f.paare.map((p) => p.links)).size !== f.paare.length) m.push('linke Seite doppelt.');
      else if (new Set(f.paare.map((p) => p.rechts)).size < 2) m.push('rechts braucht mindestens zwei Werte.');
      break;
    case 'reihenfolge':
      if (!stringListe(f.elemente, 2)) m.push('mindestens zwei Elemente nötig.');
      else if (new Set(f.elemente).size !== f.elemente.length) m.push('Elemente doppelt.');
      break;
    case 'zahl':
      if (typeof f.richtig !== 'number' || !Number.isFinite(f.richtig)) m.push('«richtig» muss eine Zahl sein.');
      if (f.einheit !== undefined && typeof f.einheit !== 'string') m.push('«einheit» muss ein Text sein.');
      if (f.toleranz !== undefined && (typeof f.toleranz !== 'number' || !Number.isFinite(f.toleranz) || f.toleranz < 0))
        m.push('«toleranz» muss ≥ 0 sein.');
      break;
    case 'kurzantwort':
      if (!stringListe(f.akzeptiert, 1)) m.push('mindestens eine akzeptierte Antwort nötig.');
      break;
    case 'offen':
      if (!nichtLeer(f.musterloesung)) m.push('Musterlösung fehlt.');
      if (f.stichworte !== undefined && !istTextListe(f.stichworte)) m.push('«stichworte» muss eine Liste von Texten sein.');
      break;
    default:
      m.push(`unbekannter Fragetyp «${String((f as { typ?: unknown }).typ)}».`);
  }
  return m;
}

/**
 * Ergänzt fehlende, aber vorausgesetzte Felder einer gültigen Lektion
 * (z. B. aus einem Import oder Backup älterer bzw. von Hand geschriebener Dateien).
 */
export function ergaenzeLektion(l: Lektion, jetzt = new Date()): Lektion {
  return {
    ...l,
    format: l.format ?? LEKTION_FORMAT_VERSION,
    version: l.version ?? 1,
    beschreibung: l.beschreibung ?? '',
    quellen: Array.isArray(l.quellen) ? l.quellen : [],
    herkunft: l.herkunft ?? 'import',
    erstelltAm: l.erstelltAm ?? jetzt.toISOString(),
  };
}
