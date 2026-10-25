import { Injectable } from '@angular/core';
import { DBSchema, IDBPDatabase, IDBPTransaction, StoreNames, openDB } from 'idb';

import {
  AusgangEintrag,
  NurLokal,
  SYNC_EINSTELLUNGEN,
  SyncArt,
  SyncDatensatz,
  erzeugeStempelGeber,
  naechsterStempel,
  planeAnwendung,
  syncId,
  umzugStempel,
} from '../domain/sync';
import { FrageFortschritt, PruefungsErgebnis } from '../models/fortschritt.model';
import { Lektion } from '../models/lektion.model';
import { PruefungsRueckmeldung } from '../models/rueckmeldung.model';

interface LernappDb extends DBSchema {
  /** Eigene, importierte und bearbeitete Lektionen. */
  lektionen: { key: string; value: Lektion };
  fortschritt: { key: string; value: FrageFortschritt; indexes: { lektionId: string } };
  pruefungen: { key: string; value: PruefungsErgebnis; indexes: { lektionId: string } };
  /** Schlüssel-Wert-Paare (Einstellungen, API-Schlüssel, Konto-Marker). */
  einstellungen: { key: string; value: unknown };
  /** Rückmeldungen nach der echten Prüfung (seit DB-Version 2). */
  rueckmeldungen: { key: string; value: PruefungsRueckmeldung };
  /** Lokale Änderungen, die noch zum Server müssen (seit DB-Version 3). */
  ausgang: { key: string; value: AusgangEintrag };
  /**
   * Sync-Stand (seit DB-Version 3): `art::schluessel` → Zeitstempel der lokal
   * gültigen Fassung (für «last write wins»). Dazu Schlüssel mit «#»:
   * VERSION_SCHLUESSEL → letzte geholte Server-Version, ZULETZT_SCHLUESSEL →
   * Zeitpunkt der letzten erfolgreichen Synchronisation, EPOCHE_SCHLUESSEL →
   * Epoche des Servers, NACHHOLEN_SCHLUESSEL → Prüfstand, mit dem Datensätze vom
   * Server abgelehnt wurden, NUR_LOKAL + id → Datensatz, der nur auf dem Gerät liegt.
   */
  syncstand: { key: string; value: string | number | NurLokal };
}

type Store = StoreNames<LernappDb>;
type SchreibTx = IDBPTransaction<LernappDb, ArrayLike<Store>, 'readwrite'>;

const DB_NAME = 'lernapp';
/** 1: Lektionen, Lernstand, Probeprüfungen, Einstellungen · 2: Rückmeldungen · 3: Ausgang und Sync-Stand. */
const DB_VERSION = 3;

const VERSION_SCHLUESSEL = '#version';
const ZULETZT_SCHLUESSEL = '#zuletzt';
const EPOCHE_SCHLUESSEL = '#epoche';
const NACHHOLEN_SCHLUESSEL = '#nachholen';
const NUR_LOKAL = '#nurLokal:';
const SYNC: Store[] = ['ausgang', 'syncstand'];
const DATEN: Store[] = ['lektionen', 'fortschritt', 'pruefungen', 'rueckmeldungen', 'einstellungen'];

/** Optionen für Daten aus einem Backup: Sync-Stempel = eigener Stand des Inhalts, nicht «jetzt». */
export interface SpeicherOptionen {
  importiert?: boolean;
}

/** Store je synchronisierter Art (Einstellungen: Schlüssel im Store `einstellungen`). */
const STORE_VON: Record<SyncArt, Store> = {
  lektion: 'lektionen',
  fortschritt: 'fortschritt',
  pruefung: 'pruefungen',
  rueckmeldung: 'rueckmeldungen',
  einstellung: 'einstellungen',
};

/**
 * Dünne Hülle um IndexedDB. Jede Schreib- und Löschoperation an synchronisierten
 * Daten trägt sich in derselben Transaktion in den Ausgang ein; der SyncService
 * lädt den Ausgang hoch und wendet die Änderungen vom Server über
 * `wendeFernAn` an (ohne Ausgang-Eintrag).
 */
@Injectable({ providedIn: 'root' })
export class SpeicherService {
  private dbPromise: Promise<IDBPDatabase<LernappDb>> | null = null;
  private readonly stempel = erzeugeStempelGeber();
  private readonly beobachter = new Set<() => void>();
  /** Konto dieses Tabs (Kennung vom Server); wird zu jedem Ausgang-Eintrag vermerkt. */
  private konto: string | null = null;

  /** Setzt das Konto dieses Tabs (nach der Anmeldung bzw. offline aus dem Konto-Marker). */
  setzeKonto(konto: string | null): void {
    this.konto = konto || null;
  }

  aktivesKonto(): string | null {
    return this.konto;
  }

  private db(): Promise<IDBPDatabase<LernappDb>> {
    this.dbPromise ??= openDB<LernappDb>(DB_NAME, DB_VERSION, {
      // Schrittweise ab der vorhandenen Version — bestehende Stores und Daten bleiben.
      upgrade(db, alteVersion) {
        if (alteVersion < 1) {
          db.createObjectStore('lektionen', { keyPath: 'id' });
          db.createObjectStore('fortschritt', { keyPath: 'schluessel' }).createIndex('lektionId', 'lektionId');
          db.createObjectStore('pruefungen', { keyPath: 'id' }).createIndex('lektionId', 'lektionId');
          db.createObjectStore('einstellungen');
        }
        if (alteVersion < 2) db.createObjectStore('rueckmeldungen', { keyPath: 'id' });
        // Bestehende Daten kommen bei der ersten Anmeldung in den Ausgang (AuthService).
        if (alteVersion < 3) {
          db.createObjectStore('ausgang', { keyPath: 'id' });
          db.createObjectStore('syncstand');
        }
      },
      // Eine andere Anfrage (z. B. ein neuer Tab mit neuerer Version) will die
      // DB umbauen: Verbindung freigeben.
      blocking: (_alt, _neu, ereignis) => {
        (ereignis.target as IDBDatabase).close();
        this.dbPromise = null;
      },
    });
    return this.dbPromise;
  }

  /** Meldet jede lokale Änderung an synchronisierten Daten (nach dem Speichern). Liefert die Abmeldung. */
  beobachte(fn: () => void): () => void {
    this.beobachter.add(fn);
    return () => this.beobachter.delete(fn);
  }

  private melde(): void {
    for (const fn of this.beobachter) fn();
  }

  /**
   * Trägt Änderungen in Ausgang und Sync-Stand ein (in der Transaktion der Änderung; kein
   * fremdes await dazwischen, sonst schliesst IndexedDB die Transaktion). Zeitstempel:
   * jetzt, aber nach dem bekannten Stand des Datensatzes (kausal monoton) — ausser
   * `stempel` gibt ihn vor (Import: eigener Stand des Inhalts).
   */
  private async vermerke(
    tx: SchreibTx,
    art: SyncArt,
    schluessel: string[],
    geloescht: boolean,
    stempel?: (s: string) => string,
  ): Promise<void> {
    const ausgang = tx.objectStore('ausgang');
    const stand = tx.objectStore('syncstand');
    for (const s of schluessel) {
      const id = syncId(art, s);
      const bisher = await stand.get(id);
      const geaendertAm = stempel?.(s) ?? naechsterStempel(this.stempel(), typeof bisher === 'string' ? bisher : undefined);
      const eintrag: AusgangEintrag = { id, art, schluessel: s, geaendertAm, geloescht };
      if (this.konto) eintrag.konto = this.konto;
      await ausgang.put(eintrag);
      await stand.put(geaendertAm, id);
      // Lokal gelöscht: Es gibt nichts mehr, das nur hier liegt.
      if (geloescht) await stand.delete(NUR_LOKAL + id);
    }
  }

  private async schreibTx(stores: Store[]): Promise<SchreibTx> {
    return (await this.db()).transaction([...stores, ...SYNC], 'readwrite') as SchreibTx;
  }

  // ---------- Lektionen ----------

  async alleLektionen(): Promise<Lektion[]> {
    return (await this.db()).getAll('lektionen');
  }

  async speichereLektion(l: Lektion, opt: SpeicherOptionen = {}): Promise<void> {
    const tx = await this.schreibTx(['lektionen']);
    const stempel = opt.importiert ? () => umzugStempel('lektion', l) : undefined;
    await Promise.all([tx.objectStore('lektionen').put(l), this.vermerke(tx, 'lektion', [l.id], false, stempel), tx.done]);
    this.melde();
  }

  async loescheLektion(id: string): Promise<void> {
    const tx = await this.schreibTx(['lektionen']);
    await Promise.all([tx.objectStore('lektionen').delete(id), this.vermerke(tx, 'lektion', [id], true), tx.done]);
    this.melde();
  }

  // ---------- Lernstand und Probeprüfungen ----------

  async alleFortschritte(): Promise<FrageFortschritt[]> {
    return (await this.db()).getAll('fortschritt');
  }

  async speichereFortschritt(f: FrageFortschritt): Promise<void> {
    await this.speichereFortschritte([f]);
  }

  async speichereFortschritte(liste: FrageFortschritt[], opt: SpeicherOptionen = {}): Promise<void> {
    if (!liste.length) return;
    const tx = await this.schreibTx(['fortschritt']);
    const nachSchluessel = new Map(liste.map((f) => [f.schluessel, f]));
    const stempel = opt.importiert ? (s: string) => umzugStempel('fortschritt', nachSchluessel.get(s)) : undefined;
    await Promise.all([
      ...liste.map((f) => tx.objectStore('fortschritt').put(f)),
      this.vermerke(tx, 'fortschritt', [...nachSchluessel.keys()], false, stempel),
      tx.done,
    ]);
    this.melde();
  }

  /** Löscht Lernstand und Probeprüfungen einer Lektion (als Grabsteine für die anderen Geräte). */
  async loescheFortschritt(lektionId: string): Promise<void> {
    const tx = await this.schreibTx(['fortschritt', 'pruefungen']);
    const arten = { fortschritt: 'fortschritt', pruefungen: 'pruefung' } as const;
    for (const store of ['fortschritt', 'pruefungen'] as const) {
      const keys = await tx.objectStore(store).index('lektionId').getAllKeys(lektionId);
      await Promise.all([...keys.map((k) => tx.objectStore(store).delete(k)), this.vermerke(tx, arten[store], keys, true)]);
    }
    await tx.done;
    this.melde();
  }

  async allePruefungen(): Promise<PruefungsErgebnis[]> {
    return (await this.db()).getAll('pruefungen');
  }

  async speicherePruefung(p: PruefungsErgebnis, opt: SpeicherOptionen = {}): Promise<void> {
    const tx = await this.schreibTx(['pruefungen']);
    const stempel = opt.importiert ? () => umzugStempel('pruefung', p) : undefined;
    await Promise.all([tx.objectStore('pruefungen').put(p), this.vermerke(tx, 'pruefung', [p.id], false, stempel), tx.done]);
    this.melde();
  }

  // ---------- Rückmeldungen ----------

  async alleRueckmeldungen(): Promise<PruefungsRueckmeldung[]> {
    return (await this.db()).getAll('rueckmeldungen');
  }

  async speichereRueckmeldung(r: PruefungsRueckmeldung, opt: SpeicherOptionen = {}): Promise<void> {
    const tx = await this.schreibTx(['rueckmeldungen']);
    const stempel = opt.importiert ? () => umzugStempel('rueckmeldung', r) : undefined;
    await Promise.all([
      tx.objectStore('rueckmeldungen').put(r),
      this.vermerke(tx, 'rueckmeldung', [r.id], false, stempel),
      tx.done,
    ]);
    this.melde();
  }

  async loescheRueckmeldung(id: string): Promise<void> {
    const tx = await this.schreibTx(['rueckmeldungen']);
    await Promise.all([
      tx.objectStore('rueckmeldungen').delete(id),
      this.vermerke(tx, 'rueckmeldung', [id], true),
      tx.done,
    ]);
    this.melde();
  }

  // ---------- Einstellungen (Schlüssel-Wert) ----------

  async lies<T>(schluessel: string): Promise<T | undefined> {
    return (await (await this.db()).get('einstellungen', schluessel)) as T | undefined;
  }

  /**
   * Schreibt einen Wert; nur die Schlüssel aus SYNC_EINSTELLUNGEN gehen zum Server.
   * `syncStempel` gibt den Sync-Zeitstempel vor (Backup-Import), sonst gilt «jetzt».
   */
  async schreibe<T>(schluessel: string, wert: T, opt: { syncStempel?: string } = {}): Promise<void> {
    const sync = SYNC_EINSTELLUNGEN.includes(schluessel);
    const tx = await this.schreibTx(['einstellungen']);
    const stempel = opt.syncStempel ? () => opt.syncStempel! : undefined;
    await Promise.all([
      tx.objectStore('einstellungen').put(wert, schluessel),
      sync ? this.vermerke(tx, 'einstellung', [schluessel], false, stempel) : null,
      tx.done,
    ]);
    if (sync) this.melde();
  }

  async entferne(schluessel: string): Promise<void> {
    const sync = SYNC_EINSTELLUNGEN.includes(schluessel);
    const tx = await this.schreibTx(['einstellungen']);
    await Promise.all([
      tx.objectStore('einstellungen').delete(schluessel),
      sync ? this.vermerke(tx, 'einstellung', [schluessel], true) : null,
      tx.done,
    ]);
    if (sync) this.melde();
  }

  // ---------- Synchronisation ----------

  async ausgang(): Promise<AusgangEintrag[]> {
    const liste = await (await this.db()).getAll('ausgang');
    return liste.sort((a, b) => a.geaendertAm.localeCompare(b.geaendertAm));
  }

  async ausgangAnzahl(): Promise<number> {
    return (await this.db()).count('ausgang');
  }

  /**
   * Liest die aktuellen Daten zu Ausgang-Einträgen. Fehlt ein Datensatz
   * inzwischen, geht er als Grabstein raus.
   */
  async datenFuer(eintraege: readonly AusgangEintrag[]): Promise<SyncDatensatz[]> {
    const tx = (await this.db()).transaction(DATEN, 'readonly');
    const liste: SyncDatensatz[] = [];
    for (const e of eintraege) {
      const wert = e.geloescht ? undefined : await tx.objectStore(STORE_VON[e.art]).get(e.schluessel);
      const geloescht = wert === undefined;
      liste.push({ art: e.art, schluessel: e.schluessel, daten: geloescht ? null : wert, geaendertAm: e.geaendertAm, geloescht });
    }
    await tx.done;
    return liste;
  }

  /**
   * Entfernt hochgeladene Einträge aus dem Ausgang — aber nur, wenn sie seither
   * nicht erneut geändert wurden (dann muss die neue Fassung noch hoch).
   */
  async ausgangErledigt(eintraege: readonly Pick<AusgangEintrag, 'id' | 'geaendertAm'>[]): Promise<void> {
    const tx = (await this.db()).transaction('ausgang', 'readwrite');
    for (const e of eintraege) {
      const aktuell = await tx.store.get(e.id);
      if (aktuell?.geaendertAm === e.geaendertAm) await tx.store.delete(e.id);
    }
    await tx.done;
  }

  /**
   * Vergisst den lokalen Stand (der Server hat die Änderung abgelehnt, weil er
   * einen neueren hat): Beim nächsten Abgleich gewinnt dann der Server. Liegt
   * inzwischen eine neuere lokale Änderung im Ausgang, bleibt der Stand.
   */
  async staendeVergessen(ids: readonly string[]): Promise<void> {
    const tx = (await this.db()).transaction(SYNC, 'readwrite');
    for (const id of ids) {
      if (!(await tx.objectStore('ausgang').get(id))) await tx.objectStore('syncstand').put('', id);
    }
    await tx.done;
  }

  /**
   * Übernimmt Zeitstempel, die der Server beim Hochladen ersetzt hat (Geräteuhr falsch) —
   * wie bei staendeVergessen nur, wenn keine neuere lokale Änderung im Ausgang liegt.
   */
  async staendeSetzen(liste: readonly { id: string; geaendertAm: string }[]): Promise<void> {
    if (!liste.length) return;
    const tx = (await this.db()).transaction(SYNC, 'readwrite');
    for (const { id, geaendertAm } of liste) {
      if (!(await tx.objectStore('ausgang').get(id))) await tx.objectStore('syncstand').put(geaendertAm, id);
    }
    await tx.done;
  }

  /** Merkt Datensätze vor, die nicht synchronisiert werden konnten und nur auf dem Gerät liegen. */
  async merkeNurLokal(liste: readonly NurLokal[]): Promise<void> {
    if (!liste.length) return;
    const tx = (await this.db()).transaction('syncstand', 'readwrite');
    for (const e of liste) await tx.store.put(e, NUR_LOKAL + e.id);
    await tx.done;
  }

  /** Datensätze, die nur auf diesem Gerät liegen (siehe merkeNurLokal). */
  async nurLokal(): Promise<NurLokal[]> {
    const db = await this.db();
    const bereich = IDBKeyRange.bound(NUR_LOKAL, NUR_LOKAL + '\uffff');
    return (await db.getAll('syncstand', bereich)).filter(
      (x): x is NurLokal => typeof x === 'object' && x !== null && typeof (x as NurLokal).id === 'string',
    );
  }

  /** Vergisst die Markierung «nur lokal» (Datensatz erfolgreich hochgeladen). */
  async nurLokalVergessen(ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    const tx = (await this.db()).transaction('syncstand', 'readwrite');
    for (const id of ids) await tx.store.delete(NUR_LOKAL + id);
    await tx.done;
  }

  async syncZuletzt(): Promise<string | null> {
    const v = await (await this.db()).get('syncstand', ZULETZT_SCHLUESSEL);
    return typeof v === 'string' && v ? v : null;
  }

  async setzeSyncZuletzt(iso: string): Promise<void> {
    await (await this.db()).put('syncstand', iso, ZULETZT_SCHLUESSEL);
  }

  async syncEpoche(): Promise<string | null> {
    const v = await (await this.db()).get('syncstand', EPOCHE_SCHLUESSEL);
    return typeof v === 'string' && v ? v : null;
  }

  async setzeSyncEpoche(epoche: string | null): Promise<void> {
    const db = await this.db();
    if (epoche) await db.put('syncstand', epoche, EPOCHE_SCHLUESSEL);
    else await db.delete('syncstand', EPOCHE_SCHLUESSEL);
  }

  /** Prüfstand, mit dem zuletzt Datensätze vom Server abgelehnt wurden (null = keine). */
  async nachholenStand(): Promise<number | null> {
    const v = await (await this.db()).get('syncstand', NACHHOLEN_SCHLUESSEL);
    return typeof v === 'number' ? v : null;
  }

  async setzeNachholen(stand: number | null): Promise<void> {
    const db = await this.db();
    if (stand === null) await db.delete('syncstand', NACHHOLEN_SCHLUESSEL);
    else await db.put('syncstand', stand, NACHHOLEN_SCHLUESSEL);
  }

  async syncVersion(): Promise<number> {
    const v = await (await this.db()).get('syncstand', VERSION_SCHLUESSEL);
    return typeof v === 'number' ? v : 0;
  }

  async setzeSyncVersion(version: number): Promise<void> {
    await (await this.db()).put('syncstand', version, VERSION_SCHLUESSEL);
  }

  /**
   * Übernimmt Datensätze vom Server — nur neuere als die lokalen (last write
   * wins) und nur gültige (`pruefe`). Ohne Ausgang-Eintrag; ein veralteter
   * Ausgang-Eintrag desselben Datensatzes entfällt. Liefert die betroffenen Arten und
   * die Anzahl abgelehnter (ungültiger) Datensätze.
   */
  async wendeFernAn(
    liste: readonly SyncDatensatz[],
    pruefe: (d: SyncDatensatz) => unknown,
  ): Promise<{ arten: Set<SyncArt>; ungueltig: number }> {
    const arten = new Set<SyncArt>();
    if (!liste.length) return { arten, ungueltig: 0 };
    const tx = await this.schreibTx(DATEN);
    const stand = tx.objectStore('syncstand');
    const staende = new Map<string, string | undefined>();
    for (const d of liste) {
      const id = syncId(d.art, d.schluessel);
      if (!staende.has(id)) {
        const s = await stand.get(id);
        staende.set(id, typeof s === 'string' ? s : undefined);
      }
    }
    const { anwenden, ungueltig } = planeAnwendung(liste, staende, pruefe);
    if (ungueltig.length) console.warn('Sync: ungültige Datensätze vom Server übersprungen', ungueltig.map((d) => syncId(d.art, d.schluessel)));
    for (const a of anwenden) {
      const store = tx.objectStore(STORE_VON[a.art]);
      if (a.art === 'einstellung') {
        // Zweite Absicherung (planeAnwendung filtert schon): nur synchronisierte Schlüssel.
        if (!SYNC_EINSTELLUNGEN.includes(a.schluessel)) continue;
        if (a.wert === null) await store.delete(a.schluessel);
        else {
          // Gerätebezogene Werte (z. B. Farbschema) bleiben lokal erhalten.
          const lokal = await store.get(a.schluessel);
          await store.put({ ...(typeof lokal === 'object' && lokal ? lokal : {}), ...(a.wert as object) }, a.schluessel);
        }
      } else if (a.wert === null) {
        await store.delete(a.schluessel);
      } else {
        await (store as unknown as { put(v: unknown): Promise<unknown> }).put(a.wert);
      }
      await stand.put(a.geaendertAm, a.id);
      await tx.objectStore('ausgang').delete(a.id);
      // Die Fassung vom Server gilt jetzt — es liegt nichts mehr nur hier.
      await stand.delete(NUR_LOKAL + a.id);
      arten.add(a.art);
    }
    await tx.done;
    return { arten, ungueltig: ungueltig.length };
  }

  /**
   * Legt alle vorhandenen Daten in den Ausgang — für die erste Anmeldung auf
   * einem Gerät mit Daten aus der Version ohne Server. Zeitstempel: der eigene
   * Stand jedes Datensatzes (umzugStempel). Mit `stempelAusStand` (Server wurde
   * zurückgesetzt) zuerst der bekannte Sync-Stand des Datensatzes, damit «last
   * write wins» wie vorher entscheidet. Liefert die Anzahl Einträge.
   */
  async allesInAusgang(opt: { stempelAusStand?: boolean } = {}): Promise<number> {
    const tx = await this.schreibTx(DATEN);
    const eintraege: AusgangEintrag[] = [];
    const staende = new Map<string, string>();
    if (opt.stempelAusStand) {
      let zeiger = await tx.objectStore('syncstand').openCursor();
      while (zeiger) {
        if (typeof zeiger.value === 'string' && zeiger.value && !zeiger.key.startsWith('#')) staende.set(zeiger.key, zeiger.value);
        zeiger = await zeiger.continue();
      }
    }
    const neu = (art: SyncArt, schluessel: string, wert: unknown) => {
      const id = syncId(art, schluessel);
      const e: AusgangEintrag = { id, art, schluessel, geaendertAm: staende.get(id) ?? umzugStempel(art, wert), geloescht: false };
      if (this.konto) e.konto = this.konto;
      eintraege.push(e);
    };
    for (const l of await tx.objectStore('lektionen').getAll()) neu('lektion', l.id, l);
    for (const f of await tx.objectStore('fortschritt').getAll()) neu('fortschritt', f.schluessel, f);
    for (const p of await tx.objectStore('pruefungen').getAll()) neu('pruefung', p.id, p);
    for (const r of await tx.objectStore('rueckmeldungen').getAll()) neu('rueckmeldung', r.id, r);
    for (const s of SYNC_EINSTELLUNGEN) {
      const wert = await tx.objectStore('einstellungen').get(s);
      if (wert !== undefined) neu('einstellung', s, wert);
    }
    for (const e of eintraege) {
      // Ein bereits vorgemerkter (neuerer) Eintrag bleibt.
      if (await tx.objectStore('ausgang').get(e.id)) continue;
      await tx.objectStore('ausgang').put(e);
      await tx.objectStore('syncstand').put(e.geaendertAm, e.id);
    }
    await tx.done;
    if (eintraege.length) this.melde();
    return eintraege.length;
  }

  /**
   * Leert alle Daten auf diesem Gerät inkl. Ausgang und Sync-Stand. Schlüssel des
   * Einstellungs-Speichers in `behalten` (z. B. der Konto-Marker) bleiben.
   */
  async leereAlles(behalten: readonly string[] = []): Promise<void> {
    const tx = await this.schreibTx(DATEN);
    for (const store of ['lektionen', 'fortschritt', 'pruefungen', 'rueckmeldungen', 'ausgang', 'syncstand'] as const) {
      await tx.objectStore(store).clear();
    }
    const einstellungen = tx.objectStore('einstellungen');
    for (const k of await einstellungen.getAllKeys()) {
      if (!behalten.includes(k)) await einstellungen.delete(k);
    }
    await tx.done;
  }
}
