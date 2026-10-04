import type { JSONContent } from '@tiptap/core';

/** Längste Kante eines Fotos nach dem Verkleinern (Pixel). */
export const MAX_PHOTO_EDGE = 1600;
export const JPEG_QUALITY = 0.8;
/** Größte angehängte Datei (Bytes). */
export const MAX_FILE_BYTES = 3 * 1024 * 1024;
/** Alle Anhänge eines Protokolls zusammen (Zeichen der Base64-Daten). Der Server nimmt etwas mehr an (sync.ts: MAX_CONTENT). */
export const MAX_ATTACHMENT_CHARS = 8_000_000;

/** Skaliert (w, h) so, dass die längste Kante höchstens `max` ist; nie vergrößern. */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const longest = Math.max(w, h);
  if (longest <= max) return { w, h };
  const k = max / longest;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Summe der Anhangsdaten (Zeichen) in einem Protokolltext. */
export function attachmentChars(node: JSONContent | undefined): number {
  if (!node) return 0;
  let n = 0;
  if (node.type === 'photo') n += String(node.attrs?.src ?? '').length;
  else if (node.type === 'attachment') n += String(node.attrs?.data ?? '').length;
  for (const c of node.content ?? []) n += attachmentChars(c);
  return n;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
