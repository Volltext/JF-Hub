import { db } from '@/core/db/db';
import { jsonEqual } from '@/core/domain/equal';
import { DEMO_NEEDS_SERVER, IS_DEMO } from '@/core/env';
import { loadSettings } from '@/core/settings/settings';
import { shareBinaryFile } from '@/core/native/files';
import { ProtoError, loadConn, request } from './http';
import { newProtokoll, type Protokoll, type ProtokollPatch } from './model';
import { scheduleSync, syncNow } from './sync';

/** Wert eines Feldes, so wie er verglichen wird: fehlender Ordner = oberste Ebene, fehlendes `shared` = privat. */
function fieldValue(p: Partial<Protokoll>, key: keyof ProtokollPatch): unknown {
  if (key === 'folderId') return p.folderId ?? '';
  if (key === 'shared') return p.shared === true;
  return p[key];
}

function isUnchanged(row: Protokoll, patch: ProtokollPatch): boolean {
  return (Object.keys(patch) as (keyof ProtokollPatch)[]).every((key) => jsonEqual(fieldValue(row, key), fieldValue(patch, key)));
}

export const protokolleRepo = {
  async create(folderId = ''): Promise<Protokoll> {
    const p = newProtokoll(folderId, (await loadSettings()).defaultShared);
    await db.protokolle.add(p);
    return p;
  },

  /**
   * Speichert lokal (sofort) und stößt den Abgleich verzögert an. Ändert der Patch nichts, bleibt alles unberührt
   * (keine neue Änderungszeit, kein Abgleich) und die bisherige Änderungszeit kommt zurück.
   */
  async save(id: string, patch: ProtokollPatch): Promise<number> {
    const row = await db.protokolle.get(id);
    if (row && isUnchanged(row, patch)) return row.updatedAt;
    const updatedAt = Date.now();
    // Eine Änderung gibt dem Server einen neuen Versuch (eine frühere Ablehnung gilt nur für die alte Fassung).
    await db.protokolle.update(id, { ...patch, updatedAt, dirty: 1, rejected: undefined });
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
  if (IS_DEMO) throw new ProtoError(DEMO_NEEDS_SERVER);
  const p = await db.protokolle.get(id);
  if (!p) throw new ProtoError('Protokoll nicht gefunden.');
  await syncNow();
  let after = await db.protokolle.get(id);
  // Lief schon ein Abgleich, bekommt man dessen Ergebnis: Er kann vor dem letzten Speichern begonnen haben. Dann noch einmal.
  if (after?.dirty === 1) {
    await syncNow();
    after = await db.protokolle.get(id);
  }
  if (!after || after.dirty === 1) throw new ProtoError('Das PDF braucht eine Verbindung zum Server, damit die neueste Fassung verwendet wird.');
  const conn = await loadConn();
  const base64 = await request<string>(conn, 'GET', `/api/protocols/${encodeURIComponent(id)}/pdf`, undefined, true);
  await shareBinaryFile(pdfName(after), base64, 'application/pdf');
}
