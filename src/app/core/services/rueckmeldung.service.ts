import { Injectable, computed, inject, signal } from '@angular/core';

import { lehrpersonProfile, profilSchluessel } from '../domain/rueckmeldung';
import { LehrpersonProfil, PruefungsRueckmeldung } from '../models/rueckmeldung.model';
import { SpeicherService } from './speicher.service';

/**
 * Rückmeldungen nach der echten Prüfung (eine pro Lektion) und die daraus
 * abgeleiteten Profile pro Fach (= Lehrperson). Lokal gespeichert und synchronisiert.
 */
@Injectable({ providedIn: 'root' })
export class RueckmeldungService {
  private readonly speicher = inject(SpeicherService);

  private readonly _alle = signal<PruefungsRueckmeldung[]>([]);
  readonly alle = this._alle.asReadonly();
  readonly geladen = signal(false);

  /** Profile pro Fach, das mit der neuesten Prüfung zuerst. */
  readonly profile = computed<LehrpersonProfil[]>(() => lehrpersonProfile(this._alle()));

  private ladenPromise: Promise<void> | null = null;

  /** Lädt einmalig; weitere Aufrufe warten auf denselben Vorgang. */
  laden(): Promise<void> {
    this.ladenPromise ??= this.ladeIntern();
    return this.ladenPromise;
  }

  /** Liest die Rückmeldungen erneut (nach einer Synchronisation). */
  async neuLaden(): Promise<void> {
    await this.laden();
    this.ladenPromise = this.ladeIntern();
    return this.ladenPromise;
  }

  private async ladeIntern(): Promise<void> {
    const liste = await this.speicher.alleRueckmeldungen().catch((e) => {
      console.error(e);
      return [] as PruefungsRueckmeldung[];
    });
    this._alle.set(liste);
    this.geladen.set(true);
  }

  fuerLektion(lektionId: string): PruefungsRueckmeldung | undefined {
    return this._alle().find((r) => r.lektionId === lektionId);
  }

  profilFuerFach(fach: string): LehrpersonProfil | null {
    const s = profilSchluessel(fach);
    return this.profile().find((p) => p.schluessel === s) ?? null;
  }

  /**
   * Speichert eine Rückmeldung und setzt `geaendertAm`. `zeitstempelBehalten`
   * für den Backup-Import (sonst gälte die importierte fälschlich als neuer).
   * `import`: auch der Sync-Zeitstempel ist der Stand des Inhalts — nur beim
   * Backup-Import, nicht bei echten lokalen Änderungen wie fachNachziehen.
   */
  async speichern(
    r: PruefungsRueckmeldung,
    opt: { zeitstempelBehalten?: boolean; import?: boolean } = {},
  ): Promise<void> {
    const neu: PruefungsRueckmeldung = opt.zeitstempelBehalten
      ? { ...r }
      : { ...r, geaendertAm: new Date().toISOString() };
    await this.speicher.speichereRueckmeldung(neu, { importiert: !!opt.import });
    this._alle.update((liste) => [...liste.filter((x) => x.id !== neu.id), neu]);
  }

  /**
   * Übernimmt ein geändertes Fach der Lektion in deren Rückmeldung, damit das
   * Profil unter dem neuen Fach zu finden ist. Der Zeitstempel bleibt, weil sich
   * am Inhalt der Rückmeldung nichts geändert hat.
   */
  async fachNachziehen(lektionId: string, fach: string): Promise<void> {
    const r = this.fuerLektion(lektionId);
    if (!r || r.fach === fach) return;
    await this.speichern({ ...r, fach }, { zeitstempelBehalten: true });
  }

  async loeschen(id: string): Promise<void> {
    await this.speicher.loescheRueckmeldung(id);
    this._alle.update((liste) => liste.filter((x) => x.id !== id));
  }
}
