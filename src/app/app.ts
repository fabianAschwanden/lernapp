import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';

import { AuthService } from './core/services/auth.service';
import { InstallationService } from './core/services/installation.service';
import { SyncService } from './core/services/sync.service';
import { UpdateService } from './core/services/update.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly update = inject(UpdateService);
  protected readonly auth = inject(AuthService);
  protected readonly sync = inject(SyncService);
  private readonly router = inject(Router);

  /** Auf der Anmeldeseite zeigt diese selbst an, dass die Anmeldung geprüft wird. */
  protected readonly aufAnmeldeseite = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects.startsWith('/anmelden')),
    ),
    { initialValue: location.pathname.startsWith('/anmelden') },
  );

  /** Kleiner Hinweis im Kopf, nur wenn nicht alles synchron ist. */
  protected readonly syncHinweis = computed(() => {
    if (this.auth.zustand() === 'abgelaufen') return 'Nicht übertragen';
    switch (this.sync.status()) {
      case 'offline':
        return 'Offline';
      case 'fehler':
        return 'Nicht übertragen';
      case 'ausstehend':
        return 'Wird übertragen';
      default:
        return null;
    }
  });

  protected neuAnmelden(): void {
    this.auth.anmelden(this.router.url);
  }

  constructor() {
    // Früh erzeugen, damit «beforeinstallprompt» nicht verpasst wird
    inject(InstallationService);
  }
}
