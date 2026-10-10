import type { JSONContent } from '@tiptap/core';
import * as Y from 'yjs';
import { db, type HubDb, type SyncCollection, type YDocRow } from '@/core/db/db';
import { saveDirectory, type DirectoryUser } from '@/core/account/account';
import { rejectedBlobCount, requeueBlobs, retryBlobsNow } from '@/core/db/blobs';
import { BASE_COLLECTIONS, SYNC_COLLECTIONS, seedOutboxOnce } from '@/core/db/outbox';
import { jsonEqual } from '@/core/domain/equal';
import { httpTransport, uploadPendingBlobs, type BlobTransport } from './blobSync';
import { ensureBases, exchangeInBackground, type BackgroundResult } from './collab/background';
import { saveLocalCopy } from './collab/localCopy';
import { getOpenSession, isSessionOpen, openSessions } from './collab/session';
import { EPOCH_KEY, httpExchange, type ExchangeTransport } from './collab/wire';
import { noteConflicts } from './conflicts';
import { ProtoError, loadConn, request } from './http';
import { MIN_SERVER_API } from './schemaVersion';
import { META_FIELDS, type MetaAt, type MetaField, type Protokoll } from './model';
import { useSyncStatus } from './syncStatus';

/**
 * Wire-Format, identisch mit `server/src/sync.ts`. Der Abgleich der Protokolle überträgt nur die Kopfdaten; der Text geht getrennt
 * über den Austausch des Yjs-Dokuments (`collab/`).
 */
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
  /** Wann welches Feld zuletzt hier geändert wurde: Der Server führt die Felder einzeln zusammen, die jüngere Änderung gewinnt. */
  metaAt: MetaAt;
  updatedAt: number;
  deleted: boolean;
  /** true = für alle Betreuer sichtbar. */
  shared?: boolean;
}

export interface ServerDoc extends Omit<ClientChange, 'baseRev' | 'metaAt'> {
  rev: number;
  ownerId?: string;
  /** Schnappschuss des Textes (Liste, Suche, Nur-lesen-Ansicht). */
  content: JSONContent;
  /** 1 = der Text liegt als Yjs-Dokument beim Server; 0 = noch nicht umgestellt (nur lesen). */
  ymode?: number;
  metaAt?: MetaAt;
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
  /** Kopfdaten der Protokolle. Das Feld heißt nicht `changes`, damit ein Server vor 3.0.0 es ignoriert, statt Protokolle mit leerem Text zu speichern. */
  protocols: ClientChange[];
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
  /** Schnittstelle des Servers (ab 2.1.0; fehlt bei älteren: 1). */
  api?: number;
  /** Seit 3.0.0 leer: Fehlende Anhänge meldet der Austausch des Textes. */
  missingBlobs?: string[];
}

export interface SyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  /** Anzahl der Protokolle, die der Server abgelehnt hat. */
  rejected: number;
  /** Anhänge dieses Laufs: hochgeladen, vom Server abgelehnt, wegen eines Serverfehlers noch wartend. */
  blobs: { uploaded: number; rejected: number; failed: number };
  /** Anzahl lokaler Einträge, die dem Server fehlten und neu hochgeladen werden. */
  reuploaded: number;
  counts: SyncCounts | null;
  /** Der Austausch der Texte im Anschluss; `null`, wenn er nicht lief (kein Netz). */
  text: BackgroundResult | null;
}

export interface SyncOptions {
  /** Alles vom Server neu laden und senden, was dort fehlt. */
  full?: boolean;
}

const REV_KEY = 'protokolle.rev';
const RECORDS_KEY = 'protokolle.serverRecords';
const COLLECTIONS_KEY = 'protokolle.serverCollections';

const isKnown = (c: string): c is SyncCollection => (SYNC_COLLECTIONS as string[]).includes(c);

const getRev = async (store: HubDb) => ((await store.kv.get(REV_KEY))?.value as number | undefined) ?? 0;

/**
 * Änderungszeit je Kopffeld, soweit dieses Gerät das Feld selbst geändert (oder vom Server mit Zeit übernommen) hat. Ein Feld ohne Zeit
 * erhebt keinen Anspruch und wird vom Server nicht angefasst: Eine Ersatzzeit wie die der Zeile rückt mit jeder Textänderung vor und
 * würde Änderungen anderer Geräte an Feldern überstimmen, die dieses Gerät nie geändert hat.
 */
const timesOf = (p: Protokoll): MetaAt => Object.fromEntries(META_FIELDS.filter((f) => p.metaAt?.[f] !== undefined).map((f) => [f, p.metaAt![f]])) as MetaAt;

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
  metaAt: timesOf(p),
  updatedAt: p.updatedAt,
  deleted: p.deleted === 1,
  shared: p.shared === true,
});

/** Wert eines Kopffeldes in der Form, in der verglichen wird (wie beim Server: Sichtbarkeit als 0/1, fehlender Ordner als ''). */
function valueOf(p: Pick<Protokoll, MetaField>, f: MetaField): string | number {
  if (f === 'shared') return p.shared === true ? 1 : 0;
  if (f === 'folderId') return p.folderId ?? '';
  return p[f];
}

/**
 * Bevor der Zustand eines Textes verworfen wird: Was ein offener Editor noch nicht gesichert hat, kommt dazu (es steht nur im Speicher
 * des Editors). Liefert 1, wenn der Text ungesendete Änderungen hat und eine Kopie verdient, sonst 0.
 */
async function withPendingOfEditor(id: string, text: YDocRow, store: HubDb): Promise<0 | 1> {
  const extra = getOpenSession(id)?.takePending();
  if (extra) await store.ydocs.put({ ...text, update: Y.mergeUpdates([text.update, extra]), dirty: 1, seq: text.seq + 1 });
  return extra || text.dirty === 1 ? 1 : 0;
}

/**
 * Führt die Kopfdaten eines Server-Dokuments mit der lokalen Zeile zusammen, Feld für Feld wie der Server: Es gewinnt die jüngere
 * Änderung, bei Gleichstand der größere Wert (damit alle Geräte gleich entscheiden). Ist die lokale Zeile nicht vorgemerkt, gilt der Server.
 * `pending` sagt, ob lokal noch etwas steht, das der Server nicht hat.
 */
export function mergeHeader(local: Protokoll | undefined, doc: ServerDoc): { fields: Pick<Protokoll, MetaField>; metaAt: MetaAt; pending: boolean } {
  const server = doc as Pick<Protokoll, MetaField>;
  const fields = {} as Record<MetaField, unknown>;
  const metaAt: MetaAt = {};
  let pending = false;
  for (const f of META_FIELDS) {
    const st = doc.metaAt?.[f] ?? 0;
    const sv = valueOf(server, f);
    if (local && local.dirty === 1) {
      const lv = valueOf(local, f);
      const lt = local.metaAt?.[f]; // ohne eigene Zeit hat dieses Gerät das Feld nie geändert: Es gilt der Server
      if (lt !== undefined && lv !== sv && (lt > st || (lt === st && lv > sv))) {
        fields[f] = local[f];
        metaAt[f] = lt;
        pending = true;
        continue;
      }
    }
    fields[f] = f === 'shared' ? doc.shared === true : f === 'folderId' ? (doc.folderId ?? '') : doc[f];
    if (doc.metaAt?.[f] !== undefined) metaAt[f] = st;
  }
  return { fields: fields as Pick<Protokoll, MetaField>, metaAt, pending };
}

/**
 * Kern des Abgleichs: sendet lokale Änderungen, übernimmt die Antwort.
 * Wurde ein Eintrag während der Übertragung weiter bearbeitet, bleibt die lokale Fassung erhalten.
 * Passt der Stand nicht zum Server (neue/zurückgesetzte Datenbank), werden Einträge, die dem Server fehlen, neu gesendet.
 */
export async function performSync(
  send: (req: SyncRequest) => Promise<SyncResponse>,
  opts: SyncOptions = {},
  store: HubDb = db,
  blobTransport: BlobTransport = httpTransport,
  textTransport: ExchangeTransport = httpExchange(async () => (await store.kv.get(EPOCH_KEY))?.value as string | undefined),
): Promise<SyncResult> {
  // Zuerst die Anhänge: Ein Protokoll soll beim Server möglichst nie auf einen Anhang zeigen, den es noch nicht gibt. Was sich nicht
  // hochladen lässt, hält die Protokolle aber nicht auf. Mit „Alles neu abgleichen“ bekommen auch abgelehnte Anhänge einen neuen Versuch.
  if (opts.full) await retryBlobsNow(store);
  const blobs = await uploadPendingBlobs(blobTransport, store);
  // Protokolle aus der Zeit vor 3.0.0, die der Server nie bekommen hat, brauchen ihre Basis, bevor sie eine Revision haben.
  await ensureBases(store);

  const storedEpoch = (await store.kv.get(EPOCH_KEY))?.value as string | undefined;
  // Hat der Server bisher keine Mitglieder/Dienste/Aufgaben unterstützt (alter Stand), einmal komplett abgleichen.
  const hadRecordsBefore = (await store.kv.get(RECORDS_KEY))?.value === true;
  const full = !!opts.full || !hadRecordsBefore;
  const since = full ? 0 : await getRev(store);

  // Was der Server abgelehnt hat, wird nicht bei jedem Abgleich erneut hochgeladen (es bliebe ja abgelehnt); erst nach einer Änderung
  // oder mit „Alles neu abgleichen“ gibt es einen neuen Versuch.
  const dirty = (await store.protokolle.where('dirty').equals(1).toArray()).filter((p) => full || !p.rejected);
  const sentTimes = new Map(dirty.map((d) => [d.id, timesOf(d)]));
  const sentDeleted = new Set(dirty.filter((d) => d.deleted === 1).map((d) => d.id));
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
    protocols: dirty.map(toChange),
    folders: dirtyFolders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId, updatedAt: f.updatedAt, deleted: f.deleted === 1 })),
    records,
  });

  // Ein Server mit älterer Schnittstelle versteht diese App-Version nicht (sie würde ihm Inhalte schicken, die er verwirft).
  if ((res.api ?? 1) < MIN_SERVER_API) throw new ProtoError('Der Server ist zu alt für diese App-Version. Bitte den Server aktualisieren.', 426);

  // Ältere Server kennen Mitglieder/Dienste/Aufgaben nicht und lassen `records` weg: Vormerkungen behalten,
  // sonst gingen sie verloren. Sobald der Server aktualisiert ist, wird einmal alles abgeglichen.
  const serverHasRecords = Array.isArray(res.records);
  /** Die Datenbank des Servers ist eine andere als beim letzten Abgleich (ersetzt, wiederhergestellt): ihr Stand zählt, nicht der hier gemerkte. */
  const epochChanged = !!res.reset;
  const reset = epochChanged || full;
  let reuploaded = 0;
  const nowAccepted = Array.isArray(res.collections) ? SYNC_COLLECTIONS.filter((c) => res.collections!.includes(c)) : [...accepted];

  await store.transaction('rw', [store.protokolle, store.ydocs, store.folders, store.outbox, store.members, store.sessions, store.tasks, store.clothing, store.clothingItems, store.runs, store.lineupTemplates, store.kv], async () => {
    for (const f of res.folders ?? []) {
      const local = await store.folders.get(f.id);
      // Ordner: letzte Änderung gewinnt; lokale Änderungen seit dem Senden bleiben bestehen.
      if (local?.dirty === 1 && local.updatedAt !== folderSentAt.get(f.id)) continue;
      if (f.deleted) await store.folders.delete(f.id);
      else await store.folders.put({ id: f.id, name: f.name, parentId: f.parentId, rev: f.rev, updatedAt: f.updatedAt, dirty: 0, deleted: 0 });
    }

    // Kopfdaten der Protokolle. Jedes Feld zählt für sich (siehe `mergeHeader`): Eine lokale Änderung bleibt, wo sie jünger ist, und geht
    // beim nächsten Abgleich hoch; sonst gilt der Server. Der Text kommt nicht von hier, sondern über den Austausch danach.
    for (const doc of res.changes) {
      const local = await store.protokolle.get(doc.id);
      const text = await store.ydocs.get(doc.id);
      if (doc.deleted) {
        // Gelöscht oder zurückgezogen. Ungesendete Änderungen am Text bleiben als eigenes, privates Protokoll erhalten
        // (ein Protokoll, das hier selbst gelöscht wurde, zählt nicht).
        if (text && local && local.deleted !== 1 && (await withPendingOfEditor(doc.id, text, store)) === 1) await saveLocalCopy(doc.id, {}, store);
        await store.protokolle.delete(doc.id);
        await store.ydocs.delete(doc.id);
        continue;
      }
      if (local?.deleted === 1 && !sentDeleted.has(doc.id)) continue; // hier gerade gelöscht, der nächste Abgleich meldet es
      if (epochChanged && text) {
        // Eine andere Datenbank: Der Text des Servers gilt, nicht der hier gemerkte Stand (sonst käme zurück, was die Wiederherstellung entfernt hat).
        if (local && local.deleted !== 1 && (await withPendingOfEditor(doc.id, text, store)) === 1) await saveLocalCopy(doc.id, {}, store);
        await store.ydocs.delete(doc.id);
      }
      const merged = mergeHeader(local?.deleted === 1 ? undefined : local, doc);
      // Der Schnappschuss des Servers ersetzt den lokalen nur, wenn hier nichts Ungesendetes oder in Arbeit ist (bei einer neuen Datenbank immer).
      const keepsText = !epochChanged && (isSessionOpen(doc.id) || text?.dirty === 1);
      await store.protokolle.put({
        id: doc.id,
        ...merged.fields,
        datum: merged.fields.datum,
        content: keepsText && local ? local.content : doc.content,
        ownerId: doc.ownerId,
        rev: doc.rev,
        updatedAt: merged.pending && local ? local.updatedAt : doc.updatedAt,
        dirty: merged.pending ? 1 : 0,
        metaAt: merged.metaAt,
        deleted: 0,
        ...(doc.ymode === 0 ? { legacy: true } : {}),
        ...(local?.textRev !== undefined && !epochChanged && !(local.deleted === 1) ? { textRev: local.textRev } : {}),
        ...(merged.pending && local?.rejected ? { rejected: local.rejected } : {}),
      });
    }

    // Konflikte vormerken, bis die Nutzerin oder der Nutzer sie gesehen hat (der Hinweis im Tooltip war auf dem Handy unsichtbar).
    await noteConflicts(res.conflicts ?? [], store);

    // Vom Server abgelehnte Fassungen merken, solange sie noch genau die gesendete ist (sonst gibt es schon eine neuere).
    for (const r of res.rejected ?? []) {
      if (r.kind !== 'protocol') continue;
      const local = await store.protokolle.get(r.id);
      const sent = sentTimes.get(r.id);
      if (local?.dirty === 1 && sent && jsonEqual(timesOf(local), sent)) await store.protokolle.update(r.id, { rejected: r.reason });
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
        if (p.deleted === 1) {
          await store.protokolle.delete(p.id);
          await store.ydocs.delete(p.id);
        } else {
          // Der Server kennt das Protokoll nicht: Kopfdaten und der ganze Text gehen als neu hoch.
          await store.protokolle.update(p.id, { rev: 0, dirty: 1, textRev: undefined });
          const text = await store.ydocs.get(p.id);
          if (text) await store.ydocs.put({ ...text, serverSv: undefined, dirty: 1, seq: text.seq + 1 });
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
    await store.kv.put({ key: REV_KEY, value: res.rev });
    if (res.epoch) await store.kv.put({ key: EPOCH_KEY, value: res.epoch });
  });

  // Der Text: eigene Änderungen senden, Änderungen anderer holen, neue Texte vorladen. Ein Fehler hier (kein Netz) macht den Abgleich der
  // Kopfdaten, der gerade gelungen ist, nicht ungeschehen.
  let text: BackgroundResult | null = null;
  try {
    // Ein offener Editor tauscht seinen Text selbst aus; wer „Abgleichen“ wählt, erwartet aber, dass auch er jetzt ankommt.
    for (const open of openSessions()) await open.exchangeNow().catch(() => undefined);
    text = await exchangeInBackground({ store, transport: textTransport });
  } catch (e) {
    if (e instanceof ProtoError && e.status !== 0) throw e;
  }

  // Der Server vermisst Anhänge, auf die ein soeben gesendeter Text verweist (aufgeräumt, Datenbank ersetzt): Hat dieses Gerät sie noch,
  // gehen sie im nächsten Lauf hoch.
  reuploaded += await requeueBlobs(text?.missingBlobs ?? [], store);

  return {
    pushed: dirty.length + dirtyFolders.length + records.length + (text?.sent ?? 0),
    pulled: res.changes.length + (res.folders?.length ?? 0) + (res.records?.length ?? 0) + (text?.exchanged ?? 0),
    conflicts: (res.conflicts ?? []).length,
    rejected: (res.rejected ?? []).filter((r) => r.kind === 'protocol').length + (text?.rejected ?? 0),
    blobs,
    reuploaded,
    counts: res.counts ?? null,
    text,
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
      const stuck = await rejectedBlobCount(); // bleibt im Hinweis stehen, solange es solche Anhänge gibt, nicht nur in dem Lauf, der sie abgelehnt hat
      st.set({
        state: 'idle',
        lastSyncAt: Date.now(),
        counts: result.counts ?? st.counts,
        message: [
          result.conflicts ? `${result.conflicts} Konflikt(e): Kopie mit „(Konflikt)“ im Titel angelegt.` : '',
          result.rejected ? `${result.rejected} Protokoll(e) vom Server abgelehnt (zu groß oder ungültig).` : '',
          result.text?.copies ? `${result.text.copies} Protokolltext(e) ließen sich nicht mehr abgleichen (gelöscht oder zurückgezogen). Deine Änderungen liegen als Kopie „(lokale Fassung)“ vor.` : '',
          stuck ? `${stuck} Anhang/Anhänge vom Server abgelehnt (zu groß oder kein gültiges Foto; bei einem eigenen Proxy die maximale Anfragegröße prüfen). „Alles neu abgleichen“ versucht es erneut.` : '',
          result.blobs.failed ? `${result.blobs.failed} Anhang/Anhänge konnten noch nicht hochgeladen werden, der Abgleich versucht es später erneut.` : '',
        ]
          .filter(Boolean)
          .join(' '),
      });
      // Es steht noch Text aus (mehr als ein Lauf fasst) oder die Datenbank des Servers wurde mitten im Lauf ersetzt: gleich noch einmal.
      if (result.reuploaded || (result.text && (result.text.reset || (result.text.remaining > 0 && result.text.exchanged > 0)))) again = true;
      return result;
    } catch (e) {
      // Was kein Verbindungs- oder Serverfehler ist (etwa ein Speicherfehler auf dem Gerät), soll nicht als „Offline“ untergehen.
      const err = e instanceof ProtoError ? e : new ProtoError('Abgleich fehlgeschlagen.', 500);
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
