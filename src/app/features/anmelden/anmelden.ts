import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService, sichererZurueckPfad } from '../../core/services/auth.service';
import { BackupService } from '../../core/services/backup.service';
import { bezeichnung } from '../../core/services/sync.service';

/** Meldungen zu ?fehler= (vom Google-Callback oder bei abgelaufener Freigabe). */
export const ANMELDE_FEHLER: Record<string, string> = {
  'nicht-freigegeben':
    'Deine Google-Adresse ist für die Lernapp nicht freigegeben. Frag die Person, die dir die Lernapp gegeben hat, ob sie freigeschaltet werden kann – oder melde dich mit einer anderen Google-Adresse an.',
  abgelaufen:
    'Deine Anmeldung ist abgelaufen – melde dich nochmals an. Deine Änderungen auf diesem Gerät bleiben erhalten und werden danach übertragen.',
  abgebrochen: 'Die Anmeldung wurde abgebrochen. Du kannst es gleich nochmals versuchen.',
  fehler: 'Bei der Anmeldung ist etwas schiefgegangen. Versuch es bitte nochmals.',
};

/** Anmeldeseite: einziger Bildschirm ohne Anmeldung. */
@Component({
  selector: 'app-anmelden',
  templateUrl: './anmelden.html',
  styleUrl: './anmelden.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnmeldenSeite {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly backup = inject(BackupService);

  readonly zurueck = input<string>();
  readonly fehler = input<string>();

  readonly zustand = this.auth.zustand;
  readonly keinNetz = this.auth.keinNetz;
  readonly prueftErneut = this.auth.prueftErneut;
  readonly wechsel = this.auth.wechsel;
  readonly anmeldeUrl = computed(() => this.auth.anmeldeUrl(this.zurueck()));
  readonly fehlerCode = computed(() => this.fehler() ?? this.auth.fehler());
  readonly fehlerText = computed(() => {
    const code = this.fehlerCode();
    return code ? (ANMELDE_FEHLER[code] ?? ANMELDE_FEHLER['fehler']) : null;
  });
  readonly knopfText = computed(() =>
    this.fehlerCode() === 'nicht-freigegeben' ? 'Mit anderem Google-Konto anmelden' : 'Mit Google anmelden',
  );
  /** Was beim Personenwechsel verloren ginge, lesbar. */
  readonly wechselListe = computed(() => {
    const w = this.wechsel();
    return w ? w.nurLokal.map((e) => bezeichnung(e)) : [];
  });
  readonly backupLaeuft = signal(false);
  readonly backupFehler = signal<string | null>(null);

  nochmalsVersuchen(): void {
    this.auth.nochmalsPruefen();
  }

  async backupExportieren(): Promise<void> {
    this.backupFehler.set(null);
    this.backupLaeuft.set(true);
    try {
      await this.backup.exportiere();
    } catch (e) {
      console.error(e);
      this.backupFehler.set('Das Backup konnte nicht erstellt werden.');
    } finally {
      this.backupLaeuft.set(false);
    }
  }

  wechselWahl(wahl: 'verwerfen' | 'abbrechen'): void {
    this.auth.personenwechselWahl(wahl);
  }

  constructor() {
    // Bereits angemeldet (oder offline nach früherer Anmeldung): weiter zur gewünschten Seite.
    effect(() => {
      if (this.auth.istDrin()) void this.router.navigateByUrl(sichererZurueckPfad(this.zurueck()));
    });
  }
}
