/** Hilfen für Dateien: herunterladen, Bilder verkleinern. */

/** Bietet einen Text als Datei zum Herunterladen an. */
export function ladeHerunter(dateiname: string, inhalt: string, mime = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([inhalt], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = dateiname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Datum als JJJJ-MM-TT in lokaler Zeit (für Dateinamen). */
export function heuteIso(jetzt = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${jetzt.getFullYear()}-${p(jetzt.getMonth() + 1)}-${p(jetzt.getDate())}`;
}

/**
 * Verkleinert ein Bild (z. B. Handyfoto) auf höchstens `maxKante` Pixel und
 * liefert eine JPEG-Data-URL. Hält Lektionen klein, auch mit vielen Fotos.
 */
export async function verkleinereBild(datei: Blob, maxKante = 1600, qualitaet = 0.82): Promise<string> {
  const bitmap = await createImageBitmap(datei);
  const faktor = Math.min(1, maxKante / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * faktor);
  canvas.height = Math.round(bitmap.height * faktor);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas nicht verfügbar');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', qualitaet);
}

/** Entfernt den `data:…;base64,`-Präfix einer Data-URL. */
export function base64AusDataUrl(dataUrl: string): string {
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}
