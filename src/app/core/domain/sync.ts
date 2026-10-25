/**
 * Reine Funktionen für die Synchronisation mit dem Server (ohne Angular).
 *
 * Jede lokale Änderung landet im Ausgang (`art::schluessel` → Zeitstempel).
 * Beim Synchronisieren gehen die Änderungen in Paketen an `POST /api/sync`,
 * danach holt `GET /api/sync?seit=` die Änderungen der anderen Geräte.
 * Konflikte entscheidet «last write wins» nach `geaendertAm`.
 */

export const SYNC_ARTEN = ['lektion', 'fortschritt', 'pruefung', 'rueckmeldung', 'einstellung'] as const;
export type SyncArt = (typeof SYNC_ARTEN)[number];

/** Eintrag im Ausgang: welcher Datensatz wann lokal geändert wurde. Die Daten selbst liest der Upload frisch. */
export interface AusgangEintrag {
  /** `art::schluessel` */
  id: string;
  art: SyncArt;
  schluessel: string;
  /** ISO-Zeitstempel mit ms. */
  geaendertAm: string;
  geloescht: boolean;
  /**
   * Konto, für das die Änderung vorgemerkt wurde (Kennung vom Server). Ein Tab, der noch
   * eine andere Person im Speicher hat, soll nie in das Konto der gerade angemeldeten
   * Person hochladen. Fehlt bei Einträgen von vor dieser Version: gelten als eigene.
   */
  konto?: string;
}

/**
 * Datensatz, der nicht synchronisiert werden konnte (zu gross, vom Server abgelehnt) und
 * deshalb nur auf diesem Gerät liegt — beim Abmelden ginge er verloren.
 */
export interface NurLokal {
  /** `art::schluessel` */
  id: string;
  art: SyncArt;
  schluessel: string;
  /** Grund vom Server bzw. «zu-gross», wenn er gar nicht gesendet wurde. */
  grund: string;
  geaendertAm: string;
  /** Lesbarer Name (z. B. Titel der Lektion), falls bekannt. */
  titel?: string;
}

/** Datensatz, wie ihn die API annimmt und liefert. */
export interface SyncDatensatz {
  art: SyncArt;
  schluessel: string;
  /** JSON-Wert; null bei einem Grabstein. */
  daten: unknown;
  geaendertAm: string;
  geloescht: boolean;
  /** Server-Version des Datensatzes (nur in Antworten, falls der Server sie mitliefert). */
  version?: number;
}

/** Ein Paket enthält höchstens so viele Bytes bzw. Datensätze (Server-Limit 8 MB pro Anfrage). */
export const MAX_PAKET_BYTES = 2 * 1024 * 1024;
export const MAX_PAKET_ANZAHL = 200;
/** Grösser nimmt der Server einen einzelnen Datensatz nicht an. */
export const MAX_DATENSATZ_BYTES = 5 * 1024 * 1024;

/** Zeitstempel für Datensätze ohne eigenen (z. B. Einstellungen beim Umzug): verliert gegen alles. */
export const URZEIT = '2000-01-01T00:00:00.000Z';

/** Nur diese Schlüssel des Einstellungs-Speichers werden synchronisiert (nicht API-Schlüssel, Konto …). */
export const SYNC_EINSTELLUNGEN: readonly string[] = ['einstellungen'];

export function syncId(art: SyncArt, schluessel: string): string {
  return `${art}::${schluessel}`;
}

export function istSyncArt(x: unknown): x is SyncArt {
  return (SYNC_ARTEN as readonly unknown[]).includes(x);
}

/** Bytes, die ein Wert als JSON (UTF-8) belegt. */
export function jsonBytes(x: unknown): number {
  return new TextEncoder().encode(JSON.stringify(x) ?? 'null').length;
}

function zeitwert(iso: string): number {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : -Infinity;
}

/**
 * Zeitstempel für eine lokale Änderung: jetzt, aber immer nach dem bekannten Stand des
 * Datensatzes (z. B. vom Server, geschrieben von einem Gerät, dessen Uhr vorgeht). So
 * gewinnt eine spätere Änderung auch bei Uhrabweichung zwischen den Geräten.
 */
export function naechsterStempel(jetzt: string, bisher: string | undefined): string {
  if (!bisher) return jetzt;
  const b = zeitwert(bisher);
  return Number.isFinite(b) && b >= zeitwert(jetzt) ? new Date(b + 1).toISOString() : jetzt;
}

/**
 * Last write wins: Der Stand vom Server gilt nur, wenn er echt neuer ist als
 * der lokal zuletzt geschriebene. Ohne lokalen Stand (oder leerem = «vergessen»)
 * gewinnt der Server. Bei Gleichstand bleibt der lokale (das ist meist das
 * eigene, gerade hochgeladene Echo).
 */
export function istFernNeuer(fern: string, lokal: string | undefined): boolean {
  if (lokal === undefined || lokal === '') return true;
  return zeitwert(fern) > zeitwert(lokal);
}

/**
 * Teilt die Datensätze in Pakete (≤ maxBytes, ≤ maxAnzahl). Ein einzelner
 * Datensatz über maxBytes bekommt ein eigenes Paket; über `maxDatensatz` wird
 * er gar nicht gesendet (der Server lehnte ihn ohnehin ab) und landet in `zuGross`.
 */
export function bildePakete<T>(
  eintraege: readonly T[],
  bytes: (e: T) => number,
  grenzen: { maxBytes?: number; maxAnzahl?: number; maxDatensatz?: number } = {},
): { pakete: T[][]; zuGross: T[] } {
  const maxBytes = grenzen.maxBytes ?? MAX_PAKET_BYTES;
  const maxAnzahl = grenzen.maxAnzahl ?? MAX_PAKET_ANZAHL;
  const maxDatensatz = grenzen.maxDatensatz ?? MAX_DATENSATZ_BYTES;
  const pakete: T[][] = [];
  const zuGross: T[] = [];
  let paket: T[] = [];
  let groesse = 0;
  for (const e of eintraege) {
    const b = bytes(e);
    if (b > maxDatensatz) {
      zuGross.push(e);
      continue;
    }
    if (paket.length && (paket.length >= maxAnzahl || groesse + b > maxBytes)) {
      pakete.push(paket);
      paket = [];
      groesse = 0;
    }
    paket.push(e);
    groesse += b;
  }
  if (paket.length) pakete.push(paket);
  return { pakete, zuGross };
}

/** Lokale Operation, die ein Datensatz vom Server auslöst. `wert` null = löschen. */
export interface Anwendung {
  id: string;
  art: SyncArt;
  schluessel: string;
  geaendertAm: string;
  wert: unknown;
}

/**
 * Entscheidet, welche Datensätze vom Server lokal übernommen werden: nur neuere
 * (siehe istFernNeuer) und nur gültige (`pruefe` liefert den bereinigten Wert
 * oder null). Mehrfach gelieferte Datensätze zählen in Lieferreihenfolge.
 * `staende` (id → lokaler Zeitstempel) wird dabei nachgeführt.
 */
export function planeAnwendung(
  fern: readonly SyncDatensatz[],
  staende: Map<string, string | undefined>,
  pruefe: (d: SyncDatensatz) => unknown,
): { anwenden: Anwendung[]; ungueltig: SyncDatensatz[] } {
  const anwenden = new Map<string, Anwendung>();
  const ungueltig: SyncDatensatz[] = [];
  for (const d of fern) {
    const id = syncId(d.art, d.schluessel);
    // Gerätebezogene Einstellungen (API-Schlüssel, Konto-Marker …) darf der Server weder
    // setzen noch löschen — auch nicht per Grabstein.
    if (d.art === 'einstellung' && !SYNC_EINSTELLUNGEN.includes(d.schluessel)) {
      ungueltig.push(d);
      continue;
    }
    if (!istFernNeuer(d.geaendertAm, staende.get(id))) continue;
    let wert: unknown = null;
    if (!d.geloescht) {
      wert = pruefe(d);
      if (wert === null || wert === undefined) {
        ungueltig.push(d);
        continue;
      }
    }
    staende.set(id, d.geaendertAm);
    anwenden.delete(id);
    anwenden.set(id, { id, art: d.art, schluessel: d.schluessel, geaendertAm: d.geaendertAm, wert });
  }
  return { anwenden: [...anwenden.values()], ungueltig };
}

/** Normalisiert einen Zeitstempel auf ISO mit ms; unbrauchbare werden zur URZEIT. */
export function isoStempel(x: unknown): string {
  if (typeof x !== 'string') return URZEIT;
  const t = Date.parse(x);
  return Number.isFinite(t) ? new Date(t).toISOString() : URZEIT;
}

/**
 * Zeitstempel für Daten, die schon vor der ersten Anmeldung auf dem Gerät lagen
 * (Umzug von der Version ohne Server): der eigene Stand des Datensatzes, damit
 * Daten von zwei alten Geräten sinnvoll zusammenfinden statt sich nach
 * Anmeldereihenfolge zu überschreiben.
 */
export function umzugStempel(art: SyncArt, wert: unknown): string {
  const w = (typeof wert === 'object' && wert !== null ? wert : {}) as Record<string, unknown>;
  switch (art) {
    case 'lektion':
    case 'rueckmeldung':
      return isoStempel(w['geaendertAm'] || w['erstelltAm']);
    case 'fortschritt':
      return isoStempel(w['zuletzt']);
    case 'pruefung':
      return isoStempel(w['am']);
    case 'einstellung':
      return URZEIT;
  }
}

/**
 * Streng steigende Zeitstempel, auch bei mehreren Änderungen in derselben
 * Millisekunde (sonst könnte ein Upload eine gleichzeitige neuere Änderung als
 * erledigt verbuchen).
 */
export function erzeugeStempelGeber(uhr: () => number = Date.now): () => string {
  let zuletzt = 0;
  return () => {
    zuletzt = Math.max(uhr(), zuletzt + 1);
    return new Date(zuletzt).toISOString();
  };
}
