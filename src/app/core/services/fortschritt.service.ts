import { Injectable, inject, signal } from '@angular/core';

import { FortschrittMap, verbucheAntwort, fortschrittVon } from '../domain/planer';
import { Bewertung, FrageFortschritt, PruefungsErgebnis } from '../models/fortschritt.model';
import { Frage, Lektion } from '../models/lektion.model';
import { SpeicherService } from './speicher.service';

/** Lernstand aller Fragen und die Ergebnisse der Probeprüfungen. */
@Injectable({ providedIn: 'root' })
export class FortschrittService {
  private readonly speicher = inject(SpeicherService);

  private readonly _map = signal<FortschrittMap>(new Map());
  private readonly _pruefungen = signal<PruefungsErgebnis[]>([]);
  readonly map = this._map.asReadonly();
  readonly pruefungen = this._pruefungen.asReadonly();

  private ladenPromise: Promise<void> | null = null;

  laden(): Promise<void> {
    this.ladenPromise ??= this.ladeIntern();
    return this.ladenPromise;
  }

  /** Liest Lernstand und Probeprüfungen erneut (nach einer Synchronisation). */
  async neuLaden(): Promise<void> {
    await this.laden().catch(() => undefined);
    this.ladenPromise = this.ladeIntern();
    return this.ladenPromise;
  }

  private ladeIntern(): Promise<void> {
    return (async () => {
      const [fs, pr] = await Promise.all([
        this.speicher.alleFortschritte().catch(() => [] as FrageFortschritt[]),
        this.speicher.allePruefungen().catch(() => [] as PruefungsErgebnis[]),
      ]);
      this._map.set(new Map(fs.map((f) => [f.schluessel, f])));
      this._pruefungen.set(pr);
    })();
  }

  von(lektion: Lektion, frage: Frage): FrageFortschritt {
    return fortschrittVon(lektion.id, frage, this._map());
  }

  async verbuche(lektion: Lektion, frage: Frage, bewertung: Bewertung, jetzt = new Date()): Promise<FrageFortschritt> {
    const neu = verbucheAntwort(this.von(lektion, frage), bewertung, jetzt, lektion.pruefungsdatum);
    this._map.update((m) => new Map(m).set(neu.schluessel, neu));
    await this.speicher.speichereFortschritt(neu);
    return neu;
  }

  pruefungenVon(lektionId: string): PruefungsErgebnis[] {
    return this._pruefungen()
      .filter((p) => p.lektionId === lektionId)
      .sort((a, b) => b.am.localeCompare(a.am));
  }

  async speicherePruefung(p: PruefungsErgebnis): Promise<void> {
    await this.speicher.speicherePruefung(p);
    this._pruefungen.update((l) => [...l.filter((x) => x.id !== p.id), p]);
  }

  async zuruecksetzen(lektionId: string): Promise<void> {
    await this.speicher.loescheFortschritt(lektionId);
    this._map.update((m) => new Map([...m].filter(([, f]) => f.lektionId !== lektionId)));
    this._pruefungen.update((l) => l.filter((p) => p.lektionId !== lektionId));
  }

  /**
   * Übernimmt Fortschritte aus einem Backup (neuere Antwort gewinnt). Sync-Stempel ist der
   * Stand des Inhalts, damit ein altes Backup keine neueren Stände auf dem Server
   * überschreibt. Vorhandene Probeprüfungen bleiben (gleiche id = gleiche Prüfung).
   */
  async uebernehme(liste: FrageFortschritt[], pruefungen: PruefungsErgebnis[]): Promise<void> {
    await this.laden();
    const aktuell = this._map();
    const neuer = liste.filter((f) => {
      const alt = aktuell.get(f.schluessel);
      return !alt || (f.zuletzt ?? '') > (alt.zuletzt ?? '');
    });
    await this.speicher.speichereFortschritte(neuer, { importiert: true });
    const vorhanden = new Set(this._pruefungen().map((p) => p.id));
    pruefungen = pruefungen.filter((p) => !vorhanden.has(p.id));
    for (const p of pruefungen) await this.speicher.speicherePruefung(p, { importiert: true });
    this._map.update((m) => {
      const n = new Map(m);
      for (const f of neuer) n.set(f.schluessel, f);
      return n;
    });
    this._pruefungen.update((l) => {
      const ids = new Set(pruefungen.map((p) => p.id));
      return [...l.filter((p) => !ids.has(p.id)), ...pruefungen];
    });
  }
}
