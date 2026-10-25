#!/usr/bin/env node
/**
 * Führt die Inhaltsteile einer Lektion zusammen und prüft sie.
 *
 *   node scripts/lektion-bauen.mjs content/informatik-pruefung-1   # Kopf + Teile → public/lektionen/<id>.json
 *   node scripts/lektion-bauen.mjs --pruefen [datei.json …]         # nur prüfen (Standard: alle in public/lektionen)
 *   node scripts/lektion-bauen.mjs --pruefen-teil content/…/teile/x.json  # einen Teil gegen den Kopf prüfen
 *
 * Ordneraufbau eines Lektionsprojekts:
 *   kopf.json          Lektion ohne Fragen; Lernziele mit id/thema/text (Zusammenfassung darf leer sein)
 *   teile/*.json       { "lernziele": [ { "id", "zusammenfassung", "merksaetze"?, "bilder"? } ], "fragen": [ … ] }
 *   kurzfassung.md     optional: Kurzfassung der ganzen Lektion (Mini-Markdown, `## Abschnitt`)
 *
 * Die Validierung nutzt dieselbe Funktion wie die App (validiereLektion), dazu
 * Qualitätswarnungen (ß, fehlende Bilder, Antwortverteilung, doppelte Fragen,
 * Arbeitsnotizen wie «bitte … abgleichen», Erklärungen mit «Richtig.»/«Falsch.»).
 *
 * Liegen Rückmeldungen früherer Prüfungen des Fachs unter rueckmeldungen/<fach>.json,
 * rueckmeldungen/rueckmeldungen-<fach>.json (Download-Name aus der App) oder
 * rueckmeldungen/<fach>.md (gitignored), nennt das Skript die Datei und Kennzahlen
 * der Lektion zum Abgleich (Anteil Schwierigkeit 3, Anteil offener Fragen).
 *
 * Fehler, wenn `lehrperson` gesetzt ist: Mitgelieferte Lektionen landen im
 * öffentlichen Repo. Den Namen selbst aus content/<id>/kopf.json löschen.
 */
import { build } from 'esbuild';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function ladeValidator() {
  const out = join(mkdtempSync(join(tmpdir(), 'lernapp-')), 'validierung.mjs');
  await build({
    entryPoints: [join(wurzel, 'src/app/core/domain/lektion-validierung.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: out,
    logLevel: 'silent',
  });
  return (await import(pathToFileURL(out).href)).validiereLektion;
}

const lies = (p) => JSON.parse(readFileSync(p, 'utf8'));

function qualitaet(l) {
  const w = [];
  const text = JSON.stringify(l);
  if (text.includes('ß')) w.push('Enthält «ß» — in der Schweiz «ss» schreiben.');
  for (const m of text.matchAll(/"src":\s*"([^"]+)"/g)) {
    const src = m[1];
    if (!src.startsWith('data:') && !existsSync(join(wurzel, 'public', src))) w.push(`Bild fehlt: public/${src}`);
  }
  if (!l.kurzfassung?.trim()) w.push('Keine Kurzfassung (content/<id>/kurzfassung.md).');
  else if (!/^## /m.test(l.kurzfassung)) w.push('Kurzfassung ohne «## Abschnitte».');
  else {
    // Bezug auf die Lernziele: «## <Thema>» je Thema, darin ein «### » je Lernziel
    const abschnitte = new Map(
      l.kurzfassung.split(/^## /m).slice(1).map((a) => [a.split('\n')[0].trim(), a]),
    );
    for (const thema of new Set(l.lernziele.map((lz) => lz.thema))) {
      const a = abschnitte.get(thema);
      const n = l.lernziele.filter((lz) => lz.thema === thema).length;
      if (!a) w.push(`Kurzfassung: kein Abschnitt «## ${thema}» (Titel = Thema der Lernziele).`);
      else if ((a.match(/^### /gm) ?? []).length !== n)
        w.push(`Kurzfassung «${thema}»: ${n} Lernziele, aber ${(a.match(/^### /gm) ?? []).length} «### »-Zwischentitel.`);
    }
  }
  const proLz = new Map();
  for (const f of l.fragen) proLz.set(f.lernzielId, (proLz.get(f.lernzielId) ?? 0) + 1);
  for (const lz of l.lernziele) {
    const n = proLz.get(lz.id) ?? 0;
    if (n < 6) w.push(`Lernziel ${lz.id}: nur ${n} Fragen (mind. 6 empfohlen).`);
    if (!lz.zusammenfassung?.trim()) w.push(`Lernziel ${lz.id}: Lernzettel (zusammenfassung) leer.`);
    // Arbeitsnotizen für die Autorin/den Autor gehören nicht in den Lernzettel
    const zettel = [lz.zusammenfassung ?? '', ...(lz.merksaetze ?? [])].join('\n');
    if (/abgleichen|\bTODO\b/i.test(zettel))
      w.push(`Lernziel ${lz.id}: Arbeitsnotiz im Lernzettel («abgleichen»/TODO) — für Lernende nicht umsetzbar.`);
  }
  for (const f of l.fragen) {
    // Die App zeigt schon «✓ Richtig!»/«✗ Leider falsch» — «Richtig.» am Anfang der Erklärung doppelt bzw. widerspricht
    if (/^\s*(?:Richtig|Falsch)\s*[.!]/.test(f.erklaerung ?? ''))
      w.push(`Frage ${f.id}: Erklärung beginnt mit «Richtig.»/«Falsch.» — direkt mit der Begründung beginnen.`);
  }
  const ew = l.fragen.filter((f) => f.typ === 'einfachwahl');
  if (ew.length >= 8) {
    const verteilung = {};
    for (const f of ew) verteilung[f.richtig] = (verteilung[f.richtig] ?? 0) + 1;
    const max = Math.max(...Object.values(verteilung));
    if (max / ew.length > 0.45) w.push(`Einfachwahl: richtige Antwort zu oft an derselben Position ${JSON.stringify(verteilung)}.`);
    const laengste = ew.filter((f) => {
      const len = f.optionen.map((o) => o.length);
      return len[f.richtig] === Math.max(...len) && len.filter((x) => x === Math.max(...len)).length === 1;
    }).length;
    if (laengste / ew.length > 0.5) w.push(`Einfachwahl: richtige Option ist in ${laengste}/${ew.length} Fragen die längste — verrät die Lösung.`);
  }
  const gesehen = new Map();
  for (const f of l.fragen) {
    const k = f.frage.toLowerCase().replace(/\s+/g, ' ').trim();
    if (gesehen.has(k)) w.push(`Fragetext doppelt: ${gesehen.get(k)} und ${f.id}.`);
    gesehen.set(k, f.id);
  }
  return w;
}

const slug = (s) =>
  s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Hinweis auf Rückmeldungen früherer Prüfungen im selben Fach (falls lokal vorhanden). */
function stilHinweis(l) {
  const s = slug(l.fach ?? '');
  const ordner = join(wurzel, 'rueckmeldungen');
  const dateien = [`${s}.json`, `rueckmeldungen-${s}.json`, `${s}.md`]
    .map((n) => join(ordner, n))
    .filter(existsSync);
  if (!dateien.length || !l.fragen?.length) return;
  const anteil = (f) => `${Math.round((l.fragen.filter(f).length / l.fragen.length) * 100)} %`;
  console.log(`  STIL    Rückmeldungen früherer Prüfungen: ${dateien.map((d) => d.slice(wurzel.length + 1)).join(', ')}`);
  console.log(`          Lektion: Schwierigkeit 3 ${anteil((f) => f.schwierigkeit === 3)}, offene Fragen ${anteil((f) => f.typ === 'offen')}, Rechnen ${anteil((f) => f.typ === 'zahl')}`);
  const json = dateien.find((d) => d.endsWith('.json'));
  if (!json) return;
  try {
    const d = lies(json);
    const rs = (Array.isArray(d) ? d : d.rueckmeldungen ?? []).filter((r) => typeof r?.schwierigkeit === 'number');
    if (rs.length) {
      const m = rs.reduce((s, r) => s + r.schwierigkeit, 0) / rs.length;
      console.log(`          Prüfungen: ${rs.length}, Schwierigkeit gegenüber der App im Mittel ${m > 0 ? '+' : ''}${m.toFixed(1)} (−2 … +2)`);
    }
  } catch {
    console.log(`          ${json} ist kein gültiges JSON.`);
  }
}

/** Datenschutz: mitgelieferte Lektionen ohne Namen der Lehrperson (öffentliches Repo). */
function datenschutzFehler(l) {
  return typeof l.lehrperson === 'string' && l.lehrperson.trim()
    ? ['lehrperson gesetzt: Mitgelieferte Lektionen ohne Lehrperson (öffentliches Repo) – Feld in kopf.json löschen']
    : [];
}

function zusammenfuehren(ordner) {
  const kopf = lies(join(ordner, 'kopf.json'));
  const lernziele = kopf.lernziele.map((lz) => ({ ...lz }));
  const fragen = [];
  const teileOrdner = join(ordner, 'teile');
  for (const datei of readdirSync(teileOrdner).filter((d) => d.endsWith('.json')).sort()) {
    const teil = lies(join(teileOrdner, datei));
    for (const lzTeil of teil.lernziele ?? []) {
      const lz = lernziele.find((x) => x.id === lzTeil.id);
      if (!lz) throw new Error(`${datei}: unbekanntes Lernziel ${lzTeil.id}`);
      Object.assign(lz, lzTeil, { id: lz.id, thema: lz.thema, text: lz.text });
    }
    fragen.push(...(teil.fragen ?? []));
  }
  // Fragen in der Reihenfolge der Lernziele
  const rang = new Map(lernziele.map((lz, i) => [lz.id, i]));
  fragen.sort((a, b) => (rang.get(a.lernzielId) ?? 99) - (rang.get(b.lernzielId) ?? 99));
  // Kurzfassung der ganzen Lektion liegt als eigene Markdown-Datei daneben
  const kurzfassungPfad = join(ordner, 'kurzfassung.md');
  const kurzfassung = existsSync(kurzfassungPfad) ? readFileSync(kurzfassungPfad, 'utf8').trim() : kopf.kurzfassung;
  return { ...kopf, ...(kurzfassung ? { kurzfassung } : {}), lernziele, fragen };
}

function bericht(name, fehler, warnungen) {
  console.log(`\n== ${name}`);
  for (const f of fehler) console.log(`  FEHLER  ${f}`);
  for (const w of warnungen) console.log(`  WARNUNG ${w}`);
  if (!fehler.length && !warnungen.length) console.log('  ok');
}

const validiere = await ladeValidator();
const args = process.argv.slice(2);
let fehlerGesamt = 0;

if (args[0] === '--pruefen') {
  const dateien = args.length > 1 ? args.slice(1) : readdirSync(join(wurzel, 'public/lektionen'))
    .filter((d) => d.endsWith('.json') && d !== 'index.json')
    .map((d) => join(wurzel, 'public/lektionen', d));
  for (const d of dateien) {
    const l = lies(d);
    const fehler = validiere(l);
    fehler.push(...datenschutzFehler(l));
    fehlerGesamt += fehler.length;
    bericht(d, fehler, fehler.length ? [] : qualitaet(l));
    stilHinweis(l);
  }
} else if (args[0] === '--pruefen-teil') {
  const teilPfad = resolve(args[1]);
  const ordner = resolve(dirname(teilPfad), '..');
  const kopf = lies(join(ordner, 'kopf.json'));
  const teil = lies(teilPfad);
  const ids = new Set((teil.lernziele ?? []).map((x) => x.id));
  const l = {
    ...kopf,
    lernziele: kopf.lernziele.filter((lz) => ids.has(lz.id)).map((lz) => ({ ...lz, ...teil.lernziele.find((x) => x.id === lz.id) })),
    fragen: teil.fragen ?? [],
  };
  const fehler = validiere(l);
  fehler.push(...datenschutzFehler(l));
  fehlerGesamt += fehler.length;
  bericht(teilPfad, fehler, fehler.length ? [] : qualitaet(l));
} else if (args[0]) {
  const ordner = resolve(args[0]);
  const l = zusammenfuehren(ordner);
  const fehler = validiere(l);
  fehler.push(...datenschutzFehler(l));
  fehlerGesamt += fehler.length;
  const ziel = join(wurzel, 'public/lektionen', `${l.id}.json`);
  bericht(ziel, fehler, fehler.length ? [] : qualitaet(l));
  stilHinweis(l);
  if (!fehler.length) {
    writeFileSync(ziel, JSON.stringify(l, null, 2) + '\n');
    const indexPfad = join(wurzel, 'public/lektionen/index.json');
    const index = existsSync(indexPfad) ? lies(indexPfad) : { lektionen: [] };
    if (!index.lektionen.includes(`${l.id}.json`)) index.lektionen.push(`${l.id}.json`);
    writeFileSync(indexPfad, JSON.stringify(index, null, 2) + '\n');
    console.log(`\n${l.fragen.length} Fragen, ${l.lernziele.length} Lernziele → ${ziel}`);
  }
} else {
  console.log('Aufruf: node scripts/lektion-bauen.mjs <lektionsordner> | --pruefen [dateien] | --pruefen-teil <teil.json>');
  process.exit(2);
}
process.exit(fehlerGesamt ? 1 : 0);
