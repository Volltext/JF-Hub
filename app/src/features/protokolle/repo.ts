import { db } from '@/core/db/db';
import { loadSettings } from '@/core/settings/settings';
import { shareBinaryFile } from '@/core/native/files';
import { ProtoError, loadConn, request } from './http';
import { newProtokoll, type Protokoll, type ProtokollPatch } from './model';
import { scheduleSync, syncNow } from './sync';

export const protokolleRepo = {
  async create(folderId = ''): Promise<Protokoll> {
    const p = newProtokoll(folderId, (await loadSettings()).defaultShared);
    await db.protokolle.add(p);
    return p;
  },

  /** Speichert lokal (sofort) und stößt den Abgleich verzögert an. */
  async save(id: string, patch: ProtokollPatch): Promise<number> {
    const updatedAt = Date.now();
    await db.protokolle.update(id, { ...patch, updatedAt, dirty: 1 });
    scheduleSync();
    return updatedAt;
  },

  /** Nie gesendete Protokolle verschwinden sofort, alle anderen werden beim nächsten Abgleich gelöscht. */
  async remove(id: string): Promise<void> {
    const p = await db.protokolle.get(id);
    if (!p) return;
    if (p.rev === 0) await db.protokolle.delete(id);
    else await db.protokolle.update(id, { deleted: 1, dirty: 1, updatedAt: Date.now() });
    scheduleSync(300);
  },
};

function pdfName(p: Protokoll): string {
  const base = [p.datum, p.title || 'Protokoll'].filter(Boolean).join(' ').replace(/[^\p{L}\p{N} ._-]+/gu, '').trim();
  return `${base || 'Protokoll'}.pdf`;
}

/** Gleicht ab, lädt das PDF vom Server und öffnet Teilen-Dialog (App) bzw. Download (Web). */
export async function exportPdf(id: string): Promise<void> {
  const p = await db.protokolle.get(id);
  if (!p) throw new ProtoError('Protokoll nicht gefunden.');
  await syncNow();
  const after = await db.protokolle.get(id);
  if (!after || after.dirty === 1) throw new ProtoError('Das PDF braucht eine Verbindung zum Server, damit die neueste Fassung verwendet wird.');
  const conn = await loadConn();
  const base64 = await request<string>(conn, 'GET', `/api/protocols/${encodeURIComponent(id)}/pdf`, undefined, true);
  await shareBinaryFile(pdfName(after), base64, 'application/pdf');
}
