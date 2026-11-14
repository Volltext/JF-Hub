import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { JPEG_QUALITY, MAX_PHOTO_BYTES, MAX_PHOTO_EDGE, fitWithin } from './limits';

/**
 * Rechnet die Seiten einer PDF in JPEG-Bilder um (pdf.js). Wird nur beim Einbetten nachgeladen (`embed.ts`), damit pdf.js den
 * Start der App nicht verlangsamt. Die Bilder sind so groß wie Fotos (längste Kante `MAX_PHOTO_EDGE`), lesbar auch am Tablet.
 */
GlobalWorkerOptions.workerSrc = workerUrl;

/** Zusatzdateien (siehe vite.config.ts, `pdfjsAssets`): Decoder für Scans und Standardschriften. pdf.js verlangt volle Adressen. */
const assets = (dir: string) => new URL(`${import.meta.env.BASE_URL}pdfjs/${dir}/`, document.baseURI).href;

export interface RenderedPage {
  data: Uint8Array;
  w: number;
  h: number;
}

export async function renderPdfPages(
  data: Uint8Array,
  opts: { maxPages: number; onPage?: (index: number, total: number) => void },
): Promise<{ pages: RenderedPage[]; total: number }> {
  // pdf.js übernimmt den Speicher in seinen Worker; die Kopie lässt die Datei des Aufrufers unberührt.
  const task = getDocument({ data: data.slice(), stopAtErrors: false, wasmUrl: assets('wasm'), standardFontDataUrl: assets('standard_fonts') });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'PasswordException') throw new Error('Die PDF ist mit einem Passwort geschützt.');
    throw new Error('Die PDF lässt sich nicht lesen (beschädigt oder kein PDF).');
  }
  try {
    const total = doc.numPages;
    const count = Math.min(total, opts.maxPages);
    const pages: RenderedPage[] = [];
    for (let i = 1; i <= count; i++) {
      opts.onPage?.(i, count);
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const { w, h } = fitWithin(Math.round(base.width * 4), Math.round(base.height * 4), MAX_PHOTO_EDGE);
      const viewport = page.getViewport({ scale: w / base.width });
      const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
      await page.render({ canvas, viewport, background: '#ffffff' }).promise;
      const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
      page.cleanup();
      if (!jpeg) throw new Error(`Seite ${i} konnte nicht umgewandelt werden.`);
      if (jpeg.size > MAX_PHOTO_BYTES) throw new Error(`Seite ${i} ist als Bild zu groß.`);
      pages.push({ data: new Uint8Array(await jpeg.arrayBuffer()), w, h });
      // Speicher der Leinwand sofort freigeben (bei vielen Seiten am Handy wichtig).
      canvas.width = 0;
      canvas.height = 0;
    }
    return { pages, total };
  } finally {
    void task.destroy();
  }
}
