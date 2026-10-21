// Rendert die SVG-Abbildungen als PNG zur Sichtkontrolle und erzeugt die App-Icons.
//
//   node scripts/svg-render.mjs            alle Abbildungen + Icons
//   node scripts/svg-render.mjs hdmi vga   nur Dateien, deren Name einen der Begriffe enthält
//
// Ausgabe:
//   /tmp/lernapp-svg/<name>.png         gross (800 px breit) auf weissem Grund
//   /tmp/lernapp-svg/<name>-klein.png   klein (120 px breit), wie auf dem Handy in einer Liste
//   /tmp/lernapp-svg/_uebersicht.png    Kontaktbogen aller Abbildungen (gross + klein)
//   public/icons/icon-<n>x<n>.png       App-Icons aus public/icons/icon.svg (Grössen aus dem Manifest)
import { chromium } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Fach per Umgebungsvariable, z. B. FACH=biologie node scripts/svg-render.mjs
const bilderOrdner = join(wurzel, 'public/bilder', process.env['FACH'] ?? 'informatik');
const iconOrdner = join(wurzel, 'public/icons');
const ausgabe = '/tmp/lernapp-svg';
mkdirSync(ausgabe, { recursive: true });

const filter = process.argv.slice(2);
const passt = (name) => filter.length === 0 || filter.some((f) => name.includes(f));

const svgs = readdirSync(bilderOrdner)
  .filter((d) => d.endsWith('.svg') && passt(d))
  .sort()
  .map((d) => join(bilderOrdner, d));

const dataUrl = (pfad) => 'data:image/svg+xml;base64,' + readFileSync(pfad).toString('base64');

const browser = await chromium.launch();
const seite = await browser.newPage({ deviceScaleFactor: 1 });

async function rendere(pfad, breite, ziel, { hintergrund = '#fff', hoehe } = {}) {
  const h = hoehe ?? Math.round((breite * 3) / 4);
  await seite.setViewportSize({ width: breite, height: h });
  await seite.setContent(
    `<html><body style="margin:0;background:${hintergrund}">` +
      `<img src="${dataUrl(pfad)}" style="display:block;width:${breite}px;height:${h}px;object-fit:contain"></body></html>`,
  );
  await seite.waitForFunction(() => document.images[0]?.complete);
  await seite.screenshot({ path: ziel, omitBackground: hintergrund === 'transparent' });
}

for (const pfad of svgs) {
  const name = basename(pfad, '.svg');
  const kb = (statSync(pfad).size / 1024).toFixed(1);
  await rendere(pfad, 800, join(ausgabe, `${name}.png`));
  await rendere(pfad, 120, join(ausgabe, `${name}-klein.png`));
  console.log(`${name.padEnd(28)} ${kb.padStart(5)} kB${Number(kb) >= 15 ? '  ZU GROSS' : ''}`);
}

// Kontaktbogen
if (svgs.length) {
  const kacheln = svgs
    .map((p) => {
      const n = basename(p, '.svg');
      return `<figure style="margin:6px;display:inline-block;text-align:center;font:11px system-ui">
        <img src="${dataUrl(p)}" style="width:240px;height:180px;border:1px solid #ccc;background:#fff">
        <img src="${dataUrl(p)}" style="width:120px;height:90px;border:1px solid #ccc;background:#fff;vertical-align:top">
        <figcaption>${n}</figcaption></figure>`;
    })
    .join('');
  await seite.setViewportSize({ width: 1150, height: 400 });
  await seite.setContent(`<html><body style="margin:6px;background:#eee">${kacheln}</body></html>`);
  await seite.waitForFunction(() => [...document.images].every((i) => i.complete));
  await seite.screenshot({ path: join(ausgabe, '_uebersicht.png'), fullPage: true });
}

// App-Icons
const iconSvg = join(iconOrdner, 'icon.svg');
if (passt('icon')) {
  const manifest = JSON.parse(readFileSync(join(wurzel, 'public/manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) {
    const n = Number(icon.sizes.split('x')[0]);
    await rendere(iconSvg, n, join(wurzel, 'public', icon.src), { hoehe: n, hintergrund: 'transparent' });
  }
  await rendere(iconSvg, 512, join(ausgabe, 'icon.png'), { hoehe: 512, hintergrund: '#fff' });
  // Maskable-Vorschau: Kreis-Maske (innerer Sicherheitsbereich 80 %)
  await seite.setViewportSize({ width: 256, height: 256 });
  await seite.setContent(
    `<html><body style="margin:0;background:#fff"><img src="${dataUrl(iconSvg)}" style="width:256px;height:256px;clip-path:circle(40%)"></body></html>`,
  );
  await seite.waitForFunction(() => document.images[0]?.complete);
  await seite.screenshot({ path: join(ausgabe, 'icon-maskable.png') });
  console.log('Icons: ' + manifest.icons.map((i) => i.src).join(', '));
}

await browser.close();
