import * as Y from 'yjs';
import { db, type HubDb, type YDocRow } from '@/core/db/db';

/**
 * Lokaler Speicher für den Text der Protokolle (Tabelle `ydocs`). Jeder Zugriff liest, mischt und schreibt in einer Transaktion:
 * Zwei Tabs, der Editor und der Hintergrund-Abgleich arbeiten an derselben Zeile, und Yjs-Zustände lassen sich ohne Verlust
 * zusammenführen. Überschrieben wird nie.
 */

/** Ein Update ohne Inhalt (keine Strukturen, keine Löschungen) besteht aus zwei Nullen. */
export const isEmptyUpdate = (u: Uint8Array): boolean => u.length === 2 && u[0] === 0 && u[1] === 0;

export const EMPTY_UPDATE: Uint8Array = Y.encodeStateAsUpdate(new Y.Doc());

export function getYRow(id: string, store: HubDb = db): Promise<YDocRow | undefined> {
  return store.ydocs.get(id);
}

/** Das Dokument aus dem lokalen Zustand; `undefined`, wenn dieses Gerät noch keinen hat. */
export async function loadDoc(id: string, store: HubDb = db): Promise<{ doc: Y.Doc; row: YDocRow } | undefined> {
  const row = await store.ydocs.get(id);
  if (!row) return undefined;
  const doc = new Y.Doc();
  Y.applyUpdate(doc, row.update);
  return { doc, row };
}

/**
 * Eine lokale Änderung (oder mehrere, zusammengefasst) vormerken. Liefert die neue Zählung. Eine frühere Ablehnung des Servers gilt
 * nur für die alte Fassung und entfällt.
 */
export async function putLocal(id: string, update: Uint8Array, store: HubDb = db): Promise<number> {
  return store.transaction('rw', store.ydocs, async () => {
    const row = await store.ydocs.get(id);
    const seq = (row?.seq ?? 0) + 1;
    const next: YDocRow = row
      ? { ...row, update: Y.mergeUpdates([row.update, update]), dirty: 1, seq, rejected: undefined }
      : { id, update, dirty: 1, seq };
    await store.ydocs.put(next);
    return seq;
  });
}

/**
 * Legt die Basis eines Protokolls an, die dieses Gerät aus altem Inhalt gebaut hat (nie gesendet, Inhalt aus der Zeit vor 3.0.0).
 * Gibt es schon einen Zustand (ein anderer Tab war schneller), bleibt er und wird zurückgegeben: Zwei Basen desselben Inhalts
 * zusammenzuführen würde ihn verdoppeln.
 */
export async function putBase(id: string, update: Uint8Array, store: HubDb = db): Promise<YDocRow> {
  return store.transaction('rw', store.ydocs, async () => {
    const existing = await store.ydocs.get(id);
    if (existing) return existing;
    const row: YDocRow = { id, update, dirty: 1, seq: 1, created: true };
    await store.ydocs.put(row);
    return row;
  });
}

export interface Answer {
  /** Was dem Client fehlt. */
  update?: Uint8Array;
  /** Zustandsvektor des Servers nach dem Anwenden. */
  sv?: Uint8Array;
  rev?: number;
}

/**
 * Übernimmt die Antwort des Servers: mischt, was fehlte, merkt den Stand des Servers und entscheidet, ob noch etwas zu senden ist.
 * `sentSeq` ist die Zählung, die beim Aufbau der Anfrage galt: Wurde seitdem weitergeschrieben, bleibt die Zeile vorgemerkt.
 * Gibt es noch keine Zeile (Vorabladen), entsteht eine saubere.
 */
export async function applyAnswer(id: string, answer: Answer, sentSeq: number, store: HubDb = db): Promise<YDocRow> {
  return store.transaction('rw', [store.ydocs, store.protokolle], async () => {
    const row = await store.ydocs.get(id);
    const update = answer.update && !isEmptyUpdate(answer.update) ? answer.update : undefined;
    const next: YDocRow = row
      ? {
          ...row,
          update: update ? Y.mergeUpdates([row.update, update]) : row.update,
          serverSv: answer.sv ?? row.serverSv,
          dirty: row.seq === sentSeq ? 0 : 1,
          created: undefined,
          rejected: undefined,
        }
      : { id, update: update ?? EMPTY_UPDATE, serverSv: answer.sv, dirty: 0, seq: 0 };
    await store.ydocs.put(next);
    // Bis zu welcher Revision dieses Gerät den Text kennt (der Hintergrund-Abgleich sieht daran, was sich seitdem geändert hat).
    if (answer.rev !== undefined) await store.protokolle.update(id, { textRev: answer.rev });
    return next;
  });
}

/** Der Server nimmt diese Fassung nicht an (zu groß, ungültig). Gilt nur, wenn seitdem nichts weitergeschrieben wurde. */
export async function markRejected(id: string, reason: string, sentSeq: number, store: HubDb = db): Promise<void> {
  await store.transaction('rw', store.ydocs, async () => {
    const row = await store.ydocs.get(id);
    if (row && row.seq === sentSeq) await store.ydocs.put({ ...row, rejected: reason });
  });
}

/** Der Server kennt unseren Stand nicht mehr genau (Antwort `resync`): Beim nächsten Mal geht der ganze Zustand hoch. */
export async function forgetServerState(id: string, store: HubDb = db): Promise<void> {
  await store.transaction('rw', [store.ydocs, store.protokolle], async () => {
    const row = await store.ydocs.get(id);
    if (row) await store.ydocs.put({ ...row, serverSv: undefined });
    await store.protokolle.update(id, { textRev: undefined });
  });
}

export async function discard(id: string, store: HubDb = db): Promise<void> {
  await store.ydocs.delete(id);
}

/**
 * Verdichtet den Zustand (Yjs gibt Inhalt gelöschter Zeichen frei, sobald das Dokument ihn neu kodiert) und schreibt ihn zurück,
 * wenn das deutlich spart. Die Zählung und das Merkmal „vorgemerkt“ bleiben unberührt: Das ist keine Änderung des Textes.
 */
export async function compact(id: string, store: HubDb = db, minSaving = 0.2): Promise<boolean> {
  return store.transaction('rw', store.ydocs, async () => {
    const row = await store.ydocs.get(id);
    if (!row || row.update.length < 2048) return false;
    const doc = new Y.Doc();
    Y.applyUpdate(doc, row.update);
    const small = Y.encodeStateAsUpdate(doc);
    doc.destroy();
    if (small.length > row.update.length * (1 - minSaving)) return false;
    await store.ydocs.put({ ...row, update: small });
    return true;
  });
}

/** Wie viele Texte hat dieses Gerät, die der Server noch nicht bestätigt hat? */
export function dirtyYCount(store: HubDb = db): Promise<number> {
  return store.ydocs.where('dirty').equals(1).count();
}
