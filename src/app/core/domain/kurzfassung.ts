/** Kurzfassung einer Lektion: Gliederung an den «## »-Überschriften und Lesezeit. */

export interface KurzfassungAbschnitt {
  /** Überschrift ohne Markdown-Zeichen. */
  titel: string;
  /** Inhalt des Abschnitts (Mini-Markdown, ohne die Überschrift). */
  text: string;
}

export interface GegliederteKurzfassung {
  /** Text vor der ersten «## »-Überschrift (leer, wenn keiner). */
  einleitung: string;
  abschnitte: KurzfassungAbschnitt[];
}

/** Genau zwei Rauten: «### » bleibt ein Zwischentitel innerhalb eines Abschnitts. */
const ABSCHNITT = /^##\s+(.*\S)\s*$/;

/** Überschrift als reiner Text (fett, kursiv, Code und Hochstellung entfernt). */
function reinerTitel(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

/** Teilt die Kurzfassung an den «## »-Überschriften in Abschnitte. */
export function teileKurzfassung(text: string | undefined): GegliederteKurzfassung {
  const zeilen = (text ?? '').replace(/\r\n/g, '\n').split('\n');
  const einleitung: string[] = [];
  const abschnitte: { titel: string; zeilen: string[] }[] = [];
  for (const z of zeilen) {
    const m = ABSCHNITT.exec(z);
    if (m) abschnitte.push({ titel: reinerTitel(m[1]), zeilen: [] });
    else (abschnitte.at(-1)?.zeilen ?? einleitung).push(z);
  }
  return {
    einleitung: einleitung.join('\n').trim(),
    abschnitte: abschnitte.map((a) => ({ titel: a.titel, text: a.zeilen.join('\n').trim() })),
  };
}

/** Anzahl Wörter ohne Markdown-Zeichen (Rauten, Listenzeichen, Tabellenstriche …). */
export function zaehleWoerter(text: string | undefined): number {
  const rein = (text ?? '').replace(/[#>*`|^•]+/g, ' ');
  return rein.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Geschätzte Lesezeit in Minuten (200 Wörter pro Minute, mindestens 1). */
export function lesezeitMinuten(text: string | undefined): number {
  return Math.max(1, Math.round(zaehleWoerter(text) / 200));
}
