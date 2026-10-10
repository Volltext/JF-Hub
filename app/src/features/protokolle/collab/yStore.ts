import * as Y from 'yjs';
import { db, type HubDb, type YDocRow } from '@/core/db/db';
import { newId } from '@/core/domain/id';

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

/** Die Erzeugung einer Zeile (`''` bei Zeilen aus früherer Zeit); `undefined`, wenn es sie nicht gibt. */
export const genOf = (row: YDocRow | undefined): string | undefined => (row ? (row.gen ?? '') : undefined);

/**
 * Eine lokale Änderung (oder mehrere, zusammengefasst) vormerken. Liefert die neue Zählung. Eine frühere Ablehnung des Servers gilt
 * nur für die alte Fassung und entfällt.
 */
export async function putLocal(id: string, update: Uint8Array, store: HubDb = db): Promise<number> {
  return (await write(id, update, store))!.seq;
}

/**
 * Wie `putLocal`, aber nur in die Zeile, die die Bearbeitung kennt (`known`: ihre Erzeugung, `undefined`, wenn sie noch keine hatte).
 * Hat sie eine, muss es genau diese Zeile noch geben: Wurde der Zustand unter ihr verworfen (Datenbank des Servers ersetzt) und vielleicht
 * von einem anderen Tab neu angelegt, entstünde sonst eine Zeile aus nur der letzten Änderung oder eine Mischung zweier Geschichten, die
 * der Server nicht kennt. Dann schreibt es nichts und liefert `undefined`. Sonst die neue Zählung und die Erzeugung der Zeile (bei einer
 * neuen die frische; gibt es sie inzwischen, weil ein anderer Tab sie angelegt hat, wird gemischt und deren Erzeugung gemeldet).
 */
export async function putGuarded(id: string, update: Uint8Array, known: string | undefined, store: HubDb = db): Promise<{ seq: number; gen: string } | undefined> {
  return write(id, update, store, known === undefined ? undefined : { gen: known });
}

async function write(id: string, update: Uint8Array, store: HubDb, guard?: { gen: string }): Promise<{ seq: number; gen: string } | undefined> {
  return store.transaction('rw', store.ydocs, async () => {
    const row = await store.ydocs.get(id);
    if (guard && genOf(row) !== guard.gen) return undefined;
    const seq = (row?.seq ?? 0) + 1;
    const next: YDocRow = row
      ? { ...row, update: Y.mergeUpdates([row.update, update]), dirty: 1, seq, rejected: undefined }
      : { id, update, dirty: 1, seq, gen: newId() };
    await store.ydocs.put(next);
    return { seq, gen: next.gen ?? '' };
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
    const row: YDocRow = { id, update, dirty: 1, seq: 1, created: true, gen: newId() };
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
 *
 * `sentSeq` ist die Zählung, die beim Aufbau der Anfrage galt, *wenn der eigene Text Teil der Anfrage war*: Dann bestätigt die Antwort ihn,
 * und die Zeile gilt als gesendet, außer es wurde seitdem weitergeschrieben. War er nicht Teil der Anfrage (`undefined`: der Text war
 * abgelehnt und wird nicht erneut gesendet, oder es gab nichts zu senden), nimmt die Zeile nur das Neue des Servers auf; Vormerkung,
 * Ablehnung und Basis bleiben, wie sie waren. Sonst gälte abgelehnter Text bei der nächsten fremden Änderung als erledigt.
 *
 * Gibt es noch keine Zeile (Vorabladen), entsteht eine saubere, aber nur für ein Protokoll, das es hier gibt: Eine Antwort, die nach dem
 * Abmelden eintrifft, legt nichts vom vorigen Konto neu an.
 */
export async function applyAnswer(id: string, answer: Answer, sentSeq: number | undefined, store: HubDb = db): Promise<YDocRow> {
  return store.transaction('rw', [store.ydocs, store.protokolle], async () => {
    const row = await store.ydocs.get(id);
    const update = answer.update && !isEmptyUpdate(answer.update) ? answer.update : undefined;
    const acked = sentSeq !== undefined;
    const next: YDocRow = row
      ? {
          ...row,
          update: update ? Y.mergeUpdates([row.update, update]) : row.update,
          serverSv: answer.sv ?? row.serverSv,
          dirty: acked ? (row.seq === sentSeq ? 0 : 1) : row.dirty,
          created: acked ? undefined : row.created,
          rejected: acked ? undefined : row.rejected,
        }
      : { id, update: update ?? EMPTY_UPDATE, serverSv: answer.sv, dirty: 0, seq: 0, gen: newId() };
    if (!row && !(await store.protokolle.get(id))) return next;
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
