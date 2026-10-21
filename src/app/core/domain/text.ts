/**
 * Textwerkzeuge: Vergleich von Kurzantworten, Zahlen-Parsing und ein kleines,
 * sicheres Markdown für Lernzettel und Fragetexte.
 */

/**
 * Normalisiert eine Kurzantwort für den Vergleich: klein, Umlaute als ae/oe/ue,
 * ß als ss und alles ausser Buchstaben und Ziffern entfernt.
 * «USB-C», «usb c» und «USBC» werden so gleich.
 */
export function normalisiereText(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Liest eine Zahl aus einer Eingabe wie «3,125», «1'000'000», «1 000 000»,
 * «1.000.000», «1,000,000», «2^10» oder «375 MB». Ein einzelnes Komma oder ein
 * einzelner Punkt gilt als Dezimaltrennzeichen. Mehrere gleiche Trennzeichen
 * (oder Punkt und Komma gemischt) gelten als Tausendertrennzeichen, wenn sie
 * Dreiergruppen trennen. Gibt null zurück, wenn keine Zahl erkennbar ist.
 */
export function parseZahl(eingabe: string): number | null {
  let s = eingabe.trim();
  if (!s) return null;

  // Potenz wie 2^10 oder 2**10
  const potenz = s.match(/^(-?\d+(?:[.,]\d+)?)\s*(?:\^|\*\*)\s*(-?\d+)/);
  if (potenz) {
    const basis = Number(potenz[1].replace(',', '.'));
    const exp = Number(potenz[2]);
    const wert = Math.pow(basis, exp);
    return Number.isFinite(wert) ? wert : null;
  }

  // Tausendertrennzeichen (Apostroph, Leerzeichen, schmale Leerzeichen) entfernen
  s = s.replace(/['’\u00a0\u202f\u2009 ]/g, '');
  const m = s.match(/^-?\d[\d.,]*/);
  if (!m) return null;
  const zahl = ohneTausenderpunkte(m[0].replace(/[.,]+$/, ''));
  if (zahl === null) return null;
  const wert = Number(zahl);
  return Number.isFinite(wert) ? wert : null;
}

/**
 * «1.000.000» → «1000000», «1,000.5» → «1000.5», «3,125» → «3.125».
 * null, wenn die Trennzeichen keinen Sinn ergeben (z. B. «1.2.3»).
 */
function ohneTausenderpunkte(t: string): string | null {
  const trenner = t.match(/[.,]/g) ?? [];
  if (trenner.length <= 1) return t.replace(',', '.');
  const gemischt = new Set(trenner).size > 1;
  // Gemischt: das letzte Zeichen trennt die Dezimalstellen, das andere die Tausender.
  const dezimal = gemischt ? (trenner[trenner.length - 1] ?? null) : null;
  const tausender = dezimal ? (dezimal === '.' ? ',' : '.') : (trenner[0] ?? '.');
  const pos = dezimal ? t.lastIndexOf(dezimal) : -1;
  const ganz = pos >= 0 ? t.slice(0, pos) : t;
  const rest = pos >= 0 ? t.slice(pos + 1) : '';
  if (dezimal && ganz.includes(dezimal)) return null;
  const gruppen = new RegExp(`^-?\\d{1,3}(?:\\${tausender}\\d{3})+$`);
  if (!gruppen.test(ganz)) return null;
  return ganz.split(tausender).join('') + (rest ? `.${rest}` : '');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\^(\d+)/g, '<sup>$1</sup>');
}

function tabelle(zeilen: string[]): string {
  const zellen = (z: string) =>
    z
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
  const kopf = zellen(zeilen[0]);
  const rumpf = zeilen.slice(1).filter((z) => !/^\s*\|?\s*:?-{2,}/.test(z));
  // Breite Tabellen scrollen seitlich: per Tastatur erreichbar und mit Namen für Screenreader.
  const name = escapeHtml(['Tabelle', kopf.filter(Boolean).join(', ').replace(/[`*^]/g, '')].filter(Boolean).join(': '));
  return (
    `<div class="tabelle" tabindex="0" role="region" aria-label="${name}"><table><thead><tr>` +
    // Leere Ecke oben links als td: eine leere Spaltenüberschrift wäre für Screenreader ohne Inhalt
    kopf.map((c) => (c ? `<th>${inline(c)}</th>` : '<td></td>')).join('') +
    '</tr></thead><tbody>' +
    rumpf.map((z) => '<tr>' + zellen(z).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
    '</tbody></table></div>'
  );
}

/** Zeile eines Merke-Kastens: «> Text» (oder nur «>» als Leerzeile im Kasten). «>5» bleibt Text. */
const MERKE = /^\s*>(?:\s|$)/;

/**
 * Mini-Markdown → HTML. Unterstützt Absätze, `### Titel`, `- ` und `1. ` Listen,
 * `| Tabellen |`, `> Merke-Kasten` (aufeinanderfolgende Zeilen bilden einen Kasten,
 * darin ist wieder Mini-Markdown erlaubt, z. B. Listen), `**fett**`, `*kursiv*`,
 * `` `code` `` und `^n` (hochgestellt).
 * Alles andere wird escaped — das Ergebnis darf per [innerHTML] gerendert werden.
 */
export function miniMarkdown(text: string): string {
  const zeilen = text.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let i = 0;
  while (i < zeilen.length) {
    const z = zeilen[i];
    if (!z.trim()) {
      i++;
      continue;
    }
    if (MERKE.test(z)) {
      const block: string[] = [];
      while (i < zeilen.length && MERKE.test(zeilen[i])) block.push(zeilen[i++].replace(/^\s*>\s?/, ''));
      const innen = miniMarkdown(block.join('\n'));
      if (innen) html.push(`<blockquote class="merke">${innen}</blockquote>`);
      continue;
    }
    const titel = z.match(/^(#{1,4})\s+(.*)$/);
    if (titel) {
      html.push(`<h4>${inline(titel[2])}</h4>`);
      i++;
      continue;
    }
    if (/^\s*\|/.test(z)) {
      const block: string[] = [];
      while (i < zeilen.length && /^\s*\|/.test(zeilen[i])) block.push(zeilen[i++]);
      html.push(tabelle(block));
      continue;
    }
    if (/^\s*[-•]\s+/.test(z)) {
      const items: string[] = [];
      while (i < zeilen.length && /^\s*[-•]\s+/.test(zeilen[i])) {
        items.push(`<li>${inline(zeilen[i].replace(/^\s*[-•]\s+/, ''))}</li>`);
        i++;
      }
      html.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(z)) {
      const items: string[] = [];
      while (i < zeilen.length && /^\s*\d+\.\s+/.test(zeilen[i])) {
        items.push(`<li>${inline(zeilen[i].replace(/^\s*\d+\.\s+/, ''))}</li>`);
        i++;
      }
      html.push(`<ol>${items.join('')}</ol>`);
      continue;
    }
    const absatz: string[] = [];
    while (
      i < zeilen.length &&
      zeilen[i].trim() &&
      !/^(#{1,4})\s+/.test(zeilen[i]) &&
      !/^\s*[-•]\s+/.test(zeilen[i]) &&
      !/^\s*\|/.test(zeilen[i]) &&
      !/^\s*\d+\.\s+/.test(zeilen[i]) &&
      !MERKE.test(zeilen[i])
    ) {
      absatz.push(inline(zeilen[i]));
      i++;
    }
    if (absatz.length) html.push(`<p>${absatz.join('<br>')}</p>`);
    else i++;
  }
  return html.join('');
}
