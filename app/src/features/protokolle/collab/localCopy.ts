import * as Y from 'yjs';
import { db, type HubDb } from '@/core/db/db';
import { newId } from '@/core/domain/id';
import { META_FIELDS, stampMeta, type Protokoll } from '../model';
import { isEmptySnapshot } from './base';
import { isEmptyUpdate } from './yStore';
import { yDocToJson } from './yJson';

/**
 * Sichert den lokalen Text eines Protokolls als eigenes, neues Protokoll „… (lokale Fassung)“, bevor der Zustand verworfen wird:
 * Das Protokoll wurde gelöscht oder zurückgezogen, die Datenbank des Servers ist ersetzt worden, oder der Server hat bereits einen
 * Text mit anderer Geschichte. So geht nichts verloren, was dieses Gerät noch nicht abgeben konnte.
 *
 * Die Kopie gehört der Person an diesem Gerät, ist standardmäßig privat und wird beim nächsten Abgleich als neues Protokoll gesendet.
 * Liefert die Kennung der Kopie, oder `undefined`, wenn es nichts zu sichern gibt (kein lokaler Text oder nur ein leerer).
 * Mit `doc` wird der Text dieses Dokuments gesichert statt des gespeicherten Zustands.
 */
export async function saveLocalCopy(id: string, opts: { shared?: boolean; doc?: Y.Doc } = {}, store: HubDb = db): Promise<string | undefined> {
  // `doc`: Der Zustand liegt nicht mehr auf dem Gerät (verworfen), aber ein offener Editor hat ihn noch im Speicher.
  const [row, stored] = await Promise.all([store.protokolle.get(id), opts.doc ? undefined : store.ydocs.get(id)]);
  const text = opts.doc ? { update: Y.encodeStateAsUpdate(opts.doc) } : stored;
  if (!row || !text || isEmptyUpdate(text.update)) return undefined;

  const state = new Y.Doc();
  Y.applyUpdate(state, text.update);
  let content = row.content;
  try {
    content = yDocToJson(state);
  } catch {
    /* der gespeicherte Schnappschuss bleibt */
  }
  state.destroy();
  if (isEmptySnapshot(content)) return undefined;

  const copyId = newId();
  const now = Date.now();
  const { ownerId: _owner, rejected: _rejected, legacy: _legacy, ...rest } = row;
  void _owner, _rejected, _legacy;
  const copy: Protokoll = {
    ...rest,
    id: copyId,
    title: `${row.title || 'Ohne Titel'} (lokale Fassung)`,
    content,
    shared: opts.shared ?? false,
    rev: 0,
    updatedAt: now,
    dirty: 1,
    deleted: 0,
    metaAt: stampMeta(undefined, META_FIELDS, now),
  };
  await store.transaction('rw', [store.protokolle, store.ydocs], async () => {
    await store.protokolle.add(copy);
    // Dieselbe Geschichte unter neuer Kennung: Beim Server entsteht ein neues Protokoll, der Zustand geht komplett hoch.
    await store.ydocs.put({ id: copyId, update: text.update, dirty: 1, seq: 1 });
  });
  return copyId;
}
