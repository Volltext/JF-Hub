import { CACHE_LIMIT_BYTES, evictBlobs, markFailed, markRejected, markSynced, pendingBlobs, readBlob, saveDownloaded } from '@/core/db/blobs';
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

/** Der Server lehnt diesen Anhang ab (zu groß, kein JPEG, Kennung vergeben, in der Demo nicht erlaubt …): kein weiterer Versuch, bis jemand „Alles neu abgleichen“ wählt. */
const REFUSED = new Set([400, 403, 409, 413, 415, 422]);

/**
 * Lädt die wartenden Anhänge hoch, die kleinsten zuerst. Das darf die Protokolle nie aufhalten, deshalb wirft es nur, wenn der Server
 * diese App-Version gar nicht kennt (426: dorthin soll nichts gesendet werden). Sonst gilt:
 * - Der Server lehnt den Anhang ab: vermerkt und nicht erneut versucht (`rejected`).
 * - Offline, abgemeldet oder gedrosselt: weitere Versuche in diesem Lauf sind zwecklos, die übrigen bleiben wartend.
 * - Zeitlimit oder Serverfehler: Der Anhang pausiert mit wachsender Pause (bis zu einer Stunde) und blockiert so weder den Abgleich
 *   noch bei jedem Lauf zwei Minuten Wartezeit (`failed`).
 */
export function uploadPendingBlobs(transport: BlobTransport = httpTransport, store: HubDb = db, now = Date.now()): Promise<UploadResult> {
  // Läufe kommen von zwei Seiten (der offene Editor vor jedem Senden, der Abgleich) und können sich überschneiden, vor allem bei einem
  // langsamen Upload. Sie laufen hintereinander: Ein zweiter Lauf lädt nicht noch einmal hoch, was der erste gerade sendet, und kehrt erst
  // zurück, wenn auch alles Wartende von vorhin oben ist.
  const run = (running.get(store) ?? Promise.resolve()).then(
    () => uploadAll(transport, store, now),
    () => uploadAll(transport, store, now),
  );
  running.set(store, run);
  return run;
}

type UploadResult = { uploaded: number; rejected: number; failed: number };
const running = new WeakMap<HubDb, Promise<unknown>>();

async function uploadAll(transport: BlobTransport, store: HubDb, now: number): Promise<UploadResult> {
  let uploaded = 0;
  let rejected = 0;
  let failed = 0;
  const queue = (await pendingBlobs(store, now)).sort((a, b) => a.size - b.size);
  for (const meta of queue) {
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
      if (!(e instanceof ProtoError)) throw e;
      if (e.status === 426) throw e;
      if (REFUSED.has(e.status)) {
        await markRejected(meta.id, e.message, store);
        rejected++;
        continue;
      }
      failed++;
      if (e.status === 401 || e.status === 429 || (e.status === 0 && !e.timedOut)) break;
      await markFailed(meta.id, store, now);
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
    if (e.status === 0) {
      if (e.timedOut) return new BlobUnavailable(e.message, 'offline');
      return e.message.startsWith('Keine Verbindung') ? new BlobUnavailable('Keine Verbindung zum Server.', 'offline') : new BlobUnavailable(e.message, 'no-server');
    }
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
  /** Die Größe, die das Protokoll angibt (Dateien): Eine Antwort, die nicht passt, ist keine Datei, sondern etwa eine Fehlerseite. */
  size?: number;
}

/** Ist das, was der Server geliefert hat, plausibel? Sonst würde zum Beispiel eine Fehlerseite eines Proxys dauerhaft als Foto gemerkt. */
function plausible(info: BlobInfo, data: Uint8Array): boolean {
  if (info.kind === 'photo') return data.length >= 4 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  return data.length > 0 && (!info.size || data.length === info.size);
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
      if (!plausible(info, data)) throw new BlobUnavailable(info.kind === 'photo' ? 'Der Server hat kein gültiges Foto geliefert.' : 'Die Datei ist nicht vollständig angekommen.', 'error');
      const meta = await saveDownloaded(info, data, store);
      void evictBlobs(CACHE_LIMIT_BYTES, store).catch(() => undefined);
      return { meta, data };
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}
