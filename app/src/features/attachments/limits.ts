/** Längste Kante eines Fotos nach dem Verkleinern (Pixel). */
export const MAX_PHOTO_EDGE = 1600;
export const JPEG_QUALITY = 0.8;
/** Größte angehängte Datei (Bytes). Der Server nimmt ebenso viel an (server/src/blobs.ts). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Größtes Foto nach dem Verkleinern (Bytes). Ein Foto mit höchstens 1600 Pixeln bleibt weit darunter. */
export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;

/** Skaliert (w, h) so, dass die längste Kante höchstens `max` ist; nie vergrößern. */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= max) return { w, h };
  const k = max / longest;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
