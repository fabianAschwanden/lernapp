import { Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SwUpdate, VersionReadyEvent } from '@angular/service-worker';
import { filter } from 'rxjs';

/**
 * Neue App-Versionen (auch korrigierte mitgelieferte Lektionen) lädt der
 * Service Worker im Hintergrund. Dieser Dienst meldet, wenn eine bereitliegt,
 * damit die App einen Hinweis «Neu laden» zeigen kann — statt dass die neue
 * Version erst nach einem weiteren Neustart und ohne Hinweis erscheint.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly sw = inject(SwUpdate);

  /** Eine neue Version ist geladen und wird nach dem Neuladen aktiv. */
  readonly neueVersion = signal(false);
  /** Der Service Worker kann die laufende Version nicht mehr bedienen (z. B. Dateien fehlen). */
  readonly defekt = signal(false);

  constructor() {
    if (!this.sw.isEnabled) return;
    this.sw.versionUpdates
      .pipe(
        filter((e): e is VersionReadyEvent => e.type === 'VERSION_READY'),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.neueVersion.set(true));
    this.sw.unrecoverable.pipe(takeUntilDestroyed()).subscribe((e) => {
      console.warn('Service Worker: App muss neu geladen werden', e.reason);
      this.defekt.set(true);
    });
  }

  neuLaden(): void {
    document.location.reload();
  }
}
