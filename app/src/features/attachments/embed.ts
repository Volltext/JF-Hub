import type { JSONContent } from '@tiptap/core';
import { putLocalBlob } from '@/core/db/blobs';
import { photoToJpeg } from './pick';

/**
 * Einbetten: Statt einer Datei-Karte steht der Inhalt sichtbar im Protokoll (und damit im PDF-Export).
 * - Bilddateien werden zu einem Foto im Text (wie aus der Galerie).
 * - Bei PDFs wird jede Seite zu einem Foto mit Beschriftung „Datei · Seite 2 von 5“; die PDF selbst bleibt als Datei-Karte dahinter.
 * Andere Dateien (Word, Excel …) lassen sich nicht einbetten und bleiben Anhang.
 *
 * Die Seiten sind gewöhnliche Fotos: Abgleich, Offline-Betrieb, PDF-Export und ältere App-Versionen kennen sie bereits.
 */

/** Höchstens so viele PDF-Seiten werden eingebettet; die ganze Datei bleibt als Anhang erhalten. */
export const MAX_EMBED_PAGES = 20;

export type EmbedKind = 'image' | 'pdf';

/** Lässt sich die Datei einbetten, und wenn ja, wie? */
export function embedKind(mime: string, name: string): EmbedKind | null {
  const m = mime.toLowerCase();
  const n = name.toLowerCase();
  if (m === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (/^image\/(jpeg|png|gif|webp|bmp|avif)$/.test(m) || /\.(jpe?g|png|gif|webp|bmp|avif)$/.test(n)) return 'image';
  return null;
}

/** Beschriftung einer eingebetteten PDF-Seite. */
export function pageCaption(name: string, page: number, pages: number): string {
  const base = (name || 'PDF').slice(0, 150);
  return pages > 1 ? `${base} · Seite ${page} von ${pages}` : base;
}

export interface EmbedFile {
  name: string;
  mime: string;
  data: Uint8Array;
}

export interface Embedded {
  /** Fotos für den Text (Seiten bzw. das Bild). */
  blocks: JSONContent[];
  /** Hinweis für den Benutzer, z. B. wenn nicht alle Seiten eingebettet wurden. */
  note?: string;
}

const photoBlock = (blobId: string, w: number, h: number, caption: string): JSONContent => ({
  type: 'photo',
  attrs: { blobId, mime: 'image/jpeg', w, h, caption },
});

/**
 * Legt die Bilder zum Einbetten lokal ab (der Abgleich lädt sie hoch) und liefert die Foto-Blöcke. Wirft mit einer verständlichen
 * Meldung, wenn die Datei sich nicht einbetten lässt; dann bleibt sie Anhang.
 */
export async function embedFile(file: EmbedFile, onProgress?: (text: string) => void): Promise<Embedded> {
  const kind = embedKind(file.mime, file.name);
  if (kind === 'image') {
    const photo = await photoToJpeg(new Blob([file.data as BlobPart], { type: file.mime }));
    const blob = await putLocalBlob({ kind: 'photo', mime: 'image/jpeg', name: '', data: photo.data });
    return { blocks: [photoBlock(blob.id, photo.w, photo.h, '')] };
  }
  if (kind !== 'pdf') throw new Error('Diese Datei lässt sich nicht einbetten.');
  onProgress?.(`${file.name}: PDF wird geöffnet …`);
  const { renderPdfPages } = await import('./pdfPages');
  const { pages, total } = await renderPdfPages(file.data, {
    maxPages: MAX_EMBED_PAGES,
    onPage: (i, n) => onProgress?.(`${file.name}: Seite ${i} von ${n} …`),
  });
  if (!pages.length) throw new Error('Die PDF hat keine Seiten.');
  const blocks: JSONContent[] = [];
  for (const [i, p] of pages.entries()) {
    const blob = await putLocalBlob({ kind: 'photo', mime: 'image/jpeg', name: '', data: p.data });
    blocks.push(photoBlock(blob.id, p.w, p.h, pageCaption(file.name, i + 1, total)));
  }
  const note = total > pages.length ? `${file.name}: Eingebettet sind die ersten ${pages.length} von ${total} Seiten, die ganze Datei liegt als Anhang dabei.` : undefined;
  return { blocks, note };
}

/** Datei-Karte für eine (schon abgelegte) Datei. */
export const fileBlock = (attrs: { blobId: string; name: string; mime: string; size: number }): JSONContent => ({ type: 'attachment', attrs });
