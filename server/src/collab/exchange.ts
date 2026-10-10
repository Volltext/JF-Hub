import type { DatabaseSync } from 'node:sqlite';
import * as Y from 'yjs';
import { decodeBase64, missingBlobIds, refreshRefs } from '../blobs.js';
import { getEpoch, nextRev, type ProtocolRow } from '../db.js';
import { canSee, MAX_CONTENT, validateContent, type SyncUser } from '../sync.js';
import { ConvertError, yDocToJson } from './convert.js';
import type { Peers } from './peers.js';

/**
 * Austausch des Protokolltextes (Yjs) zwischen App und Server per HTTP.
 *
 * Der Client schickt, was dem Server laut zuletzt bestätigtem Stand fehlt (`update`), und seinen Zustandsvektor (`sv`). Der Server
 * wendet das Update an, speichert den neuen Zustand zusammen mit dem abgeleiteten Inhalt und antwortet mit dem, was dem Client fehlt.
 * Der Austausch ist zustandslos und wiederholbar: Yjs wendet dasselbe Update ein zweites Mal ohne Wirkung an. Ein Raum im Speicher
 * ist dafür nicht nötig.
 */

export interface ExchangeDoc {
  id: string;
  /** Zustandsvektor des Clients (Base64). Fehlt er, hat der Client noch nichts. */
  sv?: string;
  /** Was dem Server fehlt (Base64). */
  update?: string;
  /** Revision des Protokolls bei der letzten Antwort, die der Client angewendet hat. Ist sie unverändert, entfällt die Rechnung. */
  rev?: number;
  /** Der Editor ist offen: Dieses Gerät erscheint bei den anderen als Mitschreibender. */
  live?: boolean;
  /** Der Client hat die Basis des Dokuments aus altem Inhalt gebaut und noch nie eine Bestätigung bekommen. */
  create?: boolean;
}

export interface ExchangeRequest {
  /** Kennung der Datenbank, mit der der Client zuletzt abgeglichen hat. */
  epoch?: string;
  docs: ExchangeDoc[];
}

export type ExchangeStatus =
  /** Angewendet; `update` und `sv` bringen den Client auf den Stand des Servers. */
  | 'ok'
  /** Nicht (mehr) sichtbar, gelöscht oder geleert. */
  | 'gone'
  /** Der Server konnte den Text noch nicht umstellen: nur lesen. */
  | 'legacy'
  /** Der Server hat schon Text mit anderer Geschichte: Der Client sichert seine Fassung als Kopie und übernimmt die des Servers. */
  | 'exists'
  /** Der Server nimmt die Änderung nicht an (`reason`). */
  | 'rejected'
  /** Das Update setzt Unbekanntes voraus: einmal mit dem vollständigen Zustand wiederholen. */
  | 'resync'
  /** Die Antwort wäre zu groß geworden: später noch einmal fragen. */
  | 'deferred';

export interface ExchangeResult {
  id: string;
  status: ExchangeStatus;
  /** Was dem Client fehlt (Base64); fehlt, wenn es nichts gibt. */
  update?: string;
  /** Zustandsvektor des Servers nach dem Anwenden (Base64). */
  sv?: string;
  rev?: number;
  /** Nutzer-IDs, die das Protokoll gerade geöffnet haben (nur bei `live`). */
  peers?: string[];
  /** Anhänge, auf die das Protokoll verweist und die der Server nicht hat. */
  missingBlobs?: string[];
  reason?: string;
}

export interface ExchangeResponse {
  epoch: string;
  /** true: Der Stand des Clients passt nicht zu dieser Datenbank (ersetzt/wiederhergestellt). Nichts wurde angewendet. */
  reset?: boolean;
  docs: ExchangeResult[];
}

export const LIMITS = {
  /** Dokumente je Anfrage; weitere kommen als `deferred` zurück. */
  maxDocs: 20,
  /** Größe des gespeicherten Zustands und eines Updates in Byte. */
  maxState: 12 * 1024 * 1024,
  maxUpdate: 12 * 1024 * 1024,
  /**
   * Summe der Antwort in Base64-Zeichen; das erste Dokument kommt immer vollständig. Ein Dokument, das noch vor dem Ende des Budgets
   * drankommt, wird ganz geliefert, auch wenn es das Budget sprengt (die Antwort ist dann höchstens um ein Dokument größer).
   */
  responseBudget: 8 * 1024 * 1024,
  /** Wie lange eine Anfrage rechnen darf, bevor weitere Dokumente auf später verschoben werden (das erste kommt immer). */
  maxMs: 2500,
};

export type Limits = typeof LIMITS;

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const EMPTY_SV = Y.encodeStateVector(new Y.Doc());
const MAX_SV_CHARS = 256 * 1024;

const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
/** Ein Update ohne Inhalt (keine Strukturen, keine Löschungen) besteht aus zwei Nullen. */
const isEmptyUpdate = (u: Uint8Array): boolean => u.length === 2 && u[0] === 0 && u[1] === 0;

/** Haben Update und Server Teile derselben Geschichte (mindestens eine gemeinsame Client-Kennung)? */
function sharesHistory(update: Uint8Array, serverSv: Uint8Array): boolean {
  const mine = Y.decodeStateVector(Y.encodeStateVectorFromUpdate(update));
  const theirs = Y.decodeStateVector(serverSv);
  for (const [client, clock] of mine) if (clock > 0 && (theirs.get(client) ?? 0) > 0) return true;
  return false;
}

type Stored = { state: Uint8Array; sv: Uint8Array };

type Applied =
  | { kind: 'unchanged' }
  | { kind: 'resync' }
  | { kind: 'rejected'; reason: string }
  | { kind: 'changed'; state: Uint8Array; sv: Uint8Array; json: unknown; content: string };

/** Wendet das Update auf den gespeicherten Zustand an und leitet den Inhalt ab. Schreibt nichts. */
function apply(stored: Stored | undefined, update: Uint8Array, limits: Limits): Applied {
  const doc = new Y.Doc();
  let changed = false;
  try {
    if (stored) Y.applyUpdate(doc, stored.state);
    doc.on('update', () => {
      changed = true; // auch eine reine Löschung ändert den Zustandsvektor nicht, löst aber dieses Ereignis aus
    });
    Y.applyUpdate(doc, update);
  } catch {
    return { kind: 'rejected', reason: 'ungültige Änderung' };
  }
  // Fehlt dem Server etwas, worauf das Update aufbaut, hält Yjs es zurück: Es gehört nicht in den Zustand.
  if (doc.store.pendingStructs !== null || doc.store.pendingDs !== null) return { kind: 'resync' };
  if (!changed) return { kind: 'unchanged' };
  const state = Y.encodeStateAsUpdate(doc);
  if (state.length > limits.maxState) return { kind: 'rejected', reason: 'Protokoll zu groß' };
  let json: unknown;
  try {
    json = yDocToJson(doc);
  } catch (e) {
    return { kind: 'rejected', reason: e instanceof ConvertError ? e.message : 'ungültiger Inhalt' };
  }
  const invalid = validateContent(json);
  if (invalid) return { kind: 'rejected', reason: invalid };
  const content = JSON.stringify(json);
  if (content.length > MAX_CONTENT) return { kind: 'rejected', reason: 'Protokoll zu groß' };
  return { kind: 'changed', state, sv: Y.encodeStateVector(doc), json, content };
}

function one(db: DatabaseSync, d: ExchangeDoc, user: SyncUser, peers: Peers, now: number, limits: Limits): ExchangeResult {
  const id = typeof d?.id === 'string' ? d.id : '';
  const reject = (reason: string): ExchangeResult => ({ id, status: 'rejected', reason });
  if (!ID_RE.test(id)) return reject('ungültige ID');

  let clientSv = EMPTY_SV;
  if (d.sv !== undefined && d.sv !== '') {
    const bytes = typeof d.sv === 'string' && d.sv.length <= MAX_SV_CHARS ? decodeBase64(d.sv) : null;
    if (!bytes) return reject('ungültiger Zustandsvektor');
    try {
      Y.decodeStateVector(bytes);
    } catch {
      return reject('ungültiger Zustandsvektor');
    }
    clientSv = bytes;
  }
  let update: Uint8Array | undefined;
  if (d.update !== undefined && d.update !== '') {
    if (typeof d.update !== 'string' || d.update.length > Math.ceil((limits.maxUpdate * 4) / 3) + 8) return reject('Änderung zu groß');
    const bytes = decodeBase64(d.update);
    if (!bytes) return reject('ungültige Änderung');
    update = bytes;
  }

  const row = db.prepare('SELECT id, shared, ownerId, deletedAt, purgedAt, ymode, rev FROM protocols WHERE id = ?').get(id) as
    | Pick<ProtocolRow, 'id' | 'shared' | 'ownerId' | 'deletedAt' | 'purgedAt' | 'ymode' | 'rev'>
    | undefined;
  if (!row || row.deletedAt !== null || row.purgedAt !== null || !canSee(row, user)) return { id, status: 'gone' };
  if (row.ymode !== 1) return { id, status: 'legacy' };

  let current = db.prepare('SELECT state, sv FROM ydocs WHERE id = ?').get(id) as Stored | undefined;
  let rev = row.rev;
  let missingBlobs: string[] | undefined;

  if (update && !isEmptyUpdate(update)) {
    try {
      // Eine Basis aus altem Inhalt wird nur angenommen, wenn der Server noch keinen Text hat oder der Client ihn selbst geschickt hat.
      if (d.create && current && Y.decodeStateVector(current.sv).size > 0 && !sharesHistory(update, current.sv)) return { id, status: 'exists' };
    } catch {
      return reject('ungültige Änderung');
    }
    const applied = apply(current, update, limits);
    if (applied.kind === 'rejected') return reject(applied.reason);
    if (applied.kind === 'resync') return { id, status: 'resync' };
    if (applied.kind === 'changed') {
      db.exec('SAVEPOINT exchange');
      try {
        rev = nextRev(db);
        db.prepare(
          `INSERT INTO ydocs(id, state, sv, updatedAt) VALUES(?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET state = excluded.state, sv = excluded.sv, updatedAt = excluded.updatedAt`,
        ).run(id, applied.state, applied.sv, now);
        db.prepare('UPDATE protocols SET content = ?, rev = ?, updatedAt = ? WHERE id = ?').run(applied.content, rev, now, id);
        refreshRefs(db, id, applied.json);
        db.exec('RELEASE exchange');
      } catch (e) {
        db.exec('ROLLBACK TO exchange');
        db.exec('RELEASE exchange');
        return reject(e instanceof Error ? e.message : 'unbekannter Fehler');
      }
      current = { state: applied.state, sv: applied.sv };
      missingBlobs = missingBlobIds(db, [id]);
    }
  } else if (d.rev !== undefined && d.rev === row.rev) {
    // Seit der letzten Antwort hat sich beim Server nichts geändert (jede Änderung erhöht die Revision): nichts zu rechnen.
    const result: ExchangeResult = { id, status: 'ok', rev };
    if (d.live) {
      peers.touch(id, user.id, now);
      result.peers = peers.list(id, user.id, now);
    }
    return result;
  }

  const result: ExchangeResult = { id, status: 'ok', rev, sv: b64(current?.sv ?? EMPTY_SV) };
  if (current) {
    const diff = Y.diffUpdate(current.state, clientSv);
    if (!isEmptyUpdate(diff)) result.update = b64(diff);
  }
  if (missingBlobs?.length) result.missingBlobs = missingBlobs;
  if (d.live) {
    peers.touch(id, user.id, now);
    result.peers = peers.list(id, user.id, now);
  }
  return result;
}

/** Wendet die Austauschanfrage eines Nutzers an und liefert, was seine Geräte brauchen. */
export function exchange(db: DatabaseSync, req: ExchangeRequest, user: SyncUser, peers: Peers, now = Date.now(), limits: Limits = LIMITS): ExchangeResponse {
  const epoch = getEpoch(db);
  if (req.epoch !== undefined && req.epoch !== epoch) return { epoch, reset: true, docs: [] };
  const docs = Array.isArray(req.docs) ? req.docs : [];
  const results: ExchangeResult[] = [];
  let budget = limits.responseBudget;
  const started = performance.now();
  docs.forEach((d, index) => {
    const id = typeof d?.id === 'string' ? d.id : '';
    // Was nicht mehr drankommt (zu viele Dokumente, Budget oder Zeit verbraucht), wird gar nicht erst angefasst: Es käme sonst angewendet
    // und doch ohne Antwort zurück. Das Gerät fragt beim nächsten Mal wieder. Das erste Dokument kommt immer dran.
    if (index >= limits.maxDocs || (index > 0 && (budget <= 0 || performance.now() - started >= limits.maxMs))) {
      results.push({ id, status: 'deferred' });
      return;
    }
    let result: ExchangeResult;
    try {
      result = one(db, d, user, peers, now, limits);
    } catch (e) {
      result = { id, status: 'rejected', reason: e instanceof Error ? e.message : 'unbekannter Fehler' };
    }
    budget -= (result.update?.length ?? 0) + (result.sv?.length ?? 0);
    results.push(result);
  });
  return { epoch, docs: results };
}
