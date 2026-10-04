import { JPEG_QUALITY, MAX_PHOTO_EDGE, fitWithin } from './limits';

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

/** Verkleinert ein Foto auf höchstens `MAX_PHOTO_EDGE` Pixel und liefert es als JPEG-Data-URL. */
export async function photoToDataUrl(file: Blob): Promise<{ src: string; w: number; h: number }> {
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
    return { src: canvas.toDataURL('image/jpeg', JPEG_QUALITY), w, h };
  } finally {
    img.free();
  }
}

/** Dateiinhalt als reines Base64 (ohne Data-URL-Vorspann). */
export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
    r.readAsDataURL(file);
  });
}
