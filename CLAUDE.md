# Lernapp

Lern-App für PC und Handy (installierbare PWA). Lernstoff wird als **Lektion** zusammengestellt — aus Skripten, Fotos von Buchseiten und Lernzielen — und anhand der Lernziele mit passenden Fragen geübt (Leitner-Wiederholung, Probeprüfung mit Schweizer Note, Lernzettel).

## Stack und Architektur

- **Angular 22**, standalone, zoneless, Signals, `inject()`, `ChangeDetectionStrategy.OnPush`, native Control Flow (`@if`, `@for`), strict TS. Formulare mit Signals bzw. `[value]`/`(input)` statt Reactive Forms, wo es einfach bleibt.
- **Daten lokal zuerst, Server zum Synchronisieren:** Die App arbeitet auf **IndexedDB** (`idb`) und läuft offline; eine kleine **PHP-API** (`api/`, PHP ≥ 8.3, ohne Composer) mit **MariaDB 10.11** speichert die Daten pro Person und synchronisiert Geräte (Last-write-wins nach `geaendertAm`, Grabsteine für Löschungen). **Login mit Google ist Pflicht**, nur Adressen aus der Freigabeliste (`erlaubte_emails` in der Server-Konfiguration, bei jeder Anfrage geprüft). Offline-Nutzung nach früherer Anmeldung auf dem Gerät bleibt möglich.
- **Abweichung vom App-Blueprint** (Quarkus + Angular, Fly.io): Betrieb auf Hostpoint-Shared-Hosting (kein Node, kein Java, kein Composer; die MariaDB ist nur aus Hostpoint-Webprozessen erreichbar, nicht aus CI oder SSH). Deshalb PHP statt Quarkus, Angular-Build statisch und API unter `/api` auf derselben Domain (keine CORS), Schema-Änderungen über einen token-geschützten Migrations-Endpunkt statt direktem DB-Zugriff.
- **KI-Erstellung** von Lektionen direkt aus dem Browser mit dem offiziellen SDK `@anthropic-ai/sdk` (`dangerouslyAllowBrowser: true`) und einem API-Schlüssel, den die Person selbst einträgt (nur lokal gespeichert). Modell-Standard `claude-opus-5-5`. Ohne Schlüssel: «Prompt kopieren» → in Claude ausführen → JSON importieren.
- **PDF-Verarbeitung** im Browser mit `pdfjs-dist` (Seiten rendern + Text extrahieren).

```
src/app/
  core/models/       lektion.model.ts (Lektion, Lernziel, Frage-Typen), fortschritt.model.ts
  core/domain/       reine Funktionen ohne Angular: antwort-pruefung, planer (Leitner),
                     note (Schweizer Skala), lektion-validierung (+ ergaenzeLektion), text (normalisieren,
                     Zahlen lesen, Mini-Markdown), id (slug, freieId), pruefhilfen (istObjekt, nichtLeer,
                     istErlaubteBildQuelle …), rueckmeldung (Profil pro Fach, Stil, profilAlsText)
  core/services/     speicher (IndexedDB), lektion, fortschritt, einstellungen, … (Signals)
  shared/            md.pipe.ts, frage/ (FrageKarte: rendert jede Frage und liefert eine Antwort)
  features/<name>/   ein Ordner pro Bildschirm (Komponente + .html + .css)
api/                 PHP-API: index.php (einziger Einstieg, Router), lib/ (Konfiguration, DB, Sitzung, Google,
                     Sync, Migrationen), migrationen/NNN-*.sql (Tabellen mit Präfix, Standard lernapp_),
                     tests/ (eigener Testläufer laufen.php), config.beispiel.php (Vorlage, nie echte Werte)
deploy/htaccess      Apache-Regeln für den Webroot (HTTPS, /api → api/index.php, SPA-Fallback, Sperren,
                     Header, Caching); geprüft mit scripts/apache-test.sh
docs/                einrichtung-hostpoint.md: Website, Google-OAuth-Client, Secrets, Umzug von Fly.io
scripts/             lektion-bauen.mjs, php-router.php (php -S wie Apache), test-db.sh (MariaDB in Docker),
                     apache-test.sh (.htaccess in Docker)
public/lektionen/    mitgelieferte Lektionen als JSON + index.json
public/bilder/       Abbildungen (SVG) für Fragen und Lernzettel
content/             Arbeitsdateien für Lektionsinhalte (Teile, die zu einer Lektion zusammengeführt werden)
e2e/                 Playwright-Tests (hilfen.ts: Test-Basis, die Konsolenfehler/fehlgeschlagene Requests
                     automatisch als Fehler wertet; fixtures/: Lektion mit je einer Frage pro Fragetyp)
material/            Unterrichtsmaterial (PDF) — gitignored, urheberrechtlich geschützt, nie committen
rueckmeldungen/      Export der Rückmeldungen nach Prüfungen pro Fach — gitignored, persönliche Daten
```

## Konventionen

- **Sprache:** Deutsch, Schweizer Hochdeutsch **ohne ß** (immer «ss»), Anrede **Du**. ASCII-Transliteration (ae/oe/ue) nur in Identifiern und Dateinamen, in Texten echte Umlaute.
- Bezeichner deutsch (wie im bestehenden Code: `lektion`, `frage`, `lernziel`, `fortschritt`, `verbuche`, …).
- Keine eigenen Farbwerte in Komponenten: nur die CSS-Variablen und Klassen aus `src/styles.css` (`.seite`, `.karte`, `.knopf.primaer`, `.chip`, `.balken`, `.option`, `.hinweis`, `.feld`, `.eingabe`, `.md`, `.abbildung` …). Komponenten-CSS bleibt klein (Budget 4 kB Warnung / 8 kB Fehler pro Komponente).
- Mobile first: alles muss ab 360 px Breite ohne horizontales Scrollen funktionieren; Touch-Ziele ≥ 44 px.
- Barrierefreiheit: echte `<button>`/`<a>`, Labels für Eingaben, sichtbarer Fokus, `aria-live` für Rückmeldungen.
- Lernzettel-, Kurzfassungs- und Fragetexte sind **Mini-Markdown** (siehe `core/domain/text.ts`, inkl. `> ` Merke-Kasten) und werden mit `[innerHTML]="text | md"` in einem Element mit Klasse `md` gerendert.
- Route- und Query-Parameter kommen per `input()` (Router mit `withComponentInputBinding`).
- Fixer App-Kopf und untere Handy-Navigation: Höhen stehen als `--kopf-hoehe`/`--nav-unten-hoehe` in
  `styles.css`; `html` hat passendes `scroll-padding`. Sticky Elemente nutzen `top: var(--kopf-hoehe)`.
- Bildschirme mit ungesicherten Eingaben (Probeprüfung, Editor, «Neue Lektion») haben einen
  `canDeactivate`-Guard in `app.routes.ts` plus `beforeunload`-Handler.
- Bilder in Lektionen: nur `bilder/…` (App) oder `data:image/(png|jpeg|webp|gif);base64,…` —
  `validiereLektion()` lehnt fremde Adressen ab (Tracking, offline nicht verfügbar).
- Sicherheit: `src/index.html` setzt eine Content-Security-Policy (nur eigene Skripte, `connect-src`
  nur `'self'` und `api.anthropic.com`). Deshalb ist `inlineCritical` im Produktions-Build aus (bräuchte ein
  Inline-Skript). Neue externe Quellen → CSP anpassen. Weitere Header (HSTS, `frame-ancestors`,
  nosniff, Referrer-Policy) setzt `deploy/htaccess`.
- Secrets: Das Repo ist öffentlich. Keine Passwörter, Tokens, Client-Secrets oder echten
  E-Mail-Adressen in Dateien; eingecheckt werden nur Vorlagen (`api/config.beispiel.php`), Test-
  adressen nur `@example.com`. Produktionswerte gibt es nur als GitHub-Secrets; der Deploy erzeugt daraus
  `~/private/lernapp/config.php` ausserhalb des Webroots.
- Cookies der API mit `__Host-`-Präfix (Sitzung, Login-Zustand; nur im Testmodus über http ohne).
  Login-Zustand im signierten Cookie, nicht in der DB. Sync-Datensätze tragen das Konto des Tabs
  (`X-Lernapp-Konto`, 409 `anderes-konto`); gerätebezogene Einstellungen (API-Schlüssel, Konto-Marker,
  Farbschema) gehen nie zum Server und werden auch nie vom Server gesetzt oder gelöscht.
- Sync-Zeitstempel lokaler Änderungen liegen immer nach dem bekannten Stand des Datensatzes
  (`naechsterStempel`), Backup-Importe behalten den Stand des Inhalts. Erste Anmeldung auf einem Gerät:
  App erst nach dem ersten Abgleich frei. Abgelaufene Sitzung: App bleibt lokal nutzbar (Hinweis im Kopf).
- Service Worker (`ngsw-config.json`): App-Dateien und Lektionen/Bilder werden vorgeladen, der
  pdf.js-Worker (~1.2 MB) erst bei Gebrauch. `UpdateService` zeigt «Neue Version – neu laden».
  `navigationUrls` schliesst `/api/**` aus, sonst landet der Google-Login (`/api/auth/google/…`)
  im index.html des Service Workers.

## Lektionsformat

Verbindlich ist `src/app/core/models/lektion.model.ts`; `validiereLektion()` prüft es. Jede Frage gehört zu genau einem Lernziel (`lernzielId`), hat eine `erklaerung` (warum die Lösung stimmt) und eine `schwierigkeit` 1–3. Fragetypen: `einfachwahl`, `mehrfachwahl`, `wahrfalsch`, `zuordnen` (rechts darf sich wiederholen → Kategorien), `reihenfolge`, `zahl` (mit `einheit`/`toleranz`), `kurzantwort` (`akzeptiert`, Vergleich ohne Gross-/Kleinschreibung und Sonderzeichen), `offen` (Musterlösung, Selbsteinschätzung).

Optional `kurzfassung`: die ganze Lektion zum Durchlesen (Mini-Markdown, `## <Thema>` gliedert in Abschnitte = Karten mit Sprungmarke auf der Seite `lektion/:id/kurzfassung`; heisst der Abschnitt wie das Thema der Lernziele, zeigt die Seite dort deren Lernziele mit Links zu Lernzettel und Üben; darin je Lernziel ein `### ` als Leitfrage, `> ` ergibt einen Merke-Kasten); bei mitgelieferten Lektionen aus `content/<id>/kurzfassung.md` (`scripts/lektion-bauen.mjs`).

Inhaltliche Regeln für Fragen: fachlich korrekt und am Material belegt; was nicht im Material steht, als `ergaenzt` markieren; Distraktoren plausibel, aber eindeutig falsch; keine «alle obigen»-Optionen; Rechenaufgaben ohne Taschenrechner lösbar, wenn die Prüfung keinen erlaubt.

## Rückmeldungen nach Prüfungen

Nach der echten Prüfung erfasst die Person pro Lektion eine Rückmeldung (`PruefungsRueckmeldung` in
`core/models/rueckmeldung.model.ts`, Store `rueckmeldungen`, im Backup): wie gut Lernziele und Stoff
passten, welche Lernziele drankamen, Schwierigkeit im Vergleich zur App, Aufgabenarten, Beispielfragen,
Tipps. **Fach = Lehrperson:** `lehrpersonProfile()` fasst alle Rückmeldungen eines Fachs zu einem Profil
zusammen. Es wirkt auf die Probeprüfung (`pruefungsStil()` → `waehlePruefung(…, stil)`) und auf die
Erstellung neuer Lektionen: `profilAlsText()` geht als Abschnitt «Stil der Lehrperson» in den KI-Auftrag
(`KiAuftrag.stilLehrperson`, API-Weg und Kopier-Prompt) und lässt sich auf der Seite `rueckmeldungen`
kopieren oder herunterladen. Lektionen haben dazu optional `lehrperson` (nur Anzeige).

- **Keine Vorbelegung:** Passung, Stoff und Schwierigkeit sind optional; ohne Antwort zählen sie
  nicht ins Profil (`schwierigkeitMittel`/`lernzielePassendMittel` dann `null`). Die Schwierigkeit
  wird nach Aktualität gewichtet (neueste Prüfung zählt am meisten).
- **Datenschutz:** `profilAlsText()` enthält keine Noten und den Namen der Lehrperson nur mit
  `{ mitLehrperson: true }` (Datei-Export) — nie im KI-Auftrag; Beispielfragen und Tipps gehen mit
  (UI-Texte sagen das). Mitgelieferte Lektionen bekommen keine `lehrperson` (öffentliches Repo,
  `lektion-bauen.mjs` meldet sonst einen Fehler); Exporte für den Skill `lektion-erstellen` liegen
  in `rueckmeldungen/` als `<fach>.json`, `rueckmeldungen-<fach>.json` oder `<fach>.md`
  (gitignored), `lektion-bauen.mjs` zeigt dann Kennzahlen zum Abgleich.
- Eine Rückmeldung gehört zur Lektion-id (`rm-<id>`): `LektionService.freieId()` zählt die ids
  verwaister Rückmeldungen als belegt; ein geändertes Fach zieht `RueckmeldungService.fachNachziehen()` nach.

## Betrieb

Hostpoint, Website `lernapp.urinet.ch` («Apache mit PHP»), Webroot `www/lernapp.urinet.ch/`, Konfiguration
`~/private/lernapp/config.php`. Deploy nur über GitHub Actions (`.github/workflows/hostpoint-deploy.yml`):
Jobs `test` (Lektionen, Vitest, `php -l`, PHP-Tests, E2E mit PHP + MariaDB), `apache`
(`scripts/apache-test.sh`) und `deploy` (nur `main`: Secrets prüfen, Build, `config.php` aus Secrets mit
`testmodus` false, Vorab-Prüfung «Apache», FTPS-Upload mit `security: strict` (Zertifikatsprüfung),
`POST /api/admin/migrieren` mit `DEPLOY_TOKEN`, Live-Prüfung inkl. «/api nicht gecacht»).
Migrationen laufen nach dem Code-Upload, deshalb nur abwärtskompatibel (expand/contract, siehe
`api/README.md` «Migrationen»). Fehlt ein Secret, wird nicht deployt. Einrichtung und Umzug: `docs/einrichtung-hostpoint.md`. Die
Fly-App `lernapp-fa` (fly.toml, Dockerfile, deploy/nginx.conf) bleibt bis nach dem Umzug stehen, wird
aber nicht mehr deployt.

## Befehle

```bash
npm start                          # Dev-Server (http://localhost:4200, /api → localhost:8080 per proxy.conf.json)
npx ng build                       # Produktions-Build inkl. Service Worker → dist/lernapp/browser
npx ng test --watch=false          # Unit-Tests (Vitest)
npx playwright test                # E2E gegen Build + PHP + MariaDB (npm run e2e)
scripts/test-db.sh                 # MariaDB 10.11 in Docker (lernapp-test-db, Port 3307)
php api/tests/laufen.php           # PHP-Tests (gegen die Test-DB)
scripts/apache-test.sh             # deploy/htaccess mit Apache 2.4 in Docker (mod_php und PHP-FPM)
LERNAPP_CONFIG=api/config.lokal.php php -S localhost:8080 scripts/php-router.php   # API lokal
```

E2E: `playwright.config.ts` baut vorher (`ng build`) und startet `php -S 127.0.0.1:4321
scripts/php-router.php` mit `LERNAPP_CONFIG=e2e/config.e2e.php` (Testmodus, Tabellenpräfix `e2e_`;
läuft dort schon ein Server, wird er lokal wiederverwendet — nach App-Änderungen also neu bauen bzw.
`lsof -ti :4321 | xargs kill`). `e2e/global-setup.ts` startet die MariaDB (`scripts/test-db.sh`, ausser
`LERNAPP_TEST_DB_DSN` ist gesetzt wie in CI), löscht die Tabellen `e2e_*` und migriert über
`POST /api/admin/migrieren`. Die Test-Basis in `e2e/hilfen.ts` meldet jeden Test als eigene Person
über `POST /api/test/anmelden` an (nur unter `php -S` und mit `testmodus` true); die Allowlist ist im
Test ein Verzeichnis mit einer Datei pro Adresse (`freigeben()`/`freigabeEntziehen()`). Ohne
Anmeldung: `test.use({ anmelden: false })`; erwartete HTTP-Fehler in `beobachtung.erlaubt`. Projekte:
`handy` (360×740, Touch), `pc` (1280×800), beide ohne Service Worker; `offline` erlaubt den Service
Worker und prüft das Laden ohne Netz. Tests über Rollen und Texte ansprechen, nicht über CSS-Klassen.
