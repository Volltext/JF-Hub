import { db } from '@/core/db/db';
import { putLocalBlob } from '@/core/db/blobs';
import { todayIso } from '@/core/domain/id';
import { shareBinaryFile } from '@/core/native/files';
import { loadSettings } from '@/core/settings/settings';
import { MAX_FILE_BYTES, formatBytes } from '@/features/attachments/limits';
import { photoToJpeg } from '@/features/attachments/pick';
import { newProtokoll } from '@/features/protokolle/model';
import { scheduleSync } from '@/features/protokolle/sync';
import { mailApi, type MailAttachment, type MailMessage } from './api';
import { docFromMail, isoDay, type PlacedAttachment } from './toProtocol';

/** Was die Oberfläche mit Mails und ihren Anhängen macht, soweit es über die reine Anzeige hinausgeht. */

export function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/** Datei als Base64 (ohne Präfix), in Stücken, damit auch größere Dateien den Speicher nicht sprengen. */
export async function fileToBase64(file: Blob): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Lädt einen Anhang und öffnet Speichern (Browser) bzw. Teilen-Dialog (Android). */
export async function saveAttachment(folder: string, uid: number, att: MailAttachment): Promise<void> {
  const b64 = await mailApi.attachment(folder, uid, att.index);
  await shareBinaryFile(att.filename, b64, att.contentType || 'application/octet-stream');
}

const isImage = (mime: string) => /^image\/(jpeg|png|gif|webp|bmp)$/i.test(mime);

/**
 * Holt einen Anhang und legt ihn als lokalen Anhang der App ab (der Upload folgt beim nächsten Abgleich, noch vor dem Protokoll, das auf ihn
 * verweist). Bilder werden wie Fotos verkleinert und als Bild eingefügt, alles andere als Datei. Lässt sich ein Bild nicht lesen
 * (z. B. HEIC), kommt es als Datei.
 */
export async function placeAttachment(folder: string, uid: number, att: MailAttachment): Promise<PlacedAttachment> {
  if (att.size > MAX_FILE_BYTES) throw new Error(`${att.filename}: größer als ${formatBytes(MAX_FILE_BYTES)}`);
  const data = base64ToBytes(await mailApi.attachment(folder, uid, att.index));
  if (data.length === 0) throw new Error(`${att.filename}: leer`);
  if (data.length > MAX_FILE_BYTES) throw new Error(`${att.filename}: größer als ${formatBytes(MAX_FILE_BYTES)}`);
  const mime = att.contentType || 'application/octet-stream';
  if (isImage(mime)) {
    try {
      const photo = await photoToJpeg(new Blob([data as BlobPart], { type: mime }));
      const blob = await putLocalBlob({ kind: 'photo', mime: 'image/jpeg', name: '', data: photo.data });
      return { blobId: blob.id, name: att.filename, mime: 'image/jpeg', size: photo.data.length, photo: { w: photo.w, h: photo.h } };
    } catch {
      /* nicht lesbar als Bild: als Datei behalten */
    }
  }
  const blob = await putLocalBlob({ kind: 'file', mime, name: att.filename, data });
  return { blobId: blob.id, name: att.filename, mime, size: data.length };
}

/** Legt mehrere Anhänge ab; was nicht geht, steht in `skipped` (mit Grund), der Rest wird trotzdem übernommen. */
export async function placeAttachments(folder: string, uid: number, list: MailAttachment[]): Promise<{ placed: PlacedAttachment[]; skipped: string[] }> {
  const placed: PlacedAttachment[] = [];
  const skipped: string[] = [];
  for (const att of list) {
    try {
      placed.push(await placeAttachment(folder, uid, att));
    } catch (e) {
      skipped.push(e instanceof Error ? e.message : att.filename);
    }
  }
  return { placed, skipped };
}

/** Neues Protokoll aus einer Mail: Titel = Betreff, Datum der Mail, Text und Anhänge im Inhalt. Es startet für den Betreuer privat (wie ein neues Protokoll). */
export async function createProtocolFromMail(msg: MailMessage, placed: PlacedAttachment[], folderId = ''): Promise<string> {
  const p = newProtokoll(folderId, (await loadSettings()).defaultShared);
  p.title = msg.subject.trim().slice(0, 200);
  p.datum = isoDay(msg.date, todayIso());
  p.content = docFromMail(msg, placed);
  await db.protokolle.add(p);
  scheduleSync();
  return p.id;
}

const pendingKey = (protocolId: string) => `mail.pending.${protocolId}`;

/** Merkt Anhänge für ein bestehendes Protokoll vor: Der Editor fügt sie beim Öffnen am Ende ein (der Text gehört dem gemeinsamen Dokument, nicht dieser Ablage). */
export async function queueForProtocol(protocolId: string, placed: PlacedAttachment[]): Promise<void> {
  if (!placed.length) return;
  const old = ((await db.kv.get(pendingKey(protocolId)))?.value as PlacedAttachment[] | undefined) ?? [];
  await db.kv.put({ key: pendingKey(protocolId), value: [...old, ...placed] });
}

/** Holt die vorgemerkten Anhänge und löscht die Vormerkung (jeder Anhang wird nur einmal eingefügt). */
export async function takePending(protocolId: string): Promise<PlacedAttachment[]> {
  return db.transaction('rw', db.kv, async () => {
    const row = await db.kv.get(pendingKey(protocolId));
    if (!row) return [];
    await db.kv.delete(pendingKey(protocolId));
    return row.value as PlacedAttachment[];
  });
}
