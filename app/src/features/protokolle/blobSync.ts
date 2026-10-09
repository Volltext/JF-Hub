import { CACHE_LIMIT_BYTES, evictBlobs, markRejected, markSynced, pendingBlobs, readBlob, saveDownloaded } from '@/core/db/blobs';
import { db, type HubDb, type LocalBlob } from '@/core/db/db';
import { base64ToBytes, bytesToBase64 } from '@/core/domain/base64';
import { ProtoError, loadConn, request } from './http';

/**
 * Fotos und Dateien der Protokolle zwischen Gerät und Server. Neue Anhänge laden vor den Protokollen hoch, die auf sie verweisen
 * (so zeigt kein Protokoll beim Server ins Leere); fehlende holt die App erst, wenn jemand sie anschaut.
 */

export interface BlobTransport {
  /** Wirft `ProtoError`: Status 0 = keine Verbindung, 4xx = der Server nimmt den Anhang nicht an. */
  upload(meta: LocalBlob, data: Uint8Array): Promise<void>;
  download(id: string): Promise<Uint8Array>;
}

/** Ein Anhang kann länger dauern als eine Anfrage des Abgleichs. */
const TRANSFER_TIMEOUT = 120_000;

export const httpTransport: BlobTransport = {
  async upload(meta, data) {
    const conn = await loadConn();
    try {
      await request(conn, 'PUT', `/api/blobs/${encodeURIComponent(meta.id)}`, { kind: meta.kind, name: meta.name, mime: meta.mime, data: bytesToBase64(data) }, false, { timeoutMs: TRANSFER_TIMEOUT });
    } catch (e) {
      // Einen Server vor 2.2.0 kennt die Adresse nicht: Er kann die Anhänge dieser App-Version nicht annehmen.
      if (e instanceof ProtoError && e.status === 404) throw new ProtoError('Der Server ist zu alt für diese App-Version. Bitte den Server aktualisieren.', 426);
      throw e;
    }
  },
  async download(id) {
    const conn = await loadConn();
    return base64ToBytes(await request<string>(conn, 'GET', `/api/blobs/${encodeURIComponent(id)}`, undefined, true, { timeoutMs: TRANSFER_TIMEOUT }));
  },
};

/** Der Server lehnt diese Anhänge dauerhaft ab (zu groß, kein JPEG, Kennung vergeben, in der Demo nicht erlaubt …). */
const REFUSED = new Set([400, 403, 409, 413, 415, 422]);
/** Bei diesen Antworten hat weiteres Versuchen keinen Sinn: keine Verbindung, abgemeldet, zu viele Anfragen. Der Abgleich bricht ab. */
const ABORT = new Set([0, 401, 408, 429]);

/**
 * Lädt alle wartenden Anhänge hoch. Was der Server dauerhaft ablehnt, wird vermerkt und nicht erneut versucht. Fehlt die Verbindung
 * (oder gilt die Anmeldung nicht mehr), bricht der Lauf ab und mit ihm der ganze Abgleich. Ein Serverfehler bei einem einzelnen
 * Anhang hält die Protokolle nicht auf: Er bleibt wartend und kommt beim nächsten Abgleich wieder dran (`failed`).
 */
export async function uploadPendingBlobs(transport: BlobTransport = httpTransport, store: HubDb = db): Promise<{ uploaded: number; rejected: number; failed: number }> {
  let uploaded = 0;
  let rejected = 0;
  let failed = 0;
  for (const meta of await pendingBlobs(store)) {
    const row = await store.blobData.get(meta.id);
    if (!row) {
      await store.blobs.delete(meta.id); // beschädigt: keine Bytes, nichts hochzuladen
      continue;
    }
    try {
      await transport.upload(meta, row.data);
      await markSynced(meta.id, store);
      uploaded++;
    } catch (e) {
      if (!(e instanceof ProtoError) || ABORT.has(e.status)) throw e;
      if (REFUSED.has(e.status)) {
        await markRejected(meta.id, e.message, store);
        rejected++;
      } else {
        failed++;
      }
    }
  }
  return { uploaded, rejected, failed };
}

/** Warum ein Anhang gerade nicht zu haben ist. */
export type Unavailable = 'offline' | 'no-server' | 'missing' | 'error';

export class BlobUnavailable extends Error {
  constructor(
    message: string,
    readonly reason: Unavailable,
  ) {
    super(message);
  }
}

function explain(e: unknown): BlobUnavailable {
  if (e instanceof ProtoError) {
    if (e.status === 0) return e.message.startsWith('Keine Verbindung') ? new BlobUnavailable('Keine Verbindung zum Server.', 'offline') : new BlobUnavailable(e.message, 'no-server');
    if (e.status === 404) return new BlobUnavailable('Der Server hat diesen Anhang nicht (mehr).', 'missing');
    return new BlobUnavailable(e.message, 'error');
  }
  return new BlobUnavailable(e instanceof Error ? e.message : 'Der Anhang konnte nicht geladen werden.', 'error');
}

export interface BlobInfo {
  id: string;
  kind: 'photo' | 'file';
  mime: string;
  name: string;
}

const inflight = new Map<string, Promise<{ meta: LocalBlob; data: Uint8Array }>>();

/** Der Anhang aus dem lokalen Speicher, sonst vom Server (einmal, auch bei gleichzeitigen Anfragen). Wirft `BlobUnavailable`. */
export async function ensureBlob(info: BlobInfo, transport: BlobTransport = httpTransport, store: HubDb = db): Promise<{ meta: LocalBlob; data: Uint8Array }> {
  const have = await readBlob(info.id, store);
  if (have) return have;
  const key = `${store.name}:${info.id}`;
  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      let data: Uint8Array;
      try {
        data = await transport.download(info.id);
      } catch (e) {
        throw explain(e);
      }
      const meta = await saveDownloaded(info, data, store);
      void evictBlobs(CACHE_LIMIT_BYTES, store).catch(() => undefined);
      return { meta, data };
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}
