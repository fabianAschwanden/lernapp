import {
  ApplicationConfig,
  LOCALE_ID,
  inject,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeDeCh from '@angular/common/locales/de-CH';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';

import { routes } from './app.routes';
import { EinstellungenService } from './core/services/einstellungen.service';
import { FortschrittService } from './core/services/fortschritt.service';
import { LektionService } from './core/services/lektion.service';

registerLocaleData(localeDeCh, 'de-CH');

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: LOCALE_ID, useValue: 'de-CH' },
    provideBrowserGlobalErrorListeners(),
    // withComponentInputBinding: Route- und Query-Parameter landen als input()
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    // Lektionen, Lernstand und Einstellungen vor dem ersten Bildschirm laden —
    // alles lokal (IndexedDB + mitgelieferte JSON), also schnell.
    provideAppInitializer(() =>
      Promise.all([inject(LektionService).laden(), inject(FortschrittService).laden(), inject(EinstellungenService).laden()]),
    ),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
