import { Injectable, inject, signal } from '@angular/core';

import { SpeicherService } from './speicher.service';

export interface Einstellungen {
  /** Anzahl Fragen pro Lernrunde. */
  rundenGroesse: number;
  /** Anzahl Fragen pro Probeprüfung. */
  pruefungAnzahl: number;
  /** Zeitlimit der Probeprüfung in Minuten (0 = ohne). */
  pruefungMinuten: number;
  /** Claude-Modell für die Lektionserstellung. */
  kiModell: string;
  /** Hell, dunkel oder wie das Gerät. */
  farbschema: 'auto' | 'hell' | 'dunkel';
}

export const STANDARD_EINSTELLUNGEN: Einstellungen = {
  rundenGroesse: 12,
  pruefungAnzahl: 20,
  pruefungMinuten: 30,
  kiModell: 'claude-opus-5-5',
  farbschema: 'auto',
};

const SCHLUESSEL = 'einstellungen';
/** Gerätebezogen, eigener Schlüssel (nicht in SYNC_EINSTELLUNGEN). */
const FARBSCHEMA_SCHLUESSEL = 'farbschema';
const API_SCHLUESSEL = 'anthropicApiKey';
const FARBSCHEMATA: readonly Einstellungen['farbschema'][] = ['auto', 'hell', 'dunkel'];

/**
 * Einstellungen (werden synchronisiert, ausser dem gerätebezogenen Farbschema)
 * und der API-Schlüssel für die KI-Erstellung. Der Schlüssel
 * liegt nur in der IndexedDB dieses Geräts und geht ausschliesslich an
 * api.anthropic.com.
 */
@Injectable({ providedIn: 'root' })
export class EinstellungenService {
  private readonly speicher = inject(SpeicherService);

  private readonly _werte = signal<Einstellungen>(STANDARD_EINSTELLUNGEN);
  private readonly _hatApiSchluessel = signal(false);
  readonly werte = this._werte.asReadonly();
  readonly hatApiSchluessel = this._hatApiSchluessel.asReadonly();

  private ladenPromise: Promise<void> | null = null;

  laden(): Promise<void> {
    this.ladenPromise ??= this.ladeIntern();
    return this.ladenPromise;
  }

  /** Liest Einstellungen und Schlüssel-Status erneut (nach Synchronisation oder Kontowechsel). */
  async neuLaden(): Promise<void> {
    await this.laden();
    this.ladenPromise = this.ladeIntern();
    return this.ladenPromise;
  }

  private ladeIntern(): Promise<void> {
    return (async () => {
      const [gespeichert, farbschema] = await Promise.all([
        this.speicher.lies<Partial<Einstellungen>>(SCHLUESSEL).catch(() => undefined),
        this.speicher.lies<Einstellungen['farbschema']>(FARBSCHEMA_SCHLUESSEL).catch(() => undefined),
      ]);
      const werte = { ...STANDARD_EINSTELLUNGEN, ...gespeichert };
      // Eigener Schlüssel; früher stand das Farbschema im synchronisierten Objekt.
      if (farbschema && FARBSCHEMATA.includes(farbschema)) werte.farbschema = farbschema;
      this._werte.set(werte);
      this._hatApiSchluessel.set(!!(await this.apiSchluessel()));
      this.wendeFarbschemaAn();
    })();
  }

  /**
   * Ändert Einstellungen. Das Farbschema bleibt auf dem Gerät (eigener Schlüssel); die
   * übrigen Werte gehen nur zum Server, wenn sich einer davon wirklich ändert — sonst
   * überschriebe z. B. ein Wechsel des Farbschemas die Werte der anderen Geräte.
   * `syncStempel` gibt den Sync-Zeitstempel vor (Backup-Import).
   */
  async aendern(teil: Partial<Einstellungen>, opt: { syncStempel?: string } = {}): Promise<void> {
    const alt = this._werte();
    const neu = { ...alt, ...teil };
    this._werte.set(neu);
    const { farbschema, ...synchronisiert } = teil;
    if (farbschema !== undefined && farbschema !== alt.farbschema) {
      await this.speicher.schreibe(FARBSCHEMA_SCHLUESSEL, farbschema);
    }
    // Erst nach dem Speichern anwenden: Was sichtbar ist, übersteht auch ein sofortiges Neuladen.
    this.wendeFarbschemaAn();
    const geaendert = (Object.keys(synchronisiert) as (keyof typeof synchronisiert)[]).some(
      (k) => synchronisiert[k] !== undefined && synchronisiert[k] !== alt[k],
    );
    if (geaendert) {
      const { farbschema: _, ...ohneFarbschema } = neu;
      await this.speicher.schreibe(SCHLUESSEL, ohneFarbschema, opt);
    }
  }

  async apiSchluessel(): Promise<string | undefined> {
    return this.speicher.lies<string>(API_SCHLUESSEL).catch(() => undefined);
  }

  async setzeApiSchluessel(wert: string | null): Promise<void> {
    if (wert && wert.trim()) await this.speicher.schreibe(API_SCHLUESSEL, wert.trim());
    else await this.speicher.entferne(API_SCHLUESSEL);
    this._hatApiSchluessel.set(!!(wert && wert.trim()));
  }

  private wendeFarbschemaAn(): void {
    const schema = this._werte().farbschema;
    const root = document.documentElement;
    if (schema === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', schema === 'dunkel' ? 'dark' : 'light');
  }
}
