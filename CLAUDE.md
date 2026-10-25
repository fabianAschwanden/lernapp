# Lernapp

Lern-App für PC und Handy (installierbare PWA). Lernstoff wird als **Lektion** zusammengestellt — aus Skripten, Fotos von Buchseiten und Lernzielen — und anhand der Lernziele mit passenden Fragen geübt (Leitner-Wiederholung, Probeprüfung mit Schweizer Note, Lernzettel).

## Stack und Architektur

- **Angular 22**, standalone, zoneless, Signals, `inject()`, `ChangeDetectionStrategy.OnPush`, native Control Flow (`@if`, `@for`), strict TS. Formulare mit Signals bzw. `[value]`/`(input)` statt Reactive Forms, wo es einfach bleibt.
- **Kein Backend.** Bewusste Abweichung vom App-Blueprint (Quarkus + Angular): Die App läuft offline auf dem Gerät, Daten liegen in **IndexedDB** (`idb`). Gerätewechsel über Backup-Export/-Import.
- **KI-Erstellung** von Lektionen direkt aus dem Browser mit dem offiziellen SDK `@anthropic-ai/sdk` (`dangerouslyAllowBrowser: true`) und einem API-Schlüssel, den die Person selbst einträgt (nur lokal gespeichert). Modell-Standard `claude-opus-5-5`. Ohne Schlüssel: «Prompt kopieren» → in Claude ausführen → JSON importieren.
- **PDF-Verarbeitung** im Browser mit `pdfjs-dist` (Seiten rendern + Text extrahieren).

```
src/app/
  core/models/       lektion.model.ts (Lektion, Lernziel, Frage-Typen), fortschritt.model.ts
  core/domain/       reine Funktionen ohne Angular: antwort-pruefung, planer (Leitner),
                     note (Schweizer Skala), lektion-validierung (+ ergaenzeLektion), text (normalisieren,
                     Zahlen lesen, Mini-Markdown), id (slug, freieId), pruefhilfen (istObjekt, nichtLeer,
                     istErlaubteBildQuelle …)
  core/services/     speicher (IndexedDB), lektion, fortschritt, einstellungen, … (Signals)
  shared/            md.pipe.ts, frage/ (FrageKarte: rendert jede Frage und liefert eine Antwort)
  features/<name>/   ein Ordner pro Bildschirm (Komponente + .html + .css)
public/lektionen/    mitgelieferte Lektionen als JSON + index.json
public/bilder/       Abbildungen (SVG) für Fragen und Lernzettel
content/             Arbeitsdateien für Lektionsinhalte (Teile, die zu einer Lektion zusammengeführt werden)
e2e/                 Playwright-Tests (hilfen.ts: Test-Basis, die Konsolenfehler/fehlgeschlagene Requests
                     automatisch als Fehler wertet; fixtures/: Lektion mit je einer Frage pro Fragetyp)
material/            Unterrichtsmaterial (PDF) — gitignored, urheberrechtlich geschützt, nie committen
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
  nur `api.anthropic.com`). Deshalb ist `inlineCritical` im Produktions-Build aus (bräuchte ein
  Inline-Skript). Neue externe Quellen → CSP anpassen.
- Service Worker (`ngsw-config.json`): App-Dateien und Lektionen/Bilder werden vorgeladen, der
  pdf.js-Worker (~1.2 MB) erst bei Gebrauch. `UpdateService` zeigt «Neue Version – neu laden».

## Lektionsformat

Verbindlich ist `src/app/core/models/lektion.model.ts`; `validiereLektion()` prüft es. Jede Frage gehört zu genau einem Lernziel (`lernzielId`), hat eine `erklaerung` (warum die Lösung stimmt) und eine `schwierigkeit` 1–3. Fragetypen: `einfachwahl`, `mehrfachwahl`, `wahrfalsch`, `zuordnen` (rechts darf sich wiederholen → Kategorien), `reihenfolge`, `zahl` (mit `einheit`/`toleranz`), `kurzantwort` (`akzeptiert`, Vergleich ohne Gross-/Kleinschreibung und Sonderzeichen), `offen` (Musterlösung, Selbsteinschätzung).

Optional `kurzfassung`: die ganze Lektion zum Durchlesen (Mini-Markdown, `## <Thema>` gliedert in Abschnitte = Karten mit Sprungmarke auf der Seite `lektion/:id/kurzfassung`; heisst der Abschnitt wie das Thema der Lernziele, zeigt die Seite dort deren Lernziele mit Links zu Lernzettel und Üben; darin je Lernziel ein `### ` als Leitfrage, `> ` ergibt einen Merke-Kasten); bei mitgelieferten Lektionen aus `content/<id>/kurzfassung.md` (`scripts/lektion-bauen.mjs`).

Inhaltliche Regeln für Fragen: fachlich korrekt und am Material belegt; was nicht im Material steht, als `ergaenzt` markieren; Distraktoren plausibel, aber eindeutig falsch; keine «alle obigen»-Optionen; Rechenaufgaben ohne Taschenrechner lösbar, wenn die Prüfung keinen erlaubt.

## Befehle

```bash
npm start                          # Dev-Server (http://localhost:4200)
npx ng build                       # Produktions-Build inkl. Service Worker → dist/lernapp/browser
npx ng test --watch=false          # Unit-Tests (Vitest)
npx playwright test                # E2E gegen den Produktions-Build (npm run e2e)
```

E2E: `playwright.config.ts` baut vorher (`ng build`) und serviert `dist/lernapp/browser` mit
`scripts/statisch-servieren.mjs` auf Port 4321 (läuft dort schon ein Server, wird er lokal
wiederverwendet — nach App-Änderungen also neu bauen). Projekte: `handy` (360×740, Touch), `pc`
(1280×800), beide ohne Service Worker; `offline` erlaubt den Service Worker und prüft das Laden
ohne Netz. Tests über Rollen und Texte ansprechen, nicht über CSS-Klassen.
