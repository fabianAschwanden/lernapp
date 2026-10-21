# Lernapp

Lern-App für PC und Handy: Lernstoff aus Skripten, Fotos von Buchseiten und Lernzielen zu einer **Lektion** zusammenstellen und anhand der Lernziele üben.

- **Lernen** mit Wiederholung nach dem Leitner-Prinzip — was falsch war, kommt bald wieder; was sitzt, seltener.
- **Lernstand pro Lernziel** — man sieht, welche Lernziele schon sitzen.
- **Probeprüfung** mit Zeitlimit, Selbstkorrektur offener Fragen und Note nach Schweizer Skala (1 + 5 × Punkte / Maximum).
- **Lernzettel** pro Lernziel, druckbar.
- **Lektion erstellen** aus PDF/Fotos/Text + Lernzielen: direkt mit Claude (eigener API-Schlüssel) oder ohne Schlüssel per «Prompt kopieren» in claude.ai; dazu Import/Export und ein Editor.
- Läuft **offline** als installierbare App (PWA); alle Daten bleiben auf dem Gerät. Gerätewechsel per Backup-Datei.

Mitgeliefert: **Informatik – Prüfung 1** (FMS1A): Bauteile, Speicher, Anschlüsse, EVA-Prinzip, Bits und Bytes, Teams/Klassennotizbuch, Passwörter.

## Entwicklung

```bash
npm install
npm start                         # http://localhost:4200
npx ng build                      # Produktions-Build → dist/lernapp/browser (statisch hostbar)
npx ng test --watch=false         # Unit-Tests
npx playwright test               # E2E
node scripts/lektion-bauen.mjs --pruefen   # mitgelieferte Lektionen prüfen
```

Neue mitgelieferte Lektionen: siehe `.claude/skills/lektion-erstellen/SKILL.md`. Architektur und Konventionen: `CLAUDE.md`.

## Auf dem Handy nutzen

Der Build in `dist/lernapp/browser` ist eine statische Website und braucht HTTPS, damit sie sich als App installieren lässt (z. B. Hostpoint per GitHub Actions, Vercel, GitHub Pages). Danach im Browser öffnen → «Zum Home-Bildschirm» bzw. «App installieren».
