import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

import type { FullConfig } from '@playwright/test';

import { ERLAUBT_VERZEICHNIS } from './umgebung';

/** Gleicher Wert wie deploy_token in e2e/config.e2e.php (nur lokal, kein Geheimnis). */
const DEPLOY_TOKEN = 'e2e-deploy-token-nur-fuer-lokale-tests';

/**
 * Vor allen Tests (der Webserver läuft da schon): Test-Datenbank starten (lokal per
 * Docker, ausser LERNAPP_TEST_DB_DSN zeigt auf eine eigene), Tabellen e2e_* löschen,
 * Schema über POST /api/admin/migrieren neu anlegen, Freigaben leeren.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  if (!process.env['LERNAPP_TEST_DB_DSN']) {
    execFileSync('bash', ['scripts/test-db.sh'], { stdio: 'inherit' });
  }
  execFileSync('php', ['e2e/db-zuruecksetzen.php'], { stdio: 'inherit' });
  rmSync(ERLAUBT_VERZEICHNIS, { recursive: true, force: true });
  mkdirSync(ERLAUBT_VERZEICHNIS, { recursive: true });

  const basis = config.projects[0]?.use.baseURL ?? config.webServer?.url;
  const antwort = await fetch(`${basis}/api/admin/migrieren`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${DEPLOY_TOKEN}` },
  });
  const text = await antwort.text();
  if (!antwort.ok) throw new Error(`Migration für E2E fehlgeschlagen: ${antwort.status} ${text}`);
  const status = await fetch(`${basis}/api/status`);
  if (!status.ok)
    throw new Error(`/api/status nach der Migration: ${status.status} ${await status.text()}`);
}
