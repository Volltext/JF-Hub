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

/** Anhänge, die noch hochgeladen werden müssen (und die der Server nicht schon abgelehnt hat). */
export async function pendingBlobs(store: HubDb = db): Promise<LocalBlob[]> {
  return (await store.blobs.where('state').equals('local').toArray()).filter((b) => !b.rejected);
}

/** Anzahl der Anhänge, die nur auf diesem Gerät liegen (gehen beim Abmelden verloren). */
export async function localBlobCount(store: HubDb = db): Promise<number> {
  return store.blobs.where('state').equals('local').count();
}

export async function markSynced(id: string, store: HubDb = db): Promise<void> {
  await store.blobs.update(id, { state: 'synced', rejected: undefined });
}

export async function markRejected(id: string, reason: string, store: HubDb = db): Promise<void> {
  await store.blobs.update(id, { rejected: reason });
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
      await store.blobs.update(id, { state: 'local' });
      n++;
    }
  }
  return n;
}

/** Entfernt die am längsten ungenutzten Kopien des Servers, bis sie zusammen höchstens `limit` Byte belegen. Liefert die Anzahl. */
export async function evictBlobs(limit: number = CACHE_LIMIT_BYTES, store: HubDb = db): Promise<number> {
  const copies = await store.blobs.where('state').equals('synced').toArray();
  let total = copies.reduce((sum, b) => sum + b.size, 0);
  if (total <= limit) return 0;
  const drop: string[] = [];
  for (const b of copies.sort((a, c) => a.lastUsedAt - c.lastUsedAt)) {
    if (total <= limit) break;
    drop.push(b.id);
    total -= b.size;
  }
  await store.transaction('rw', [store.blobs, store.blobData], async () => {
    await store.blobs.bulkDelete(drop);
    await store.blobData.bulkDelete(drop);
  });
  return drop.length;
}
