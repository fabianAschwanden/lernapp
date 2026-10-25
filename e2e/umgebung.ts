import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Port des PHP-Servers («php -S») für die E2E-Tests. */
export const PORT = 4321;
export const BASIS_URL = `http://127.0.0.1:${PORT}`;

/**
 * Verzeichnis der freigegebenen Test-Adressen (eine leere Datei pro Adresse), gelesen von
 * e2e/config.e2e.php. Gleicher Pfad für den Server und die Test-Worker.
 */
export const ERLAUBT_VERZEICHNIS =
  process.env['LERNAPP_E2E_ERLAUBT'] || join(tmpdir(), 'lernapp-e2e-erlaubt');
