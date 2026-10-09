import { blobIdsIn } from '@/core/domain/blobRefs';
import { newId } from '@/core/domain/id';
import { db, type HubDb, type LocalBlob } from './db';

/**
 * Lokaler Speicher für Fotos und Dateien von Protokollen. Ein neuer Anhang liegt zuerst nur hier (`local`), wird beim nächsten
 * Abgleich vor den Protokollen hochgeladen (`synced`) und kann dann bei Platzmangel wieder verdrängt werden: Der Server hat ihn,
 * und die App holt ihn bei Bedarf neu.
 */

/** So viel Platz belegen heruntergeladene Kopien höchstens (Anhänge, die nur hier liegen, zählen nicht mit und bleiben immer). */
export const CACHE_LIMIT_BYTES = 300 * 1024 * 1024;

const HOUR = 3_600_000;

export interface NewBlob {
  /** Fehlt sie, vergibt die App eine (`crypto.subtle` gibt es auf http://<IP> nicht, deshalb kein Hash als Kennung). */
  id?: string;
  kind: 'photo' | 'file';
  mime: string;
  name: string;
  data: Uint8Array;
}

/** Legt einen neuen Anhang an, der nur auf diesem Gerät liegt. */
export async function putLocalBlob(input: NewBlob, store: HubDb = db): Promise<LocalBlob> {
  const now = Date.now();
  const meta: LocalBlob = { id: input.id ?? newId(), kind: input.kind, mime: input.mime, name: input.name, size: input.data.length, state: 'local', createdAt: now, lastUsedAt: now };
  await store.transaction('rw', [store.blobs, store.blobData], async () => {
    await store.blobs.put(meta);
    await store.blobData.put({ id: meta.id, data: input.data });
  });
  return meta;
}

/** Merkt eine heruntergeladene Kopie. Liegt der Anhang schon hier (womöglich noch nicht hochgeladen), bleibt er unberührt. */
export async function saveDownloaded(info: Pick<NewBlob, 'id' | 'kind' | 'mime' | 'name'> & { id: string }, data: Uint8Array, store: HubDb = db): Promise<LocalBlob> {
  return store.transaction('rw', [store.blobs, store.blobData], async () => {
    const existing = await store.blobs.get(info.id);
    if (existing) return existing;
    const now = Date.now();
    const meta: LocalBlob = { id: info.id, kind: info.kind, mime: info.mime, name: info.name, size: data.length, state: 'synced', createdAt: now, lastUsedAt: now };
    await store.blobs.put(meta);
    await store.blobData.put({ id: info.id, data });
    return meta;
  });
}

/** Angaben und Bytes eines Anhangs. Die Nutzung wird vermerkt (höchstens einmal pro Stunde, um nicht bei jedem Anzeigen zu schreiben). */
export async function readBlob(id: string, store: HubDb = db): Promise<{ meta: LocalBlob; data: Uint8Array } | undefined> {
  const [meta, row] = await Promise.all([store.blobs.get(id), store.blobData.get(id)]);
  if (!meta || !row) return undefined;
  if (Date.now() - meta.lastUsedAt > HOUR) await store.blobs.update(id, { lastUsedAt: Date.now() });
  return { meta, data: row.data };
}

/** Anhänge, die jetzt hochgeladen werden sollen: nicht vom Server abgelehnt und nicht in der Pause nach einem Fehlschlag. */
export async function pendingBlobs(store: HubDb = db, now = Date.now()): Promise<LocalBlob[]> {
  return (await store.blobs.where('state').equals('local').toArray()).filter((b) => !b.rejected && (b.retryAt ?? 0) <= now);
}

/**
 * Anhänge, die nur auf diesem Gerät liegen und noch gebraucht werden: die wartenden und die vom Server abgelehnten, auf die noch ein
 * Protokoll verweist. Ein abgelehnter Anhang, den niemand mehr braucht (das Foto wurde wieder entfernt), ist kein Problem mehr und
 * soll weder den Hinweis im Abgleich noch die Warnung beim Abmelden dauerhaft auslösen.
 */
async function liveLocalBlobs(store: HubDb): Promise<LocalBlob[]> {
  const local = await store.blobs.where('state').equals('local').toArray();
  if (!local.some((b) => b.rejected)) return local;
  const used = new Set<string>();
  await store.protokolle.each((p) => {
    for (const id of blobIdsIn(p.content)) used.add(id);
  });
  return local.filter((b) => !b.rejected || used.has(b.id));
}

/** Anzahl der Anhänge, die nur auf diesem Gerät liegen und noch gebraucht werden (gehen beim Abmelden verloren). */
export async function localBlobCount(store: HubDb = db): Promise<number> {
  return (await liveLocalBlobs(store)).length;
}

export async function markSynced(id: string, store: HubDb = db): Promise<void> {
  await store.blobs.update(id, { state: 'synced', rejected: undefined, failures: undefined, retryAt: undefined });
}

export async function markRejected(id: string, reason: string, store: HubDb = db): Promise<void> {
  await store.blobs.update(id, { rejected: reason });
}

/** Pause nach dem n-ten Fehlschlag: 1, 2, 4 … Minuten, höchstens eine Stunde. */
export const retryDelay = (failures: number): number => Math.min(60, 2 ** Math.max(0, failures - 1)) * 60_000;

/** Der Upload ist an einem Serverfehler oder einem Zeitlimit gescheitert: Er kommt nach einer Pause wieder dran. */
export async function markFailed(id: string, store: HubDb = db, now = Date.now()): Promise<void> {
  const failures = ((await store.blobs.get(id))?.failures ?? 0) + 1;
  await store.blobs.update(id, { failures, retryAt: now + retryDelay(failures) });
}

/** Gibt abgelehnten und pausierten Anhängen einen neuen Versuch („Alles neu abgleichen“). Liefert die Anzahl. */
export async function retryBlobsNow(store: HubDb = db): Promise<number> {
  const stuck = await store.blobs.filter((b) => b.state === 'local' && (!!b.rejected || !!b.failures || !!b.retryAt)).primaryKeys();
  for (const id of stuck) await store.blobs.update(id, { rejected: undefined, failures: undefined, retryAt: undefined });
  return stuck.length;
}

/** Anzahl der Anhänge, die der Server abgelehnt hat, die nur noch hier liegen und auf die ein Protokoll noch verweist. */
export async function rejectedBlobCount(store: HubDb = db): Promise<number> {
  return (await liveLocalBlobs(store)).filter((b) => !!b.rejected).length;
}

/**
 * Der Server meldet Anhänge als fehlend, auf die ein soeben gesendetes Protokoll verweist (aufgeräumt, Datenbank ersetzt …).
 * Hat dieses Gerät sie noch, werden sie erneut hochgeladen. Abgelehnte bleiben abgelehnt. Liefert die Anzahl.
 */
export async function requeueBlobs(ids: string[], store: HubDb = db): Promise<number> {
  let n = 0;
  for (const id of ids) {
    const meta = await store.blobs.get(id);
    if (meta?.state === 'synced') {
      await store.blobs.update(id, { state: 'local', failures: undefined, retryAt: undefined });
      n++;
    }
  }
  return n;
}

/**
 * Entfernt die am längsten ungenutzten Kopien des Servers, bis sie zusammen höchstens `limit` Byte belegen. Liefert die Anzahl.
 * Anhänge, auf die ein noch nicht gesendetes Protokoll verweist, bleiben: Hat der Server das Protokoll nie bekommen, ist diese
 * Kopie womöglich die einzige, wenn er den Anhang inzwischen aufgeräumt hat.
 */
export async function evictBlobs(limit: number = CACHE_LIMIT_BYTES, store: HubDb = db): Promise<number> {
  const copies = await store.blobs.where('state').equals('synced').toArray();
  let total = copies.reduce((sum, b) => sum + b.size, 0);
  if (total <= limit) return 0;
  // Auch Texte mit ungesendeten Änderungen: Ihre Anhänge hat womöglich nur dieses Gerät.
  const unsent = new Set([...((await store.protokolle.where('dirty').equals(1).primaryKeys()) as string[]), ...((await store.ydocs.where('dirty').equals(1).primaryKeys()) as string[])]);
  const inUse = new Set((await store.protokolle.bulkGet([...unsent])).flatMap((p) => (p ? blobIdsIn(p.content) : [])));
  const drop: string[] = [];
  for (const b of copies.sort((a, c) => a.lastUsedAt - c.lastUsedAt)) {
    if (total <= limit) break;
    if (inUse.has(b.id)) continue;
    drop.push(b.id);
    total -= b.size;
  }
  await store.transaction('rw', [store.blobs, store.blobData], async () => {
    await store.blobs.bulkDelete(drop);
    await store.blobData.bulkDelete(drop);
  });
  return drop.length;
}
