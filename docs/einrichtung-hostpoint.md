# Lernapp auf Hostpoint einrichten

Die Lernapp läuft als eine Website bei Hostpoint: der Angular-Build statisch, daneben eine kleine
PHP-API unter `/api` (Google-Login, Synchronisation), die Daten liegen in einer MariaDB. Deployt wird
nur über GitHub Actions (`.github/workflows/hostpoint-deploy.yml`), nie von Hand per FTP.

```
https://lernapp.urinet.ch            Website «Apache mit PHP», PHP 8.3+
  ~/www/lernapp/            Webroot: Build + .htaccess (aus deploy/htaccess) + api/
  ~/private/lernapp/config.php        Konfiguration mit Geheimnissen (ausserhalb des Webroots)
  MariaDB aziwivac.mysql.db.internal  nur aus Hostpoint-Webprozessen erreichbar (nicht aus CI/SSH)
```

Darum ändert sich die Datenbank nur über den Endpunkt `POST /api/admin/migrieren`, den der Deploy
mit dem `DEPLOY_TOKEN` aufruft.

Diese Schritte machst Du einmal selbst. Danach deployt jeder Push auf `main`.

## 1. Hostpoint

1. **Website anlegen** (Control Panel › Websites): Domain `lernapp.urinet.ch`, Verzeichnis
   `www/lernapp`, Typ **«Apache mit PHP»**, PHP **8.3 oder neuer**.
   Eine reine nginx-Website wertet die `.htaccess` nicht aus: Dann gibt es kein `/api`, und die
   Sperren für Punktdateien und `api/lib` greifen nicht. Der Deploy prüft vor dem Upload, ob die
   Website als Apache antwortet (`Server`-Header), und bricht sonst ab — das greift schon beim
   ersten Deploy.
   Die `.htaccess` pinnt zusätzlich PHP 8.3 (`Use php-fpm php83`), dieselbe Version wie in der CI.
2. **FreeSSL** für `lernapp.urinet.ch` aktivieren. Das Zertifikat kommt erst, wenn das DNS auf
   Hostpoint zeigt. Ohne gültiges Zertifikat bricht der Deploy vor dem Upload ab.
3. **Datenbank:** eigene Datenbank `aziwivac_lernapp` (MariaDB 10.11, Host
   `aziwivac.mysql.db.internal`) mit eigenem Benutzer, der nur Rechte auf diese Datenbank hat.
   Die Secrets `DB_HOST`, `DB_NAME`, `DB_USER` und `DB_PASSWORD` in Schritt 3 nennen sie.
   Das Passwort kommt nur in den Passwort-Manager und als GitHub-Secret, nie in eine Datei im Repo.
   Alle Tabellen tragen das Präfix `lernapp_` (Repo-Variable `TABELLEN_PRAEFIX`).

   Grenze: Andere Websites auf demselben Hostpoint-Konto könnten bei einer Code-Ausführung
   `~/private/lernapp/config.php` mit den DB-Zugangsdaten lesen. Die eigene Datenbank schützt vor
   SQL-Injection in anderen Projekten, nicht vor Code-Ausführung darin.

## 2. Google Cloud Console

1. Unter <https://console.cloud.google.com/> ein Projekt anlegen, z. B. «Lernapp».
2. **Google Auth Platform › Branding:** App-Name «Lernapp», Support-E-Mail, autorisierte Domain
   `urinet.ch`.
3. **Zielgruppe:** «Extern». Der Status **«Testen»** reicht: Trag unter *Testnutzer* dieselben
   Adressen ein wie in `ERLAUBTE_EMAILS`. Im Status «Testen» lässt Google nur diese Testnutzer zu,
   das ist eine zweite Sperre neben der Freigabeliste der App. Eine neue Person braucht also beides.
   Wer das nicht doppelt pflegen will, stellt die App auf «In Produktion». Für `openid email profile`
   ist keine Prüfung durch Google nötig, und die Freigabeliste der App bleibt die Sperre.
4. **Datenzugriff:** die Bereiche `openid`, `.../auth/userinfo.email` und `.../auth/userinfo.profile`.
5. **Clients › Client erstellen:** Typ «Webanwendung», Name «Lernapp».
   Autorisierte Weiterleitungs-URIs:
   - `https://lernapp.urinet.ch/api/auth/google/callback`
   - `http://localhost:4200/api/auth/google/callback` (Entwicklung mit `npm start`)

   JavaScript-Quellen braucht es keine: Der Login läuft serverseitig (Authorization Code mit PKCE).
6. Client-ID und Clientschlüssel in den Passwort-Manager und als Secrets setzen (Schritt 3).

## 3. GitHub-Secrets

Alle Werte werden interaktiv eingegeben, damit sie nicht in der Shell-Historie landen. Das Repo ist
öffentlich: Kein Wert gehört in eine Datei, ein Issue oder eine Commit-Nachricht.

```bash
R=fabianAschwanden/lernapp
gh secret set FTP_PASSWORD -R $R           # FTP-Passwort des Kontos aziwivac
gh secret set DB_HOST -R $R                # aziwivac.mysql.db.internal
gh secret set DB_NAME -R $R                # die eigene Datenbank (z. B. aziwivac_lernapp)
gh secret set DB_USER -R $R                # ihr eigener Benutzer (z. B. aziwivac_lern)
gh secret set DB_PASSWORD -R $R
gh secret set GOOGLE_CLIENT_ID -R $R       # …apps.googleusercontent.com
gh secret set GOOGLE_CLIENT_SECRET -R $R
gh secret set ERLAUBTE_EMAILS -R $R        # alle Adressen auf EINER Zeile, durch Komma getrennt (a@x.ch,b@y.ch)
openssl rand -hex 32 | gh secret set DEPLOY_TOKEN -R $R
# optional, Standard lernapp_ (nur a-z, 0-9, _; endet auf _):
gh variable set TABELLEN_PRAEFIX -R $R --body lernapp_
```

Die Eingabe von `gh secret set` ist einzeilig: Ein Zeilenumbruch schickt sie ab, gespeichert wird
dann nur die erste Adresse, und die übrigen eingefügten Zeilen landen in der Shell. Wer die Liste
lieber zeilenweise pflegt: `gh secret set ERLAUBTE_EMAILS -R $R < adressen.txt` und die Datei danach
löschen (nie ins Repo).

Ein Secret, das leer oder unvollständig ist, fällt erst im Workflow auf. Deshalb Werte vorher
prüfen, z. B. die Client-ID gegen die Cloud Console. Der Deploy bricht ab, bevor er etwas hochlädt,
wenn ein Secret fehlt, `DEPLOY_TOKEN` kürzer als 32 Zeichen ist, die Client-ID nicht auf
`.apps.googleusercontent.com` endet oder `ERLAUBTE_EMAILS` eine ungültige Adresse enthält.
Ausgegeben werden nur die Anzahl der Adressen, nie die Adressen oder andere Werte. Nach jedem Deploy
im Log des Schritts «Konfiguration erzeugen» die Meldung «Konfiguration erzeugt: N freigegebene
Adresse(n)» prüfen: N muss der Anzahl der Personen entsprechen.

**Person freischalten oder sperren:** `ERLAUBTE_EMAILS` neu setzen und den Deploy auslösen:
`gh workflow run hostpoint-deploy.yml -R $R --ref main`. Die API prüft die Liste bei jeder
Anfrage. Wer entfernt wurde, verliert den Zugang mit dem nächsten Request, auch mit einer laufenden
Sitzung. Im Status «Testen» bei Google zusätzlich die Testnutzer anpassen. Danach im Deploy-Log die
Anzahl freigegebener Adressen prüfen (siehe oben).

**Sitzungen:** Eine Anmeldung gilt 90 Tage ab der letzten Nutzung, höchstens aber 365 Tage. Wer ein
Gerät verloren hat, meldet sich auf einem anderen Gerät mit «Abmelden … › Auf allen Geräten
abmelden» überall ab (oder löscht in den Einstellungen die Daten auf dem Server, das beendet
ebenfalls die Sitzungen der anderen Geräte).

**Rotieren** (z. B. DB-Passwort im Control Panel geändert): Secret neu setzen, Deploy auslösen.
Der Deploy überschreibt `~/private/lernapp/config.php`.

## 4. Erster Deploy

Push auf `main` oder `gh workflow run hostpoint-deploy.yml --ref main`. Der Workflow:

1. **test:** Lektionen, Unit-Tests (Vitest), PHP-Syntax, PHP-Tests und E2E-Tests gegen
   `php -S` + MariaDB 10.11 (`scripts/test-db.sh`).
2. **apache:** `scripts/apache-test.sh` prüft `deploy/htaccess` mit echtem Apache 2.4 (mod_php und
   PHP-FPM).
3. **deploy** (nur `main`):
   - Secrets prüfen und den Build erstellen.
   - Paket zusammenstellen: Build, `.htaccess` und `api/` ohne Tests und Vorlagen.
   - `config.php` aus den Secrets erzeugen, mit `testmodus` immer `false`.
   - Vor dem Upload prüfen, ob die Website per HTTPS erreichbar ist, als Apache antwortet
     (`Server`-Header, greift schon beim ersten Deploy) und bei Folgedeploys Punktdateien sperrt.
   - FTPS-Upload mit Zertifikatsprüfung (`security: strict`): `config.php` nach
     `private/lernapp/`, das Paket nach `www/lernapp/`.
   - Migrationen über `POST /api/admin/migrieren` ausführen. Sie laufen nach dem Code-Upload,
     deshalb sind sie immer abwärtskompatibel (expand/contract, siehe `api/README.md`).
   - Live-Prüfung mit Cache-Buster. Hostpoint cached rund 60 s, deshalb wartet der Schritt bis zu
     3 Minuten auf den neuen Build. Geprüft werden:
     - Startseite, App-Route, Lektionen, Service Worker, Icons
     - `/api/status` ok, `/api/ich` → 401, `/api/test/anmelden` → 404
     - Migrationen ohne Token → 401/403, Google-Start → 302 zu `accounts.google.com`
     - Sperren für `api/lib`, `api/migrationen`, `.ftp-deploy-sync-state.json` und `.htaccess`
     - Header (HSTS, nosniff, X-Frame-Options, Referrer-Policy, frame-ancestors, Cache-Control)
     - ohne Cache-Buster: `/api` kommt nie aus dem Hostpoint-Cache (zwei Google-Starts liefern
       verschiedene `state` und Cookies, `/api/status` mit `no-store`, `/api/ich` → 401)

Die Geheimnisse liegen nie im Webroot. Liefe die Website trotzdem kurz ohne `.htaccess`, wäre nur
öffentlicher Quellcode sichtbar. Die Live-Prüfung schlägt dann fehl.

Danach von Hand: <https://lernapp.urinet.ch> öffnen, mit einer freigegebenen Google-Adresse
anmelden und mit einer nicht freigegebenen prüfen, dass «nicht freigegeben» erscheint.

## 5. Umzug von Fly.io

Die alte Version (<https://lernapp-fa.fly.dev>) speichert alles nur im Browser. Weil die neue Adresse
eine andere Herkunft hat, sieht sie diese Daten nicht.

1. Auf jedem Gerät mit Lernstand die alte Version öffnen: Einstellungen › Backup exportieren.
2. <https://lernapp.urinet.ch> öffnen, anmelden, Einstellungen › Backup importieren.
   Der Import landet im Ausgang und wird auf den Server synchronisiert. Danach ist der Stand auf
   jedem angemeldeten Gerät da. Importieren mehrere Geräte, gewinnt je Datensatz der neuere Stand
   (der Zeitstempel im Backup zählt, nicht der Zeitpunkt des Imports). Einstellungen aus einem
   Backup gelten nur, solange noch kein anderes Gerät welche auf dem Server hat.
3. Den Claude-API-Schlüssel bei Bedarf neu eintragen: Er bleibt immer nur auf dem Gerät.

## Datenbank aus einem Backup wiederherstellen

Nach jeder Wiederherstellung der Datenbank (Hostpoint-Backup) einmal im phpMyAdmin des Control
Panels ausführen (Präfix anpassen):

```sql
UPDATE lernapp_benutzer SET sync_epoche = SUBSTRING(MD5(RAND()), 1, 16);
```

Die Geräte erkennen die neue Epoche und gleichen vollständig ab: Sie laden ihre Daten, die seit dem
Backup verloren gingen, erneut hoch und holen alles neu — auch wenn der Sync-Zähler seit dem Backup
schon wieder über ihren letzten Stand gestiegen ist. (Liegt der Zähler noch darunter, merken die
Geräte das auch ohne diesen Schritt.)

## 6. Fly-App stilllegen

Erst wenn der Umzug auf allen Geräten erledigt ist:

```bash
fly scale count 0 -a lernapp-fa      # zuerst nur anhalten …
fly apps destroy lernapp-fa          # … und nach einer Weile löschen
gh secret delete FLY_API_TOKEN -R fabianAschwanden/lernapp
```

Dann `fly.toml`, `Dockerfile`, `.dockerignore` und `deploy/nginx.conf` aus dem Repo entfernen.
Der Fly-Workflow ist schon entfernt, deployt wird nur noch auf Hostpoint.

## Lokale Entwicklung

```bash
scripts/test-db.sh                                   # MariaDB 10.11 in Docker, Port 3307
cp api/config.beispiel.php api/config.lokal.php      # gitignored; DB lokal:
#   db_dsn mysql:host=127.0.0.1;port=3307;dbname=lernapp_test;charset=utf8mb4, Benutzer/Passwort lernapp
#   basis_url http://localhost:4200, testmodus true, erlaubte_emails = eigene Adresse
npx ng build
LERNAPP_CONFIG=api/config.lokal.php php -S localhost:8080 scripts/php-router.php
npm start                                            # http://localhost:4200, /api → localhost:8080
```

Für den Google-Login lokal braucht `config.lokal.php` die echte Client-ID mit dem Clientschlüssel.
Diese Datei ist gitignored und darf nie committet werden. Ohne Google meldest Du Dich im
Testmodus über `POST /api/test/anmelden` an. Das geht nur unter `php -S` und nur mit
`testmodus: true`.

Tests: `php api/tests/laufen.php` (PHP gegen die Test-DB), `scripts/apache-test.sh`
(`.htaccess` in Docker), `npx playwright test` (E2E mit `php -S` auf Port 4321).
