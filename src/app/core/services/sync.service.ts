import { DestroyRef, Injectable, InjectionToken, computed, inject, signal } from '@angular/core';

import { validiereLektion } from '../domain/lektion-validierung';
import { bereinigeRueckmeldung } from '../domain/rueckmeldung';
import {
  AusgangEintrag,
  NurLokal,
  SyncArt,
  SyncDatensatz,
  bildePakete,
  istSyncArt,
  jsonBytes,
  syncId,
} from '../domain/sync';
import { istObjekt } from '../domain/pruefhilfen';
import { ApiFehler, NetzFehler, istAbgemeldet, istAnderesKonto, rufeApi } from './api';
import { bereinigeEinstellungen, bereinigeFortschritt, bereinigePruefung } from './backup.service';
import { EinstellungenService } from './einstellungen.service';
import { FortschrittService } from './fortschritt.service';
import { LektionService } from './lektion.service';
import { RueckmeldungService } from './rueckmeldung.service';
import { SEITE } from './seite';
import { SpeicherService } from './speicher.service';

export type SyncStatus = 'synchron' | 'laeuft' | 'ausstehend' | 'offline' | 'fehler';

/** Antwort von GET /api/sync. */
interface HolAntwort {
  version: number;
  datensaetze: SyncDatensatz[];
  mehr: boolean;
  /** Epoche des Servers: wechselt, wenn die Datenbank zurückgesetzt wurde. */
  epoche?: string;
  /** `seit` war grösser als die Server-Version (Datenbank zurückgesetzt). */
  zurueckgesetzt?: boolean;
}

/** Antwort von POST /api/sync. */
interface SendeAntwort {
  version: number;
  angenommen: number;
  /** Bei «veraltet» oft mit dem Serverstand (`datensatz`, Format wie bei GET). */
  abgelehnt: { art: string; schluessel: string; grund: string; datensatz?: unknown }[];
  /** Angenommene Datensätze, deren Zeitstempel der Server ersetzt hat (Geräteuhr falsch). */
  korrigiert?: { art: string; schluessel: string; geaendertAm: string }[];
}

const SEITENGROESSE = 500;
/** GET-Seiten sind bis ~2 MB gross: auch im langsamen Mobilnetz Zeit lassen. */
const HOLEN_ZEITLIMIT_MS = 120_000;

/**
 * Stand der Prüfung von Daten vom Server (pruefeFernDaten, validiereLektion, bereinige*).
 * Erhöhen, wenn diese neue Formen annehmen (neuer Fragetyp, neues Format): Geräte, die
 * früher Datensätze ablehnen mussten, holen dann einmal alles neu.
 */
export const FERN_PRUEFSTAND = 1;
export const FERN_PRUEFSTAND_TOKEN = new InjectionToken<number>('FERN_PRUEFSTAND', {
  providedIn: 'root',
  factory: () => FERN_PRUEFSTAND,
});

/** Lesbare Bezeichnung eines Datensatzes für Hinweise («Die Lektion «Zellatmung»»). */
export function bezeichnung(e: Pick<NurLokal, 'art' | 'titel'>): string {
  switch (e.art) {
    case 'lektion':
      return e.titel ? `Die Lektion «${e.titel}»` : 'Eine Lektion';
    case 'fortschritt':
      return 'Ein Lernstand';
    case 'pruefung':
      return 'Eine Probeprüfung';
    case 'rueckmeldung':
      return 'Eine Rückmeldung zu einer Prüfung';
    case 'einstellung':
      return 'Die Einstellungen';
  }
}

/** Hinweis zu Datensätzen, die nur auf diesem Gerät liegen; null, wenn es keine gibt. */
export function nurLokalText(liste: readonly NurLokal[]): string | null {
  if (!liste.length) return null;
  if (liste.length === 1) {
    const e = liste[0];
    const grund =
      e.grund === 'zu-gross'
        ? 'ist zu gross für die Synchronisation (über 5 MB)'
        : 'wurde vom Server nicht angenommen';
    return `${bezeichnung(e)} ${grund} und bleibt nur auf diesem Gerät.`;
  }
  const titel = liste.filter((e) => e.art === 'lektion' && e.titel).map((e) => `«${e.titel}»`);
  return (
    `${liste.length} Einträge konnten nicht synchronisiert werden (zu gross oder vom Server nicht angenommen) ` +
    `und bleiben nur auf diesem Gerät${titel.length ? `, darunter ${titel.join(', ')}` : ''}.`
  );
}
const ENTPRELLEN_MS = 2000;
const INTERVALL_MS = 5 * 60 * 1000;

// ---------- Reine Funktionen (ohne Angular, getestet) ----------

/**
 * Prüft Daten vom Server, bevor sie lokal gespeichert werden; liefert den
 * bereinigten Wert oder null. Der Schlüssel muss zum Inhalt passen.
 */
export function pruefeFernDaten(d: SyncDatensatz): unknown {
  const { art, schluessel, daten } = d;
  switch (art) {
    case 'lektion':
      return istObjekt(daten) && daten['id'] === schluessel && validiereLektion(daten).length === 0 ? daten : null;
    case 'fortschritt': {
      const f = bereinigeFortschritt(daten);
      return f?.schluessel === schluessel ? f : null;
    }
    case 'pruefung': {
      const p = bereinigePruefung(daten);
      return p?.id === schluessel ? p : null;
    }
    case 'rueckmeldung': {
      const r = bereinigeRueckmeldung(daten);
      return r?.id === schluessel ? r : null;
    }
    case 'einstellung': {
      if (schluessel !== 'einstellungen') return null;
      // Das Farbschema ist gerätebezogen und bleibt lokal.
      const { farbschema: _, ...rest } = bereinigeEinstellungen(daten);
      return rest;
    }
  }
}

/** Bereitet lokale Daten für den Server vor (ohne gerätebezogene Werte). */
export function fuerServer(d: SyncDatensatz): SyncDatensatz {
  const { version: _, ...ohneVersion } = d;
  if (d.art !== 'einstellung' || d.geloescht || !istObjekt(d.daten)) return ohneVersion;
  const { farbschema: __, ...rest } = d.daten;
  return { ...ohneVersion, daten: rest };
}

/** Prüft die Form der GET-Antwort; unbrauchbare Datensätze fallen weg. */
export function pruefeHolAntwort(x: unknown): HolAntwort | null {
  if (!istObjekt(x) || typeof x['version'] !== 'number' || !Array.isArray(x['datensaetze'])) return null;
  const datensaetze = x['datensaetze'].filter(
    (d): d is SyncDatensatz =>
      istObjekt(d) &&
      istSyncArt(d['art']) &&
      typeof d['schluessel'] === 'string' &&
      typeof d['geaendertAm'] === 'string' &&
      (typeof d['geloescht'] === 'boolean' || d['geloescht'] === 0 || d['geloescht'] === 1),
  ).map((d) => ({ ...d, geloescht: !!d.geloescht }));
  const antwort: HolAntwort = { version: x['version'], datensaetze, mehr: x['mehr'] === true };
  if (typeof x['epoche'] === 'string' && x['epoche']) antwort.epoche = x['epoche'];
  if (x['zurueckgesetzt'] === true) antwort.zurueckgesetzt = true;
  return antwort;
}

/**
 * Ab welcher Version die nächste Seite geholt wird: bei weiteren Seiten die
 * höchste gelieferte Datensatz-Version (falls der Server sie mitliefert), sonst
 * die Version der Antwort.
 */
export function naechsteVersion(a: HolAntwort, seit: number): number {
  if (!a.mehr) return Math.max(seit, a.version);
  const versionen = a.datensaetze.map((d) => d.version).filter((v): v is number => typeof v === 'number');
  return Math.max(seit, versionen.length ? Math.max(...versionen) : a.version);
}

// ---------- Service ----------

/**
 * Gleicht die lokalen Daten mit dem Server ab: Ausgang hochladen (in Paketen),
 * dann die Änderungen seit der letzten Server-Version holen und anwenden.
 * Läuft nach der Anmeldung, beim Wechsel online/sichtbar, 2 s nach einer
 * lokalen Änderung und alle 5 Minuten.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly speicher = inject(SpeicherService);
  private readonly lektionen = inject(LektionService);
  private readonly fortschritt = inject(FortschrittService);
  private readonly einstellungen = inject(EinstellungenService);
  private readonly rueckmeldungen = inject(RueckmeldungService);
  private readonly seite = inject(SEITE);
  private readonly pruefstand = inject(FERN_PRUEFSTAND_TOKEN);

  private readonly _status = signal<SyncStatus>('synchron');
  readonly status = this._status.asReadonly();
  /** Zeitpunkt der letzten erfolgreichen Synchronisation (ISO, dauerhaft gespeichert). */
  private readonly _zuletztAm = signal<string | null>(null);
  readonly zuletztAm = this._zuletztAm.asReadonly();
  /** Anzahl Änderungen, die noch zum Server müssen. */
  readonly ausstehend = signal(0);
  /** Datensätze, die nicht synchronisiert werden konnten und nur auf diesem Gerät liegen. */
  private readonly _nurLokal = signal<NurLokal[]>([]);
  readonly nurLokal = this._nurLokal.asReadonly();
  /** Hinweis zu Daten vom Server, die dieses Gerät nicht übernehmen konnte. */
  private readonly fernMeldung = signal<string | null>(null);
  /** Hinweis zu Daten, die nicht synchronisiert werden konnten (z. B. zu gross). */
  readonly meldung = computed(() => {
    const teile = [nurLokalText(this._nurLokal()), this.fernMeldung()].filter((t): t is string => !!t);
    return teile.length ? teile.join(' ') : null;
  });
  /** Anzahl Datensätze, die der laufende Abgleich schon geholt hat (Fortschritt beim ersten Abgleich). */
  readonly geholt = signal(0);

  private aktiv = false;
  private laufOk = false;
  private beiAbmeldung: ((fehler?: string) => void) | null = null;
  private laufend: Promise<void> | null = null;
  private nochmal = false;
  private entprellen: ReturnType<typeof setTimeout> | null = null;
  private intervall: ReturnType<typeof setInterval> | null = null;
  private readonly aufraeumen: (() => void)[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stop());
    // Auch ohne laufende Synchronisation (offline) die Zahl ausstehender Änderungen nachführen.
    const abmelden = this.speicher.beobachte(() => {
      void this.zaehleAusstehend();
      if (!this.aktiv) return;
      if (this._status() !== 'laeuft') this._status.set('ausstehend');
      this.planen();
    });
    inject(DestroyRef).onDestroy(abmelden);
    // Auch offline und vor der Anmeldung zeigen, wie aktuell die Daten auf dem Gerät sind.
    void this.ladeGespeichertes();
  }

  private async ladeGespeichertes(): Promise<void> {
    const zuletzt = await this.speicher.syncZuletzt().catch(() => null);
    if (!this._zuletztAm()) this._zuletztAm.set(zuletzt);
    await this.zaehleAusstehend();
  }

  /**
   * Startet die automatische Synchronisation (angemeldet und online).
   * `beiAbmeldung` wird gerufen, wenn der Server die Sitzung nicht mehr annimmt.
   */
  start(beiAbmeldung: (fehler?: string) => void): Promise<void> {
    this.beiAbmeldung = beiAbmeldung;
    if (!this.aktiv) {
      this.aktiv = true;
      const online = () => void this.synchronisieren();
      const sichtbar = () => {
        if (document.visibilityState === 'visible') void this.synchronisieren();
      };
      window.addEventListener('online', online);
      document.addEventListener('visibilitychange', sichtbar);
      this.intervall = setInterval(() => void this.synchronisieren(), INTERVALL_MS);
      this.aufraeumen.push(
        () => window.removeEventListener('online', online),
        () => document.removeEventListener('visibilitychange', sichtbar),
      );
    }
    return this.synchronisieren();
  }

  /** Stoppt die automatische Synchronisation (abgemeldet oder offline). */
  stop(status: SyncStatus = 'offline'): void {
    this.aktiv = false;
    while (this.aufraeumen.length) this.aufraeumen.pop()!();
    if (this.intervall) clearInterval(this.intervall);
    if (this.entprellen) clearTimeout(this.entprellen);
    this.intervall = this.entprellen = null;
    this._status.set(status);
    void this.zaehleAusstehend();
  }

  /** Synchronisiert sofort. Läuft schon eine, folgt danach eine weitere. */
  synchronisieren(): Promise<void> {
    if (!this.aktiv) return Promise.resolve();
    if (this.laufend) {
      this.nochmal = true;
      return this.laufend;
    }
    this.laufend = (async () => {
      try {
        do {
          this.nochmal = false;
          await this.einmal();
        } while (this.nochmal && this.aktiv);
      } finally {
        this.laufend = null;
      }
    })();
    return this.laufend;
  }

  /** true, wenn der letzte Abgleich vollständig geklappt hat (hochgeladen, geholt, angewendet). */
  letzterLaufOk(): boolean {
    return this.laufOk;
  }

  /** Lädt alle Dienste neu, deren Daten sich geändert haben (alle, wenn ohne Angabe). */
  async diensteNeuLaden(arten?: ReadonlySet<SyncArt>): Promise<void> {
    const betrifft = (a: SyncArt) => !arten || arten.has(a);
    await Promise.all([
      betrifft('lektion') ? this.lektionen.neuLaden() : null,
      betrifft('fortschritt') || betrifft('pruefung') ? this.fortschritt.neuLaden() : null,
      betrifft('rueckmeldung') ? this.rueckmeldungen.neuLaden() : null,
      betrifft('einstellung') ? this.einstellungen.neuLaden() : null,
    ]);
    // Nach dem Löschen aller Daten (Kontowechsel) auch die Anzeige zurücksetzen.
    if (!arten) {
      this._zuletztAm.set(await this.speicher.syncZuletzt().catch(() => null));
      this.fernMeldung.set(null);
      await this.zaehleAusstehend();
    }
  }

  /** Wartet, bis alle Dienste ihre lokalen Daten geladen haben. */
  async diensteGeladen(): Promise<void> {
    await Promise.all([
      this.lektionen.laden(),
      this.fortschritt.laden(),
      this.rueckmeldungen.laden(),
      this.einstellungen.laden(),
    ]);
  }

  private planen(): void {
    if (this.entprellen) clearTimeout(this.entprellen);
    this.entprellen = setTimeout(() => {
      this.entprellen = null;
      void this.synchronisieren();
    }, ENTPRELLEN_MS);
  }

  private async zaehleAusstehend(): Promise<number> {
    const [n, nurLokal] = await Promise.all([
      this.speicher.ausgangAnzahl().catch(() => 0),
      this.speicher.nurLokal().catch(() => [] as NurLokal[]),
    ]);
    this.ausstehend.set(n);
    this._nurLokal.set(nurLokal);
    return n;
  }

  private async einmal(): Promise<void> {
    this._status.set('laeuft');
    this.laufOk = false;
    try {
      const hoch = await this.hochladen();
      const geholt = await this.holen(hoch.vollabgleich);
      const arten = new Set([...hoch.arten, ...geholt]);
      if (arten.size) await this.diensteNeuLaden(arten);
      const jetzt = new Date().toISOString();
      this._zuletztAm.set(jetzt);
      await this.speicher.setzeSyncZuletzt(jetzt).catch(() => undefined);
      this.laufOk = true;
      const offen = await this.zaehleAusstehend();
      this._status.set(offen ? 'ausstehend' : 'synchron');
    } catch (e) {
      await this.zaehleAusstehend();
      if (istAnderesKonto(e)) {
        // Ein anderer Tab hat inzwischen eine andere Person angemeldet: nichts mehr senden,
        // neu laden (danach gleicht die Anmeldung Konto-Marker und Sitzung ab).
        this.stop('ausstehend');
        this.seite.neuLaden();
      } else if (istAbgemeldet(e)) {
        this.stop('ausstehend');
        this.beiAbmeldung?.(e instanceof ApiFehler && e.code === 'nicht-freigegeben' ? e.code : undefined);
      } else if (e instanceof NetzFehler) {
        this._status.set('offline');
      } else {
        console.warn('Synchronisation fehlgeschlagen', e);
        this._status.set('fehler');
      }
    }
  }

  /**
   * Lädt den Ausgang hoch. Liefert die Arten, deren Serverstand gleich übernommen wurde
   * («veraltet» mit mitgeliefertem Datensatz), und ob trotzdem alles neu geholt werden muss.
   */
  private async hochladen(): Promise<{ arten: Set<SyncArt>; vollabgleich: boolean }> {
    const arten = new Set<SyncArt>();
    let vollabgleich = false;
    const konto = this.speicher.aktivesKonto();
    const alle = await this.speicher.ausgang();
    // Einträge eines veralteten Tabs, der noch eine andere Person im Speicher hatte: nie in
    // dieses Konto hochladen. Einträge ohne Konto (ältere Version) gelten als eigene.
    const fremd = alle.filter((e) => e.konto && konto && e.konto !== konto);
    if (fremd.length) {
      console.warn('Sync: Änderungen eines anderen Kontos verworfen', fremd.map((e) => e.id));
      await this.speicher.ausgangErledigt(fremd);
    }
    const eintraege = alle.filter((e) => !fremd.includes(e));
    if (!eintraege.length) return { arten, vollabgleich };
    const datensaetze = (await this.speicher.datenFuer(eintraege)).map(fuerServer);
    const paare = eintraege.map((eintrag, i) => ({ eintrag, datensatz: datensaetze[i], bytes: jsonBytes(datensaetze[i]) }));
    const { pakete, zuGross } = bildePakete(paare, (p) => p.bytes);
    if (zuGross.length) {
      await this.speicher.merkeNurLokal(zuGross.map((p) => nurLokalEintrag(p.eintrag, 'zu-gross', p.datensatz.daten)));
      await this.speicher.ausgangErledigt(zuGross.map((p) => p.eintrag));
    }
    for (const paket of pakete) {
      const antwort = await rufeApi<SendeAntwort>('/api/sync', {
        methode: 'POST',
        body: { datensaetze: paket.map((p) => p.datensatz) },
        zeitlimit: 120_000,
      });
      await this.speicher.ausgangErledigt(paket.map((p) => p.eintrag));
      const liste = (Array.isArray(antwort?.abgelehnt) ? antwort.abgelehnt : []).filter(
        (a) => istSyncArt(a?.art) && typeof a.schluessel === 'string',
      );
      const nachId = new Map(paket.map((p) => [p.eintrag.id, p]));
      const abgelehntIds = new Set(liste.map((a) => syncId(a.art as SyncArt, a.schluessel)));
      // Angenommen: Die Markierung «nur lokal» (falls von früher) entfällt.
      await this.speicher.nurLokalVergessen([...nachId.keys()].filter((id) => !abgelehntIds.has(id)));

      // Der Server hat Zeitstempel ersetzt (Geräteuhr falsch): seinen Stand übernehmen.
      const korrigiert = (Array.isArray(antwort?.korrigiert) ? antwort.korrigiert : []).filter(
        (k) => istSyncArt(k?.art) && typeof k.schluessel === 'string' && typeof k.geaendertAm === 'string',
      );
      await this.speicher.staendeSetzen(korrigiert.map((k) => ({ id: syncId(k.art as SyncArt, k.schluessel), geaendertAm: k.geaendertAm })));

      // «veraltet»: Der Server hat eine neuere Fassung → lokalen Stand vergessen und die
      // mitgelieferte Fassung gleich übernehmen; fehlt sie, alles neu holen.
      const veraltet = liste.filter((a) => a.grund === 'veraltet');
      if (veraltet.length) {
        await this.speicher.staendeVergessen(veraltet.map((a) => syncId(a.art as SyncArt, a.schluessel)));
        const mit = veraltet.map((a) => a.datensatz).filter((d) => d !== undefined);
        const geprueft = pruefeHolAntwort({ version: 0, datensaetze: mit, mehr: false });
        if (!geprueft || geprueft.datensaetze.length < veraltet.length) vollabgleich = true;
        if (geprueft?.datensaetze.length) {
          const r = await this.speicher.wendeFernAn(geprueft.datensaetze, pruefeFernDaten);
          r.arten.forEach((a) => arten.add(a));
          if (r.ungueltig) await this.fernUngueltig(r.ungueltig);
        }
      }
      // Andere Gründe (zu gross, ungültig): bleibt nur lokal, nicht endlos neu senden — aber
      // vormerken, damit Abmelden davor warnt.
      const sonst = liste.filter((a) => a.grund !== 'veraltet');
      if (sonst.length) {
        console.warn('Sync: vom Server abgelehnt', sonst);
        const vorgemerkt: NurLokal[] = [];
        for (const a of sonst) {
          const p = nachId.get(syncId(a.art as SyncArt, a.schluessel));
          if (p) vorgemerkt.push(nurLokalEintrag(p.eintrag, a.grund, p.datensatz.daten));
        }
        await this.speicher.merkeNurLokal(vorgemerkt);
      }
    }
    return { arten, vollabgleich };
  }

  /** Merkt vor, dass Datensätze vom Server hier nicht übernommen werden konnten. */
  private async fernUngueltig(anzahl: number): Promise<void> {
    await this.speicher.setzeNachholen(this.pruefstand);
    this.fernMeldung.set(
      `${anzahl === 1 ? 'Ein Eintrag' : `${anzahl} Einträge`} vom Server ${anzahl === 1 ? 'konnte' : 'konnten'} ` +
        'auf diesem Gerät nicht übernommen werden – bitte die App aktualisieren.',
    );
  }

  /** Holt die Änderungen vom Server und wendet sie an. Liefert die betroffenen Arten. */
  private async holen(vollabgleich: boolean): Promise<Set<SyncArt>> {
    const arten = new Set<SyncArt>();
    // Nach einem App-Update mit toleranterer Prüfung früher abgelehnte Datensätze nachholen.
    const vorgemerkt = await this.speicher.nachholenStand();
    if (vorgemerkt !== null && vorgemerkt < this.pruefstand) {
      vollabgleich = true;
      await this.speicher.setzeNachholen(null);
      this.fernMeldung.set(null);
    }
    const erster = !(await this.speicher.syncZuletzt().catch(() => null));
    const epoche = await this.speicher.syncEpoche();
    let seit = vollabgleich ? 0 : await this.speicher.syncVersion();
    let ungueltig = 0;
    let zurueckgesetzt = false;
    this.geholt.set(0);
    for (let seite = 0; seite < 10_000; seite++) {
      const roh = await rufeApi(`/api/sync?seit=${seit}&limit=${SEITENGROESSE}`, { zeitlimit: HOLEN_ZEITLIMIT_MS });
      const antwort = pruefeHolAntwort(roh);
      if (!antwort) throw new Error('Unerwartete Antwort von /api/sync');
      if (seite === 0 && !zurueckgesetzt) {
        // Datenbank zurückgesetzt (Backup eingespielt, Konto neu): alles neu abgleichen.
        if (antwort.zurueckgesetzt || (epoche && antwort.epoche && antwort.epoche !== epoche)) {
          zurueckgesetzt = true;
          await this.speicher.setzeSyncVersion(0);
          await this.speicher.setzeSyncEpoche(antwort.epoche ?? null);
          await this.speicher.allesInAusgang({ stempelAusStand: true });
          if (seit !== 0) {
            seit = 0;
            seite = -1;
            continue;
          }
        } else if (!epoche && antwort.epoche) {
          await this.speicher.setzeSyncEpoche(antwort.epoche);
        }
      }
      const r = await this.speicher.wendeFernAn(antwort.datensaetze, pruefeFernDaten);
      r.arten.forEach((a) => arten.add(a));
      ungueltig += r.ungueltig;
      this.geholt.update((n) => n + antwort.datensaetze.length);
      // Beim ersten Abgleich die Anzeige schon nach jeder Seite nachführen.
      if (erster && r.arten.size) await this.diensteNeuLaden(r.arten);
      const naechste = naechsteVersion(antwort, seit);
      await this.speicher.setzeSyncVersion(naechste);
      if (!antwort.mehr || naechste <= seit) break;
      seit = naechste;
    }
    if (ungueltig) await this.fernUngueltig(ungueltig);
    // Nach dem Zurücksetzen liegt alles im Ausgang: gleich nochmals synchronisieren.
    if (zurueckgesetzt) this.nochmal = true;
    return arten;
  }
}

/** Markierung «nur lokal» zu einem Ausgang-Eintrag (mit Titel bei Lektionen). */
function nurLokalEintrag(e: AusgangEintrag, grund: string, daten: unknown): NurLokal {
  const titel = e.art === 'lektion' && istObjekt(daten) && typeof daten['titel'] === 'string' ? daten['titel'] : undefined;
  return { id: e.id, art: e.art, schluessel: e.schluessel, grund, geaendertAm: e.geaendertAm, ...(titel ? { titel } : {}) };
}
