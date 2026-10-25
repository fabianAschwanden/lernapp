import { Injectable, inject } from '@angular/core';

import { ergaenzeLektion, validiereLektion } from '../domain/lektion-validierung';
import { istObjekt } from '../domain/pruefhilfen';
import { bereinigeRueckmeldung } from '../domain/rueckmeldung';
import {
  Bewertung,
  FrageFortschritt,
  MAX_FACH,
  PruefungsErgebnis,
  fortschrittSchluessel,
} from '../models/fortschritt.model';
import { Lektion } from '../models/lektion.model';
import { PruefungsRueckmeldung } from '../models/rueckmeldung.model';
import { heuteIso, ladeHerunter } from '../util/datei';
import { Einstellungen, EinstellungenService } from './einstellungen.service';
import { FortschrittService } from './fortschritt.service';
import { LektionService } from './lektion.service';
import { RueckmeldungService } from './rueckmeldung.service';
import { SpeicherService } from './speicher.service';

export const BACKUP_FORMAT = 1;

/** Inhalt einer Backup-Datei. Der API-Schlüssel ist bewusst nie enthalten. */
export interface Backup {
  app: 'lernapp';
  format: number;
  /** ISO-Zeitstempel. */
  erstelltAm: string;
  lektionen: Lektion[];
  fortschritt: FrageFortschritt[];
  pruefungen: PruefungsErgebnis[];
  /** Rückmeldungen nach Prüfungen; fehlt in älteren Backups (dann leer). */
  rueckmeldungen: PruefungsRueckmeldung[];
  einstellungen: Partial<Einstellungen>;
}

/** Was beim Import passiert ist — für die Anzeige auf der Einstellungsseite. */
export interface ImportErgebnis {
  /** Titel der neu hinzugefügten Lektionen. */
  neu: string[];
  /** Titel der ersetzten Lektionen (Import war neuer). */
  ersetzt: string[];
  /** Titel der übersprungenen Lektionen (vorhandene ist gleich alt oder neuer). */
  uebersprungen: string[];
  ungueltig: { titel: string; fehler: string[] }[];
  fortschritte: number;
  pruefungen: number;
  /** Anzahl übernommener Rückmeldungen (neue oder neuere als die vorhandenen). */
  rueckmeldungen: number;
  einstellungen: boolean;
}

// ---------- Reine Funktionen (ohne Angular, getestet) ----------

/** Prüft das Grundformat einer Backup-Datei; liefert eine Fehlermeldung oder das Backup. */
export function pruefeBackup(daten: unknown): { backup: Backup } | { fehler: string } {
  if (!istObjekt(daten)) return { fehler: 'Die Datei ist kein Lernapp-Backup (kein JSON-Objekt).' };
  if (daten['app'] !== 'lernapp') return { fehler: 'Die Datei ist kein Lernapp-Backup.' };
  if (daten['format'] !== BACKUP_FORMAT)
    return { fehler: `Unbekanntes Backup-Format ${String(daten['format'])} (erwartet ${BACKUP_FORMAT}).` };
  const liste = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
  return {
    backup: {
      app: 'lernapp',
      format: BACKUP_FORMAT,
      erstelltAm: typeof daten['erstelltAm'] === 'string' ? daten['erstelltAm'] : '',
      lektionen: liste(daten['lektionen']) as Lektion[],
      fortschritt: liste(daten['fortschritt']).flatMap((x) => bereinigeFortschritt(x) ?? []),
      pruefungen: liste(daten['pruefungen']).flatMap((x) => bereinigePruefung(x) ?? []),
      rueckmeldungen: liste(daten['rueckmeldungen']).flatMap((x) => bereinigeRueckmeldung(x) ?? []),
      einstellungen: bereinigeEinstellungen(daten['einstellungen']),
    },
  };
}

/** Zeitstempel für den Vergleich «welche Lektion ist neuer». */
export function lektionStand(l: Pick<Lektion, 'erstelltAm' | 'geaendertAm'>): string {
  return l.geaendertAm || l.erstelltAm || '';
}

/**
 * Entscheidet für jede importierte Lektion, ob sie übernommen wird.
 * Ungültige werden gemeldet; vorhandene nur ersetzt, wenn die importierte neuer ist.
 * Übernommene Lektionen werden wie beim Datei-Import um fehlende Felder ergänzt.
 */
export function planeLektionImport(
  importiert: unknown[],
  vorhandene: readonly Lektion[],
  jetzt = new Date(),
): { uebernehmen: Lektion[]; ergebnis: Pick<ImportErgebnis, 'neu' | 'ersetzt' | 'uebersprungen' | 'ungueltig'> } {
  const nachId = new Map(vorhandene.map((l) => [l.id, l]));
  const uebernehmen: Lektion[] = [];
  const ergebnis = {
    neu: [] as string[],
    ersetzt: [] as string[],
    uebersprungen: [] as string[],
    ungueltig: [] as { titel: string; fehler: string[] }[],
  };
  const gesehen = new Set<string>();

  importiert.forEach((roh, i) => {
    const titel =
      istObjekt(roh) && typeof roh['titel'] === 'string' && roh['titel'].trim() ? roh['titel'] : `Lektion ${i + 1}`;
    const fehler = validiereLektion(roh);
    if (fehler.length) {
      ergebnis.ungueltig.push({ titel, fehler });
      return;
    }
    const l = roh as Lektion;
    if (gesehen.has(l.id)) {
      ergebnis.ungueltig.push({ titel, fehler: [`Die id «${l.id}» kommt im Backup mehrfach vor.`] });
      return;
    }
    gesehen.add(l.id);
    const alt = nachId.get(l.id);
    if (!alt) {
      uebernehmen.push(ergaenzeLektion(l, jetzt));
      ergebnis.neu.push(titel);
    } else if (lektionStand(l) > lektionStand(alt)) {
      uebernehmen.push(ergaenzeLektion(l, jetzt));
      ergebnis.ersetzt.push(titel);
    } else {
      ergebnis.uebersprungen.push(titel);
    }
  });
  return { uebernehmen, ergebnis };
}

/**
 * Rückmeldungen aus einem Backup: neue übernehmen, vorhandene nur ersetzen,
 * wenn die importierte neuer ist (geaendertAm, sonst erstelltAm). Bei
 * doppelten ids im Backup gewinnt ebenfalls die neuere.
 */
export function planeRueckmeldungImport(
  importiert: readonly PruefungsRueckmeldung[],
  vorhandene: readonly PruefungsRueckmeldung[],
): PruefungsRueckmeldung[] {
  const stand = new Map(vorhandene.map((r) => [r.id, lektionStand(r)]));
  const neueste = new Map<string, PruefungsRueckmeldung>();
  for (const r of importiert) {
    const bisher = neueste.get(r.id);
    if (!bisher || lektionStand(r) > lektionStand(bisher)) neueste.set(r.id, r);
  }
  return [...neueste.values()].filter((r) => !stand.has(r.id) || lektionStand(r) > stand.get(r.id)!);
}

const FARBSCHEMATA = ['auto', 'hell', 'dunkel'] as const;

/** Übernimmt nur bekannte Einstellungen mit gültigen Werten — nie einen API-Schlüssel. */
export function bereinigeEinstellungen(x: unknown): Partial<Einstellungen> {
  if (!istObjekt(x)) return {};
  const e: Partial<Einstellungen> = {};
  const zahl = (wert: unknown, min: number, max: number): number | undefined =>
    typeof wert === 'number' && Number.isFinite(wert) ? Math.min(max, Math.max(min, Math.round(wert))) : undefined;
  const runde = zahl(x['rundenGroesse'], 5, 30);
  if (runde !== undefined) e.rundenGroesse = runde;
  const anzahl = zahl(x['pruefungAnzahl'], 5, 60);
  if (anzahl !== undefined) e.pruefungAnzahl = anzahl;
  const minuten = zahl(x['pruefungMinuten'], 0, 300);
  if (minuten !== undefined) e.pruefungMinuten = minuten;
  if (typeof x['kiModell'] === 'string' && /^claude-[a-z0-9-]+$/.test(x['kiModell'])) e.kiModell = x['kiModell'];
  if ((FARBSCHEMATA as readonly unknown[]).includes(x['farbschema']))
    e.farbschema = x['farbschema'] as Einstellungen['farbschema'];
  return e;
}

const BEWERTUNGEN: readonly Bewertung[] = ['richtig', 'teilweise', 'falsch'];

const istZahl = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const istDatum = (x: unknown): x is string => typeof x === 'string' && !Number.isNaN(Date.parse(x));

/**
 * Übernimmt einen Lernstand aus einem Backup nur mit gültigen Werten: Fach als
 * ganze Zahl 0…MAX_FACH (sonst gäbe es kein Intervall), Zähler ≥ 0, Verlauf nur
 * aus gültigen Bewertungen. null, wenn der Eintrag unbrauchbar ist.
 */
export function bereinigeFortschritt(x: unknown): FrageFortschritt | null {
  if (!istObjekt(x)) return null;
  const { lektionId, frageId, fach } = x;
  if (typeof lektionId !== 'string' || !lektionId || typeof frageId !== 'string' || !frageId) return null;
  if (!Number.isInteger(fach) || (fach as number) < 0 || (fach as number) > MAX_FACH) return null;
  const zaehler = (wert: unknown) => (istZahl(wert) && wert >= 0 ? Math.floor(wert) : 0);
  const f: FrageFortschritt = {
    schluessel: fortschrittSchluessel(lektionId, frageId),
    lektionId,
    frageId,
    fach: fach as number,
    richtig: zaehler(x['richtig']),
    falsch: zaehler(x['falsch']),
    verlauf: (Array.isArray(x['verlauf']) ? x['verlauf'] : [])
      .filter((b): b is Bewertung => (BEWERTUNGEN as readonly unknown[]).includes(b))
      .slice(-5),
  };
  if (istDatum(x['zuletzt'])) f.zuletzt = x['zuletzt'];
  if (istDatum(x['faelligAb'])) f.faelligAb = x['faelligAb'];
  return f;
}

/** Übernimmt ein Prüfungsergebnis nur mit gültigem Datum, Punkten und Note 1–6. */
export function bereinigePruefung(x: unknown): PruefungsErgebnis | null {
  if (!istObjekt(x)) return null;
  const { id, lektionId, am, punkte, maxPunkte, note } = x;
  if (typeof id !== 'string' || typeof lektionId !== 'string' || !istDatum(am)) return null;
  if (!istZahl(note) || note < 1 || note > 6) return null;
  if (!istZahl(punkte) || !istZahl(maxPunkte) || punkte < 0 || maxPunkte <= 0 || punkte > maxPunkte) return null;
  const proLernziel: PruefungsErgebnis['proLernziel'] = {};
  if (istObjekt(x['proLernziel'])) {
    for (const [lz, w] of Object.entries(x['proLernziel'])) {
      if (istObjekt(w) && istZahl(w['punkte']) && istZahl(w['max'])) proLernziel[lz] = { punkte: w['punkte'], max: w['max'] };
    }
  }
  return {
    id,
    lektionId,
    am,
    punkte,
    maxPunkte,
    note,
    dauerSekunden: istZahl(x['dauerSekunden']) && x['dauerSekunden'] >= 0 ? x['dauerSekunden'] : 0,
    proLernziel,
  };
}

// ---------- Service ----------

/**
 * Backup für den Gerätewechsel: eigene Lektionen, Lernstand, Probeprüfungen,
 * Rückmeldungen nach Prüfungen und Einstellungen als eine JSON-Datei. Der API-Schlüssel bleibt auf dem Gerät.
 */
@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly speicher = inject(SpeicherService);
  private readonly lektionen = inject(LektionService);
  private readonly fortschritt = inject(FortschrittService);
  private readonly einstellungen = inject(EinstellungenService);
  private readonly rueckmeldungen = inject(RueckmeldungService);

  async erstelle(jetzt = new Date()): Promise<Backup> {
    const { kiModell, rundenGroesse, pruefungAnzahl, pruefungMinuten, farbschema } = this.einstellungen.werte();
    return {
      app: 'lernapp',
      format: BACKUP_FORMAT,
      erstelltAm: jetzt.toISOString(),
      lektionen: await this.speicher.alleLektionen(),
      fortschritt: [...this.fortschritt.map().values()],
      pruefungen: this.fortschritt.pruefungen(),
      rueckmeldungen: await this.speicher.alleRueckmeldungen(),
      einstellungen: { kiModell, rundenGroesse, pruefungAnzahl, pruefungMinuten, farbschema },
    };
  }

  /** Erstellt das Backup und bietet es als Datei `lernapp-backup-<datum>.json` an. */
  async exportiere(): Promise<void> {
    const backup = await this.erstelle();
    ladeHerunter(`lernapp-backup-${heuteIso()}.json`, JSON.stringify(backup, null, 2));
  }

  /** Liest eine Backup-Datei ein. Wirft mit verständlicher Meldung, wenn das Format nicht stimmt. */
  async importiere(datei: File): Promise<ImportErgebnis> {
    let daten: unknown;
    try {
      daten = JSON.parse(await datei.text());
    } catch {
      throw new Error('Die Datei ist kein gültiges JSON.');
    }
    return this.importiereDaten(daten);
  }

  async importiereDaten(daten: unknown): Promise<ImportErgebnis> {
    const geprueft = pruefeBackup(daten);
    if ('fehler' in geprueft) throw new Error(geprueft.fehler);
    const { backup } = geprueft;

    const plan = planeLektionImport(backup.lektionen, this.lektionen.lektionen());
    // LektionService.speichern hält dessen Signale aktuell.
    for (const l of plan.uebernehmen) await this.lektionen.speichern(l, { zeitstempelBehalten: true });

    await this.fortschritt.uebernehme(backup.fortschritt, backup.pruefungen);

    await this.rueckmeldungen.laden();
    const rueckmeldungen = planeRueckmeldungImport(backup.rueckmeldungen, this.rueckmeldungen.alle());
    for (const r of rueckmeldungen) await this.rueckmeldungen.speichern(r, { zeitstempelBehalten: true });

    const hatEinstellungen = Object.keys(backup.einstellungen).length > 0;
    if (hatEinstellungen) await this.einstellungen.aendern(backup.einstellungen);

    return {
      ...plan.ergebnis,
      fortschritte: backup.fortschritt.length,
      pruefungen: backup.pruefungen.length,
      rueckmeldungen: rueckmeldungen.length,
      einstellungen: hatEinstellungen,
    };
  }
}
