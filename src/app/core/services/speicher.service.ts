import { Injectable } from '@angular/core';
import { DBSchema, IDBPDatabase, openDB } from 'idb';

import { FrageFortschritt, PruefungsErgebnis } from '../models/fortschritt.model';
import { Lektion } from '../models/lektion.model';

interface LernappDb extends DBSchema {
  /** Eigene, importierte und bearbeitete Lektionen. */
  lektionen: { key: string; value: Lektion };
  fortschritt: { key: string; value: FrageFortschritt; indexes: { lektionId: string } };
  pruefungen: { key: string; value: PruefungsErgebnis; indexes: { lektionId: string } };
  /** Schlüssel-Wert-Paare (Einstellungen). */
  einstellungen: { key: string; value: unknown };
}

const DB_NAME = 'lernapp';
const DB_VERSION = 1;

/**
 * Dünne Hülle um IndexedDB. Alle Daten bleiben auf dem Gerät; es gibt keinen
 * Server. Gerätewechsel laufen über Export/Import (siehe BackupService).
 */
@Injectable({ providedIn: 'root' })
export class SpeicherService {
  private dbPromise: Promise<IDBPDatabase<LernappDb>> | null = null;

  private db(): Promise<IDBPDatabase<LernappDb>> {
    this.dbPromise ??= openDB<LernappDb>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('lektionen', { keyPath: 'id' });
        db.createObjectStore('fortschritt', { keyPath: 'schluessel' }).createIndex('lektionId', 'lektionId');
        db.createObjectStore('pruefungen', { keyPath: 'id' }).createIndex('lektionId', 'lektionId');
        db.createObjectStore('einstellungen');
      },
      // Eine andere Anfrage (z. B. «Alle Daten löschen» oder ein neuer Tab mit
      // neuerer Version) will die DB umbauen: Verbindung freigeben.
      blocking: (_alt, _neu, ereignis) => {
        (ereignis.target as IDBDatabase).close();
        this.dbPromise = null;
      },
    });
    return this.dbPromise;
  }

  async alleLektionen(): Promise<Lektion[]> {
    return (await this.db()).getAll('lektionen');
  }

  async speichereLektion(l: Lektion): Promise<void> {
    await (await this.db()).put('lektionen', l);
  }

  async loescheLektion(id: string): Promise<void> {
    await (await this.db()).delete('lektionen', id);
  }

  async alleFortschritte(): Promise<FrageFortschritt[]> {
    return (await this.db()).getAll('fortschritt');
  }

  async speichereFortschritt(f: FrageFortschritt): Promise<void> {
    await (await this.db()).put('fortschritt', f);
  }

  async speichereFortschritte(liste: FrageFortschritt[]): Promise<void> {
    const tx = (await this.db()).transaction('fortschritt', 'readwrite');
    await Promise.all([...liste.map((f) => tx.store.put(f)), tx.done]);
  }

  async loescheFortschritt(lektionId: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(['fortschritt', 'pruefungen'], 'readwrite');
    for (const store of ['fortschritt', 'pruefungen'] as const) {
      const keys = await tx.objectStore(store).index('lektionId').getAllKeys(lektionId);
      await Promise.all(keys.map((k) => tx.objectStore(store).delete(k)));
    }
    await tx.done;
  }

  async allePruefungen(): Promise<PruefungsErgebnis[]> {
    return (await this.db()).getAll('pruefungen');
  }

  async speicherePruefung(p: PruefungsErgebnis): Promise<void> {
    await (await this.db()).put('pruefungen', p);
  }

  async lies<T>(schluessel: string): Promise<T | undefined> {
    return (await (await this.db()).get('einstellungen', schluessel)) as T | undefined;
  }

  async schreibe<T>(schluessel: string, wert: T): Promise<void> {
    await (await this.db()).put('einstellungen', wert, schluessel);
  }

  async entferne(schluessel: string): Promise<void> {
    await (await this.db()).delete('einstellungen', schluessel);
  }
}
