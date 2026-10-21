---
name: lektion-erstellen
description: Erstellt aus Unterrichtsmaterial (Skript-PDF, Fotos von Buchseiten, Lernziel-Blatt) eine neue mitgelieferte Lektion für die Lernapp — Lernzettel und geprüfte Fragen pro Lernziel. Verwenden, wenn neues Lernmaterial für eine Prüfung vorliegt («mach eine Lektion daraus», «neue Prüfung in Mathe», «Lernziele P2»).
---

# Lektion aus Material erstellen

Ergebnis ist eine Datei `public/lektionen/<id>.json` im Format von `src/app/core/models/lektion.model.ts`, eingetragen in `public/lektionen/index.json`.

## Ablauf

1. **Material ablegen:** PDFs und Fotos nach `material/<fach>/` (gitignored — Unterrichtsmaterial nie committen).
2. **Material lesen:** PDFs mit dem Read-Tool seitenweise (`pages`) als Bild lesen — handschriftliche Notizen der Lehrperson sind Hinweise auf Prüfungsschwerpunkte. Gedruckte Seitenzahlen ≠ PDF-Seiten: Zuordnung einmal bestimmen und notieren.
3. **Kopf anlegen:** `content/<id>/kopf.json` nach dem Vorbild `content/informatik-pruefung-1/kopf.json` — Lernziele möglichst wörtlich, je mit `id` (`lz-…`), `thema`, `quellenhinweis`, `ergaenzt: true` wenn der Stoff nicht im Material steht. Prüfungshinweise (Hilfsmittel, Taschenrechner) in `hinweise`.
4. **Teile erstellen:** pro Themengruppe `content/<id>/teile/<x>.json` mit Lernzetteln (`zusammenfassung` in Mini-Markdown, `merksaetze`, `bilder`) und Fragen (14–20 pro Lernziel, Typen gemischt, je mind. 2 offene). Regeln in `CLAUDE.md` → «Lektionsformat». Bei mehreren Gruppen parallel arbeiten (Workflow/Agenten) und jede Gruppe von zwei unabhängigen Prüfern (fachlich, didaktisch) gegenlesen lassen.
5. **Teil prüfen:** `node scripts/lektion-bauen.mjs --pruefen-teil content/<id>/teile/<x>.json`
6. **Zusammenführen:** `node scripts/lektion-bauen.mjs content/<id>` → schreibt `public/lektionen/<id>.json` und den Index.
7. **Testen:** `npm start`, Lektion öffnen, Lernzettel und eine Lernrunde durchklicken.

Abbildungen (SVG) gehören nach `public/bilder/<fach>/`; Erkennungsbilder ohne Beschriftung, `alt` neutral.
