import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

/** Speichert Text als Datei und öffnet den Teilen-Dialog (Android) bzw. startet einen Download (Web). */
export async function shareTextFile(filename: string, text: string, mime = 'application/json'): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data: text,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({ title: filename, url: uri });
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Teilt Text als Nachricht (Android: Teilen-Dialog, z. B. WhatsApp oder E-Mail).
 * Im Browser landet der Text in der Zwischenablage.
 */
export async function shareText(title: string, text: string): Promise<'shared' | 'copied'> {
  if (Capacitor.isNativePlatform()) {
    await Share.share({ title, text, dialogTitle: title });
    return 'shared';
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}

/** Wie `shareTextFile`, aber für Binärdaten (Base64), z. B. PDF. */
export async function shareBinaryFile(filename: string, base64: string, mime: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { uri } = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
    await Share.share({ title: filename, url: uri });
    return;
  }
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Lässt den Nutzer eine Textdatei auswählen und liefert deren Inhalt. */
export function pickTextFile(accept = 'application/json,.json'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept });
    input.onchange = async () => resolve((await input.files?.[0]?.text()) ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}
