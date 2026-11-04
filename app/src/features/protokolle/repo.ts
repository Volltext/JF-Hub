import { db, type HubDb } from '@/core/db/db';
import { jsonEqual } from '@/core/domain/equal';
import { DEMO_NEEDS_SERVER, IS_DEMO } from '@/core/env';
import { loadSettings } from '@/core/settings/settings';
import { shareBinaryFile } from '@/core/native/files';
import { getOpenSession } from './collab/session';
import { ProtoError, loadConn, request } from './http';
import { META_FIELDS, newProtokoll, stampMeta, type MetaField, type Protokoll, type ProtokollPatch } from './model';
import { scheduleSync, syncNow } from './sync';

/** Wert eines Feldes, so wie er verglichen wird: fehlender Ordner = oberste Ebene, fehlendes `shared` = privat. */
function fieldValue(p: Partial<Protokoll>, key: MetaField): unknown {
  if (key === 'folderId') return p.folderId ?? '';
  if (key === 'shared') return p.shared === true;
  return p[key];
}

/** Welche der Felder des Patches unterscheiden sich von der Zeile? */
function changedFields(row: Protokoll, patch: ProtokollPatch): MetaField[] {
  return (Object.keys(patch) as MetaField[]).filter((key) => (META_FIELDS as readonly string[]).includes(key) && !jsonEqual(fieldValue(row, key), fieldValue(patch, key)));
}

/**
 * Schreibt geänderte Kopfdaten in die Zeile des Protokolls (ohne den Abgleich anzustoßen). Liefert die Änderungszeit und ob sich etwas
 * geändert hat. Ein verschwundenes Protokoll legt nichts neu an.
 */
export async function saveHeader(store: HubDb, id: string, patch: ProtokollPatch): Promise<{ updatedAt: number; changed: boolean }> {
  const row = await store.protokolle.get(id);
  if (!row) return { updatedAt: Date.now(), changed: false };
  const changed = changedFields(row, patch);
  if (!changed.length) return { updatedAt: row.updatedAt, changed: false };
  const updatedAt = Date.now();
  const values = Object.fromEntries(changed.map((f) => [f, patch[f]]));
  // Nur die geänderten Felder bekommen eine Zeit. Ein Feld ohne eigene Zeit (Zeile aus der Zeit vor 3.0.0, vom Server übernommen ohne Zeit) erhebt
  // beim Abgleich keinen Anspruch: Die Änderungszeit der Zeile als Ersatz rückt mit jedem Schreiben von Text vor und würde die Änderung eines
  // anderen Geräts an diesem Feld überstimmen, obwohl dieses Gerät es nie angefasst hat.
  // Eine Änderung gibt dem Server einen neuen Versuch (eine frühere Ablehnung gilt nur für die alte Fassung).
  await store.protokolle.update(id, { ...values, metaAt: stampMeta(row.metaAt, changed, updatedAt), updatedAt, dirty: 1, rejected: undefined });
  return { updatedAt, changed: true };
}

export const protokolleRepo = {
  async create(folderId = ''): Promise<Protokoll> {
    const p = newProtokoll(folderId, (await loadSettings()).defaultShared);
    await db.protokolle.add(p);
    return p;
  },

  /**
   * Speichert die Kopfdaten lokal (sofort) und stößt den Abgleich verzögert an. Nur was sich wirklich ändert, bekommt eine neue
   * Änderungszeit: Der Server führt die Felder einzeln zusammen, und ein Feld, das hier nur mitgeschrieben wurde, würde sonst die
   * Änderung eines anderen Geräts überstimmen. Ändert der Patch nichts, bleibt alles unberührt (kein Abgleich), und die bisherige
   * Änderungszeit kommt zurück. Der Text gehört nicht hierher, er wird zusammen bearbeitet (`collab/`).
   */
  async save(id: string, patch: ProtokollPatch): Promise<number> {
    const { updatedAt, changed } = await saveHeader(db, id, patch);
    if (changed) scheduleSync();
    return updatedAt;
  },

  /** Nie gesendete Protokolle verschwinden sofort (mit ihrem Text), alle anderen werden beim nächsten Abgleich gelöscht. */
  async remove(id: string): Promise<void> {
    const p = await db.protokolle.get(id);
    if (!p) return;
    if (p.rev === 0) {
      await db.transaction('rw', [db.protokolle, db.ydocs], async () => {
        await db.protokolle.delete(id);
        await db.ydocs.delete(id);
      });
    } else await db.protokolle.update(id, { deleted: 1, dirty: 1, updatedAt: Date.now() });
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
  // Kopfdaten und Text müssen beim Server sein: Das PDF entsteht dort aus seiner Fassung. Ein offener Editor tauscht seinen Text selbst
  // aus (der Hintergrund-Abgleich lässt ihn aus), deshalb zuerst ihn.
  const settled = async (): Promise<boolean> => {
    const [row, text] = await Promise.all([db.protokolle.get(id), db.ydocs.get(id)]);
    return !!row && row.dirty !== 1 && text?.dirty !== 1;
  };
  for (let round = 0; round < 2; round++) {
    const open = getOpenSession(id);
    if (open) {
      await open.flush();
      await open.exchangeNow();
    }
    await syncNow();
    // Lief schon ein Abgleich, bekommt man dessen Ergebnis: Er kann vor dem letzten Speichern begonnen haben. Dann noch einmal.
    if (await settled()) break;
  }
  const after = await db.protokolle.get(id);
  if (!after || !(await settled())) throw new ProtoError('Das PDF braucht eine Verbindung zum Server, damit die neueste Fassung verwendet wird.');
  const conn = await loadConn();
  const base64 = await request<string>(conn, 'GET', `/api/protocols/${encodeURIComponent(id)}/pdf`, undefined, true);
  await shareBinaryFile(pdfName(after), base64, 'application/pdf');
}
