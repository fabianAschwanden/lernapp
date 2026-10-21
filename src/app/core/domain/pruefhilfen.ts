/** Kleine Typprüfungen für Daten unbekannter Herkunft (Import, Backup, KI-Antwort). */

export function istObjekt(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function nichtLeer(x: unknown): x is string {
  return typeof x === 'string' && x.trim().length > 0;
}

/** Liste mit mindestens `min` nicht leeren Texten. */
export function stringListe(x: unknown, min: number): x is string[] {
  return Array.isArray(x) && x.length >= min && x.every(nichtLeer);
}

/** Liste von Texten (auch leer), z. B. Hinweise oder Merksätze. */
export function istTextListe(x: unknown): x is string[] {
  return Array.isArray(x) && x.every((t) => typeof t === 'string');
}

const DATA_BILD = /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/]+={0,2}$/i;
const APP_BILD = /^bilder\/[a-z0-9._/-]+$/i;

/**
 * Erlaubte Bildquellen: Abbildungen der App (`bilder/…`, relativ, ohne `..`)
 * und eingebettete Rasterbilder (`data:image/png|jpeg|webp|gif;base64,…`).
 * Fremde Adressen (https:, //…) würden beim Anzeigen einen fremden Server
 * aufrufen (Tracking, fehlt offline) und sind deshalb nicht erlaubt.
 */
export function istErlaubteBildQuelle(src: unknown): src is string {
  if (typeof src !== 'string') return false;
  if (src.startsWith('data:')) return DATA_BILD.test(src);
  return APP_BILD.test(src) && !src.split('/').includes('..');
}
