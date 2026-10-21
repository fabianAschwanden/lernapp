/** Ids aus Texten bilden (kebab-case, a–z, 0–9) und freie Ids finden. */

/** «Datenfluss im Computer» → `datenfluss-im-computer` (höchstens `max` Zeichen). */
export function slug(text: string, max = 40): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

/** Hängt -2, -3 … an, bis die id frei ist. */
export function freieId(basis: string, belegt: ReadonlySet<string>): string {
  if (!belegt.has(basis)) return basis;
  let n = 2;
  while (belegt.has(`${basis}-${n}`)) n++;
  return `${basis}-${n}`;
}
