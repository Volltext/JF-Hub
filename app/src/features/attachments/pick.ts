import { JPEG_QUALITY, MAX_PHOTO_BYTES, MAX_PHOTO_EDGE, fitWithin, formatBytes } from './limits';

/** Öffnet die Dateiauswahl (bzw. mit `capture` die Kamera) und liefert die gewählten Dateien. */
export function pickFiles(opts: { accept: string; multiple?: boolean; capture?: boolean }): Promise<File[]> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: opts.accept, multiple: !!opts.multiple });
    if (opts.capture) input.setAttribute('capture', 'environment');
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

async function decode(file: Blob): Promise<{ source: CanvasImageSource; w: number; h: number; free: () => void }> {
  if (typeof createImageBitmap === 'function') {
    // „from-image“ dreht Handyfotos anhand der EXIF-Angabe richtig.
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bmp, w: bmp.width, h: bmp.height, free: () => bmp.close() };
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise<void>((ok, fail) => {
    img.onload = () => ok();
    img.onerror = () => fail(new Error('Bild konnte nicht gelesen werden.'));
    img.src = url;
  });
  return { source: img, w: img.naturalWidth, h: img.naturalHeight, free: () => URL.revokeObjectURL(url) };
}

/** Verkleinert ein Foto auf höchstens `MAX_PHOTO_EDGE` Pixel und liefert es als JPEG (Bytes). */
export async function photoToJpeg(file: Blob): Promise<{ data: Uint8Array; w: number; h: number }> {
  let img;
  try {
    img = await decode(file);
  } catch {
    throw new Error('Dieses Bildformat kann nicht gelesen werden.');
  }
  try {
    const { w, h } = fitWithin(img.w, img.h, MAX_PHOTO_EDGE);
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Bild konnte nicht verarbeitet werden.');
    ctx.fillStyle = '#fff'; // transparente PNGs sonst schwarz im JPEG
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img.source, 0, 0, w, h);
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
    if (!jpeg) throw new Error('Bild konnte nicht verarbeitet werden.');
    if (jpeg.size > MAX_PHOTO_BYTES) throw new Error(`Das Foto ist auch verkleinert größer als ${formatBytes(MAX_PHOTO_BYTES)}.`);
    return { data: new Uint8Array(await jpeg.arrayBuffer()), w, h };
  } finally {
    img.free();
  }
}
