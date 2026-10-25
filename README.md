# Lernapp

Lern-App für PC und Handy: Lernstoff aus Skripten, Fotos von Buchseiten und Lernzielen zu einer **Lektion** zusammenstellen und anhand der Lernziele üben.

- **Lernen** mit Wiederholung nach dem Leitner-Prinzip — was falsch war, kommt bald wieder; was sitzt, seltener.
- **Lernstand pro Lernziel** — man sieht, welche Lernziele schon sitzen.
- **Probeprüfung** mit Zeitlimit, Selbstkorrektur offener Fragen und Note nach Schweizer Skala (1 + 5 × Punkte / Maximum).
- **Lernzettel** pro Lernziel, druckbar.
- **Lektion erstellen** aus PDF/Fotos/Text + Lernzielen: direkt mit Claude (eigener API-Schlüssel) oder ohne Schlüssel per «Prompt kopieren» in claude.ai; dazu Import/Export und ein Editor.
- **Anmeldung mit Google** (nur freigegebene Adressen) und **Synchronisation** zwischen PC und Handy: Lernstand, eigene Lektionen, Prüfungen und Rückmeldungen liegen zusätzlich auf dem Server (MariaDB bei Hostpoint). Der Claude-API-Schlüssel bleibt nur auf dem Gerät.
- Läuft **offline** als installierbare App (PWA), sobald Du Dich auf dem Gerät einmal angemeldet hast; Änderungen werden später synchronisiert. Backup-Datei für Export/Import bleibt.

Mitgeliefert: **Informatik – Prüfung 1** (FMS1A): Bauteile, Speicher, Anschlüsse, EVA-Prinzip, Bits und Bytes, Teams/Klassennotizbuch, Passwörter.

## Entwicklung

```sh
npm install
npm start                         # http://localhost:4200 (/api → localhost:8080)
npx ng build                      # Produktions-Build → dist/lernapp/browser
npx ng test --watch=false         # Unit-Tests
npx playwright test               # E2E (Build + php -S + MariaDB)
node scripts/lektion-bauen.mjs --pruefen   # mitgelieferte Lektionen prüfen

scripts/test-db.sh                # MariaDB 10.11 in Docker (Port 3307) für PHP- und E2E-Tests
php api/tests/laufen.php          # PHP-Tests der API
scripts/apache-test.sh            # deploy/htaccess mit Apache in Docker prüfen
LERNAPP_CONFIG=api/config.lokal.php php -S localhost:8080 scripts/php-router.php   # API lokal
```

Neue mitgelieferte Lektionen: siehe `.claude/skills/lektion-erstellen/SKILL.md`. Architektur und Konventionen: `CLAUDE.md`.

## Betrieb

Läuft auf Hostpoint unter <https://lernapp.urinet.ch>: Angular-Build statisch und PHP-API unter `/api` auf derselben Domain, Daten in MariaDB. Deploy nur über GitHub Actions (`.github/workflows/hostpoint-deploy.yml`, FTPS) nach jedem Push auf `main`, mit Tests vorher und Live-Prüfung danach. Einrichtung (Website, Google-OAuth-Client, Secrets, Umzug von Fly.io): [`docs/einrichtung-hostpoint.md`](docs/einrichtung-hostpoint.md).

Auf dem Handy: <https://lernapp.urinet.ch> im Browser öffnen, anmelden, dann «Zum Home-Bildschirm» bzw. «App installieren».
