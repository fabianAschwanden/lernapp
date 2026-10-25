import { InjectionToken } from '@angular/core';

/** Navigation ausserhalb des Routers (für Tests austauschbar). */
export const SEITE = new InjectionToken<{ gehe(url: string): void; neuLaden(): void }>('SEITE', {
  providedIn: 'root',
  factory: () => ({
    gehe: (url: string) => location.assign(url),
    neuLaden: () => location.reload(),
  }),
});
