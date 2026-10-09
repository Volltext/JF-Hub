import type { JSONContent } from '@tiptap/core';
import { db, type HubDb, type SyncCollection } from '@/core/db/db';
import { saveDirectory, type DirectoryUser } from '@/core/account/account';
import { BASE_COLLECTIONS, SYNC_COLLECTIONS, seedOutboxOnce } from '@/core/db/outbox';
import { noteConflicts } from './conflicts';
import { ProtoError, loadConn, request } from './http';
import type { Protokoll } from './model';
import { useSyncStatus } from './syncStatus';

/** Wire-Format, identisch mit `server/src/sync.ts`. */
export interface ClientChange {
  id: string;
  baseRev: number;
  title: string;
  folderId?: string;
  datum: string;
  beginn: string;
  ende: string;
  ort: string;
  leitung: string;
  content: JSONContent;
  updatedAt: number;
  deleted: boolean;
  /** true = für alle Betreuer sichtbar. */
  shared?: boolean;
}

export interface ServerDoc extends Omit<ClientChange, 'baseRev'> {
  rev: number;
  ownerId?: string;
}

export interface FolderChange {
  id: string;
  name: string;
  parentId: string;
  updatedAt: number;
  deleted: boolean;
}

export interface ServerFolder extends FolderChange {
  rev: number;
}

export interface RecordChange {
  collection: SyncCollection;
  id: string;
  data: unknown;
  updatedAt: number;
  deleted: boolean;
  /** Nur Aufgaben: für alle Betreuer sichtbar. */
  shared?: boolean;
}

export interface ServerRecord extends RecordChange {
  rev: number;
  ownerId?: string;
}

export interface SyncRequest {
  since: number;
  epoch?: string;
  changes: ClientChange[];
  folders: FolderChange[];
  records: RecordChange[];
}

/** Eine Änderung, die der Server nicht annimmt; die übrigen sind trotzdem angewendet. */
export interface Rejected {
  kind: 'protocol' | 'folder' | 'record';
  id: string;
  collection?: string;
  reason: string;
}

export interface SyncCounts {
  protocols: number;
  folders: number;
  records: number;
}

export interface SyncResponse {
  rev: number;
  epoch?: string;
  reset?: boolean;
  changes: ServerDoc[];
  folders: ServerFolder[];
  records?: ServerRecord[];
  /** Sammlungen, die der Server annimmt (ab Server 1.6.0; fehlt bei älteren). */
  collections?: string[];
  /** Alle Benutzer des Servers (für „von Anna“). */
  users?: DirectoryUser[];
  counts?: SyncCounts;
  conflicts: { id: string; copyId: string }[];
  /** Ab Server 2.1.0; ältere Server lehnen einen ungültigen Eintrag mit einem Fehler für den ganzen Abgleich ab. */
  rejected?: Rejected[];
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  /** Anzahl der Protokolle, die der Server abgelehnt hat. */
  rejected: number;
  /** Anzahl lokaler Einträge, die dem Server fehlten und neu hochgeladen werden. */
  reuploaded: number;
  counts: SyncCounts | null;
}

export interface SyncOptions {
  /** Alles vom Server neu laden und senden, was dort fehlt. */
  full?: boolean;
}

const REV_KEY = 'protokolle.rev';
const EPOCH_KEY = 'protokolle.epoch';
const RECORDS_KEY = 'protokolle.serverRecords';
const COLLECTIONS_KEY = 'protokolle.serverCollections';

const isKnown = (c: string): c is SyncCollection => (SYNC_COLLECTIONS as string[]).includes(c);

const getRev = async (store: HubDb) => ((await store.kv.get(REV_KEY))?.value as number | undefined) ?? 0;

const toChange = (p: Protokoll): ClientChange => ({
  id: p.id,
  baseRev: p.rev,
  title: p.title,
  folderId: p.folderId ?? '',
  datum: p.datum,
  beginn: p.beginn,
  ende: p.ende,
  ort: p.ort,
  leitung: p.leitung,
  content: p.content,
  updatedAt: p.updatedAt,
  deleted: p.deleted === 1,
  shared: p.shared === true,
});

/**
 * Kern des Abgleichs: sendet lokale Änderungen, übernimmt die Antwort.
 * Wurde ein Eintrag während der Übertragung weiter bearbeitet, bleibt die lokale Fassung erhalten.
 * Passt der Stand nicht zum Server (neue/zurückgesetzte Datenbank), werden Einträge, die dem Server fehlen, neu gesendet.
 */
export async function performSync(send: (req: SyncRequest) => Promise<SyncResponse>, opts: SyncOptions = {}, store: HubDb = db): Promise<SyncResult> {
  const storedEpoch = (await store.kv.get(EPOCH_KEY))?.value as string | undefined;
  // Hat der Server bisher keine Mitglieder/Dienste/Aufgaben unterstützt (alter Stand), einmal komplett abgleichen.
  const hadRecordsBefore = (await store.kv.get(RECORDS_KEY))?.value === true;
  const full = !!opts.full || !hadRecordsBefore;
  const since = full ? 0 : await getRev(store);

  // Was der Server abgelehnt hat, wird nicht bei jedem Abgleich erneut hochgeladen (es bliebe ja abgelehnt); erst nach einer Änderung
  // oder mit „Alles neu abgleichen“ gibt es einen neuen Versuch.
  const dirty = (await store.protokolle.where('dirty').equals(1).toArray()).filter((p) => full || !p.rejected);
  const sentAt = new Map(dirty.map((d) => [d.id, d.updatedAt]));
  const dirtyFolders = await store.folders.where('dirty').equals(1).toArray();
  const folderSentAt = new Map(dirtyFolders.map((f) => [f.id, f.updatedAt]));

  // Nur senden, was der Server annimmt; der Rest bleibt vorgemerkt, bis der Server aktualisiert ist.
  const accepted = new Set(((await store.kv.get(COLLECTIONS_KEY))?.value as SyncCollection[] | undefined) ?? BASE_COLLECTIONS);
  const outbox = (await store.outbox.toArray()).filter((o) => accepted.has(o.collection));
  const outboxSentAt = new Map(outbox.map((o) => [o.key, o.updatedAt]));
  const records: RecordChange[] = [];
  for (const o of outbox) {
    const row = o.deleted ? undefined : await store.table(o.collection).get(o.id);
    const shared = o.collection === 'tasks' ? (row as { shared?: boolean } | undefined)?.shared === true : undefined;
    records.push({ collection: o.collection, id: o.id, data: row ?? {}, updatedAt: o.updatedAt, deleted: !row, ...(shared === undefined ? {} : { shared }) });
  }

  const res = await send({
    since,
    epoch: storedEpoch,
    changes: dirty.map(toChange),
    folders: dirtyFolders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, updatedAt: f.updatedAt, deleted: f.deleted === 1 })),
    records,
  });

  // Ältere Server kennen Mitglieder/Dienste/Aufgaben nicht und lassen `records` weg: Vormerkungen behalten,
  // sonst gingen sie verloren. Sobald der Server aktualisiert ist, wird einmal alles abgeglichen.
  const serverHasRecords = Array.isArray(res.records);
  const reset = !!res.reset || full;
  let reuploaded = 0;
  const nowAccepted = Array.isArray(res.collections) ? SYNC_COLLECTIONS.filter((c) => res.collections!.includes(c)) : [...accepted];

  await store.transaction('rw', [store.protokolle, store.folders, store.outbox, store.members, store.sessions, store.tasks, store.clothing, store.clothingItems, store.runs, store.lineupTemplates, store.kv], async () => {
    for (const f of res.folders ?? []) {
      const local = await store.folders.get(f.id);
      // Ordner: letzte Änderung gewinnt; lokale Änderungen seit dem Senden bleiben bestehen.
      if (local?.dirty === 1 && local.updatedAt !== folderSentAt.get(f.id)) continue;
      if (f.deleted) await store.folders.delete(f.id);
      else await store.folders.put({ id: f.id, name: f.name, parentId: f.parentId, rev: f.rev, updatedAt: f.updatedAt, dirty: 0, deleted: 0 });
    }

    // Kleinste Revision eines Server-Dokuments, das wegen lokaler Bearbeitung nicht übernommen wurde. Der Stand rückt nicht darüber
    // hinaus: Der Server liefert nur Revisionen nach dem Stand, das Dokument käme sonst nie wieder, die lokale Fassung bliebe auf
    // veralteter Basis und jeder weitere Abgleich erzeugte eine neue Konfliktkopie.
    let heldRev = Infinity;
    for (const doc of res.changes) {
      const local = await store.protokolle.get(doc.id);
      if (local?.dirty === 1) {
        const sent = sentAt.get(doc.id);
        if (sent === undefined) {
          // Erst nach dem Senden bearbeitet: der nächste Abgleich schickt die Fassung und bekommt dieses Dokument erneut.
          heldRev = Math.min(heldRev, doc.rev);
          continue;
        }
        if (local.updatedAt !== sent) {
          // Während der Übertragung weiter bearbeitet: auf die neue Server-Revision aufsetzen, wenn unsere Fassung angenommen wurde.
          if (doc.updatedAt === sent) await store.protokolle.update(doc.id, { rev: doc.rev });
          else heldRev = Math.min(heldRev, doc.rev); // fremde Fassung: später übernehmen
          continue;
        }
      }
      if (doc.deleted) {
        await store.protokolle.delete(doc.id);
        continue;
      }
      const { deleted: _deleted, ...fields } = doc;
      void _deleted;
      await store.protokolle.put({ ...fields, dirty: 0, deleted: 0 });
    }

    // Konflikte vormerken, bis die Nutzerin oder der Nutzer sie gesehen hat (der Hinweis im Tooltip war auf dem Handy unsichtbar).
    await noteConflicts(res.conflicts ?? [], store);

    // Vom Server abgelehnte Fassungen merken, solange sie noch genau die gesendete ist (sonst gibt es schon eine neuere).
    for (const r of res.rejected ?? []) {
      if (r.kind !== 'protocol') continue;
      const local = await store.protokolle.get(r.id);
      if (local?.dirty === 1 && local.updatedAt === sentAt.get(r.id)) await store.protokolle.update(r.id, { rejected: r.reason });
    }

    // Mitglieder, Dienste, Aufgaben …: jüngere lokale Änderung (noch nicht gesendet) bleibt, sonst gilt der Server.
    for (const r of res.records ?? []) {
      if (!isKnown(r.collection)) continue; // Sammlung einer neueren App-Version
      const key = `${r.collection}:${r.id}`;
      const ob = await store.outbox.get(key);
      if (ob && ob.updatedAt !== outboxSentAt.get(key)) continue;
      if (r.deleted) await store.table(r.collection).delete(r.id);
      else await store.table(r.collection).put(r.data);
    }
    if (serverHasRecords) {
      for (const [key, at] of outboxSentAt) {
        if ((await store.outbox.get(key))?.updatedAt === at) await store.outbox.delete(key);
      }
    }

    if (reset) {
      // Dem Server fehlt, was er in der Vollauslieferung nicht kannte: erneut hochladen.
      const knownDocs = new Set(res.changes.map((d) => d.id));
      for (const p of await store.protokolle.toArray()) {
        if (knownDocs.has(p.id)) continue;
        if (p.deleted === 1) await store.protokolle.delete(p.id);
        else {
          await store.protokolle.update(p.id, { rev: 0, dirty: 1 });
          reuploaded++;
        }
      }
      const knownFolders = new Set((res.folders ?? []).map((f) => f.id));
      for (const f of await store.folders.toArray()) {
        if (knownFolders.has(f.id)) continue;
        if (f.deleted === 1) await store.folders.delete(f.id);
        else {
          await store.folders.update(f.id, { rev: 0, dirty: 1, updatedAt: Date.now() });
          reuploaded++;
        }
      }
      const knownRecords = new Set((res.records ?? []).map((r) => `${r.collection}:${r.id}`));
      for (const collection of serverHasRecords ? nowAccepted : []) {
        for (const id of (await store.table(collection).toCollection().primaryKeys()) as string[]) {
          const key = `${collection}:${id}`;
          if (knownRecords.has(key) || (await store.outbox.get(key))) continue;
          await store.outbox.put({ key, collection, id, updatedAt: Date.now(), deleted: 0 });
          reuploaded++;
        }
      }
    }

    // Neu angenommene Sammlungen: bisher zurückgehaltene Vormerkungen gleich im nächsten Lauf senden.
    const newlyAccepted = nowAccepted.filter((c) => !accepted.has(c));
    if (serverHasRecords && newlyAccepted.length) {
      reuploaded += await store.outbox.filter((o) => newlyAccepted.includes(o.collection)).count();
    }

    if (res.users) await saveDirectory(res.users, store);
    await store.kv.put({ key: RECORDS_KEY, value: serverHasRecords });
    await store.kv.put({ key: COLLECTIONS_KEY, value: nowAccepted });
    await store.kv.put({ key: REV_KEY, value: Math.min(res.rev, heldRev - 1) });
    if (res.epoch) await store.kv.put({ key: EPOCH_KEY, value: res.epoch });
  });

  return {
    pushed: dirty.length + dirtyFolders.length + records.length,
    pulled: res.changes.length + (res.folders?.length ?? 0) + (res.records?.length ?? 0),
    conflicts: res.conflicts.length,
    rejected: (res.rejected ?? []).filter((r) => r.kind === 'protocol').length,
    reuploaded,
    counts: res.counts ?? null,
  };
}

let running: Promise<SyncResult | null> | null = null;
let again = false;
let againFull = false;

/** Gleicht mit dem Server ab. Läuft nie doppelt; Anfragen während eines Laufs lösen einen weiteren Lauf aus. */
export function syncNow(opts: SyncOptions = {}): Promise<SyncResult | null> {
  if (running) {
    again = true;
    againFull ||= !!opts.full;
    return running;
  }
  const st = useSyncStatus.getState();
  running = (async () => {
    try {
      const conn = await loadConn();
      if (!conn.url || !conn.token) {
        st.set({ state: 'off', message: '' });
        return null;
      }
      st.set({ state: 'syncing', message: '' });
      await seedOutboxOnce();
      const result = await performSync((req) => request<SyncResponse>(conn, 'POST', '/api/sync', req), opts);
      st.set({
        state: 'idle',
        lastSyncAt: Date.now(),
        counts: result.counts ?? st.counts,
        message: [
          result.conflicts ? `${result.conflicts} Konflikt(e): Kopie mit „(Konflikt)“ im Titel angelegt.` : '',
          result.rejected ? `${result.rejected} Protokoll(e) vom Server abgelehnt (zu groß oder ungültig).` : '',
        ]
          .filter(Boolean)
          .join(' '),
      });
      if (result.reuploaded) again = true;
      return result;
    } catch (e) {
      const err = e instanceof ProtoError ? e : new ProtoError('Abgleich fehlgeschlagen.');
      st.set({
        state: err.status === 0 ? 'offline' : err.status === 401 ? 'auth' : 'error',
        message: err.status === 0 ? '' : err.message,
      });
      return null;
    } finally {
      running = null;
      if (again) {
        const full = againFull;
        again = false;
        againFull = false;
        void syncNow({ full });
      }
    }
  })();
  return running;
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Verzögerter Abgleich nach Änderungen (fasst schnelle Folgeänderungen zusammen). */
export function scheduleSync(delayMs = 2500): void {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delayMs);
}
