import { Injectable, computed, signal } from '@angular/core';

/** Das (noch nicht standardisierte) Ereignis, mit dem Chrome/Edge die Installation anbieten. */
export interface InstallierEreignis extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Fängt `beforeinstallprompt` gleich beim Start ab — das Ereignis kommt nur
 * einmal und oft, bevor jemand die Einstellungen öffnet.
 */
@Injectable({ providedIn: 'root' })
export class InstallationService {
  private readonly ereignis = signal<InstallierEreignis | null>(null);
  readonly kannInstallieren = computed(() => this.ereignis() !== null);
  readonly istInstalliert = signal(
    typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches,
  );

  constructor() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.ereignis.set(e as InstallierEreignis);
    });
    window.addEventListener('appinstalled', () => {
      this.ereignis.set(null);
      this.istInstalliert.set(true);
    });
  }

  /** Zeigt den Installationsdialog des Browsers. true = installiert. */
  async installieren(): Promise<boolean | null> {
    const e = this.ereignis();
    if (!e) return null;
    await e.prompt();
    const { outcome } = await e.userChoice;
    this.ereignis.set(null);
    return outcome === 'accepted';
  }
}
