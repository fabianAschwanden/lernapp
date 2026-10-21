#!/usr/bin/env node
// Kleiner statischer Server für den Produktions-Build (E2E-Tests, lokale Vorschau).
// SPA-Fallback: unbekannte Pfade ohne Dateiendung liefern index.html.
//
//   node scripts/statisch-servieren.mjs [verzeichnis] [port]
//   Standard: dist/lernapp/browser auf Port 4321 (oder PORT)

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

const wurzel = resolve(process.argv[2] ?? 'dist/lernapp/browser');
const port = Number(process.argv[3] ?? process.env.PORT ?? 4321);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
};

async function datei(pfad) {
  try {
    const s = await stat(pfad);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  let pfad;
  try {
    pfad = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  // Pfad innerhalb der Wurzel halten (kein ../)
  let ziel = normalize(join(wurzel, pfad));
  if (ziel !== wurzel && !ziel.startsWith(wurzel + sep)) {
    res.writeHead(403).end();
    return;
  }
  if (pfad.endsWith('/')) ziel = join(ziel, 'index.html');

  let info = await datei(ziel);
  if (!info && !extname(pfad)) {
    // SPA-Route → index.html
    ziel = join(wurzel, 'index.html');
    info = await datei(ziel);
  }
  if (!info) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Nicht gefunden');
    return;
  }

  const typ = MIME[extname(ziel).toLowerCase()] ?? 'application/octet-stream';
  const istIndex = ziel.endsWith(`${sep}index.html`) || ziel.endsWith('ngsw.json');
  res.writeHead(200, {
    'Content-Type': typ,
    'Content-Length': info.size,
    'Cache-Control': istIndex ? 'no-cache' : 'public, max-age=3600',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(ziel).pipe(res);
});

server.listen(port, () => {
  console.log(`Lernapp: ${wurzel} auf http://localhost:${port}`);
});
