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
const API_SCHLUESSEL = 'anthropicApiKey';

/**
 * Einstellungen und der API-Schlüssel für die KI-Erstellung. Der Schlüssel
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
    this.ladenPromise ??= (async () => {
      const gespeichert = await this.speicher.lies<Partial<Einstellungen>>(SCHLUESSEL).catch(() => undefined);
      this._werte.set({ ...STANDARD_EINSTELLUNGEN, ...gespeichert });
      this._hatApiSchluessel.set(!!(await this.apiSchluessel()));
      this.wendeFarbschemaAn();
    })();
    return this.ladenPromise;
  }

  async aendern(teil: Partial<Einstellungen>): Promise<void> {
    const neu = { ...this._werte(), ...teil };
    this._werte.set(neu);
    await this.speicher.schreibe(SCHLUESSEL, neu);
    this.wendeFarbschemaAn();
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
