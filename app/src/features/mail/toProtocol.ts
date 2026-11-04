import type { JSONContent } from '@tiptap/core';
import { shortAddress, formatDateTime } from './compose';
import type { MailMessage } from './api';

/** Ein Anhang, der schon als lokaler Blob abgelegt ist und ins Protokoll eingefügt werden soll. */
export interface PlacedAttachment {
  blobId: string;
  name: string;
  mime: string;
  size: number;
  /** Fotos (JPEG) kommen als Bild ins Protokoll, alles andere als Datei. */
  photo?: { w: number; h: number };
}

const paragraph = (text: string): JSONContent => (text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' });

/** Blöcke für Anhänge: Datei bzw. Foto, danach ein leerer Absatz (wie beim Einfügen im Editor). */
export function attachmentBlocks(list: PlacedAttachment[]): JSONContent[] {
  return list.flatMap((a): JSONContent[] => [
    a.photo
      ? { type: 'photo', attrs: { blobId: a.blobId, mime: 'image/jpeg', w: a.photo.w, h: a.photo.h, caption: '' } }
      : { type: 'attachment', attrs: { blobId: a.blobId, name: a.name, mime: a.mime, size: a.size } },
    { type: 'paragraph' },
  ]);
}

/** Der Text der Mail als Absätze (leere Zeilen trennen Absätze, Zeilenumbrüche bleiben als einzelne Absätze erhalten). */
export function textBlocks(text: string): JSONContent[] {
  const lines = text.replace(/\r\n?/g, '\n').trim().split('\n');
  const out = lines.map((l) => paragraph(l.trimEnd()));
  return out.length ? out : [paragraph('')];
}

/** Inhalt eines neuen Protokolls aus einer Mail: Kopf (Von, Datum), Text, Anhänge. */
export function docFromMail(msg: Pick<MailMessage, 'from' | 'date' | 'text'>, attachments: PlacedAttachment[]): JSONContent {
  const head = `Mail von ${shortAddress(msg.from)}${msg.date ? ` vom ${formatDateTime(msg.date)}` : ''}`;
  return { type: 'doc', content: [paragraph(head), paragraph(''), ...textBlocks(msg.text), ...(attachments.length ? [paragraph(''), ...attachmentBlocks(attachments)] : [])] };
}

/** Datum der Mail als YYYY-MM-DD (Ortszeit); sonst heute. */
export function isoDay(iso: string, fallback: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fallback;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
