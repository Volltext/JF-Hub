import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { currentRev, getEpoch, getSettings, nextRev, type FolderRow, type ProtocolRow, type RecordRow, type Role } from './db.js';

/** Wer synchronisiert (aus der Sitzung). */
export interface SyncUser {
  id: string;
  role: Role;
}

/** Änderung eines Clients. `baseRev` ist die Server-Revision, auf der die Bearbeitung beruht (0 = neu). */
export interface ClientChange {
  id: string;
  baseRev: number;
  title: string;
  /** '' oder fehlend = oberste Ebene. */
  folderId?: string;
  datum: string;
  beginn: string;
  ende: string;
  ort: string;
  leitung: string;
  content: unknown;
  updatedAt: number;
  deleted: boolean;
  /** true = für alle Betreuer sichtbar. Nur der Besitzer kann das ändern. */
  shared?: boolean;
}

export interface ClientFolder {
  id: string;
  name: string;
  parentId: string;
  updatedAt: number;
  deleted: boolean;
}

export interface ServerFolder extends ClientFolder {
  rev: number;
}

/**
 * Erlaubte Sammlungen für die allgemeine Synchronisation (Mitglieder, Dienste, Aufgaben, Kleidergrößen, Wettkampf-Läufe und Aufstellungsvorlagen).
 * Die Liste geht in jeder Antwort mit, damit die App nur sendet, was dieser Server annimmt.
 */
export const COLLECTIONS = ['members', 'sessions', 'tasks', 'clothing', 'clothingItems', 'runs', 'lineupTemplates'];

/** Sammlungen, deren Einträge privat sein können. Alle anderen gehören der ganzen Gruppe. */
export const PRIVATE_CAPABLE = ['tasks'];

export interface ClientRecord {
  collection: string;
  id: string;
  data: unknown;
  updatedAt: number;
  deleted: boolean;
  /** Nur für Sammlungen aus `PRIVATE_CAPABLE`. */
  shared?: boolean;
}

export interface ServerRecord extends ClientRecord {
  rev: number;
  ownerId: string;
}

export interface SyncRequest {
  since: number;
  /** Kennung der Datenbank, mit der der Client zuletzt abgeglichen hat. */
  epoch?: string;
  changes: ClientChange[];
  folders?: ClientFolder[];
  records?: ClientRecord[];
}

export interface ServerDoc {
  id: string;
  title: string;
  folderId: string;
  datum: string;
  beginn: string;
  ende: string;
  ort: string;
  leitung: string;
  content: unknown;
  shared: boolean;
  ownerId: string;
  rev: number;
  updatedAt: number;
  deleted: boolean;
}

export interface DirectoryUser {
  id: string;
  name: string;
}

export interface SyncResponse {
  rev: number;
  epoch: string;
  /** true: Stand des Clients passte nicht – es wurde alles neu ausgeliefert. */
  reset: boolean;
  changes: ServerDoc[];
  folders: ServerFolder[];
  records: ServerRecord[];
  /** Sammlungen, die dieser Server annimmt. */
  collections: string[];
  /** Alle Benutzer (für „von …“-Anzeigen). */
  users: DirectoryUser[];
  /** Anzahl Einträge auf dem Server, soweit für den Nutzer sichtbar (zur Kontrolle in der App). */
  counts: { protocols: number; folders: number; records: number };
  /** Eigene Fassung des Clients wurde als Kopie `copyId` gesichert, weil der Server eine neuere hatte. */
  conflicts: { id: string; copyId: string }[];
  /** Änderungen, die der Server nicht annimmt (ungültig, zu groß …). Die übrigen sind trotzdem angewendet. */
  rejected: { kind: 'protocol' | 'folder' | 'record'; id: string; collection?: string; reason: string }[];
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const MAX_CONTENT = 12_000_000;

/** Ein Eintrag ist sichtbar, wenn er veröffentlicht ist oder dem Nutzer gehört. */
export const canSee = (row: { shared: number; ownerId: string }, user: SyncUser): boolean => row.shared === 1 || row.ownerId === user.id;

/** SQL-Bedingung dazu (Parameter: Nutzer-ID). */
export const VISIBLE_SQL = '(shared = 1 OR ownerId = ?)';

export function toServerDoc(r: ProtocolRow): ServerDoc {
  let content: unknown;
  try {
    content = JSON.parse(r.content);
  } catch {
    content = { type: 'doc', content: [] };
  }
  return {
    id: r.id,
    title: r.title,
    folderId: r.folderId ?? '',
    datum: r.datum,
    beginn: r.beginn,
    ende: r.ende,
    ort: r.ort,
    leitung: r.leitung,
    content,
    shared: r.shared === 1,
    ownerId: r.ownerId,
    rev: r.rev,
    updatedAt: r.updatedAt,
    deleted: r.deletedAt !== null,
  };
}

/** Platzhalter für Einträge, die ein Client entfernen soll, weil sie nicht mehr für ihn sichtbar sind. */
const hiddenDoc = (id: string, rev: number): ServerDoc => ({
  id,
  title: '',
  folderId: '',
  datum: '',
  beginn: '',
  ende: '',
  ort: '',
  leitung: '',
  content: { type: 'doc', content: [] },
  shared: false,
  ownerId: '',
  rev,
  updatedAt: Date.now(),
  deleted: true,
});

const MAX_DEPTH = 100;
const MAX_NODES = 300_000;

/**
 * Prüft Form und Umfang des Inhalts, bevor er gespeichert wird: Wurzel `doc`, jeder Knoten ein Objekt mit Typ, `content` eine Liste,
 * begrenzte Tiefe und Anzahl. Was Clients schicken, ist sonst beliebig – und PDF, Suche und Export laufen später darüber.
 * Welche Knotentypen es gibt, prüft das nicht (das ist Sache des Editors).
 */
export function validateContent(content: unknown): string | null {
  if (content === undefined || content === null) return null; // leer = leeres Dokument
  if (typeof content !== 'object' || Array.isArray(content) || (content as { type?: unknown }).type !== 'doc') return 'Inhalt ist kein Dokument';
  let nodes = 0;
  const walk = (n: unknown, depth: number): string | null => {
    if (depth > MAX_DEPTH) return 'Inhalt ist zu tief verschachtelt';
    if (!n || typeof n !== 'object' || Array.isArray(n)) return 'Inhalt enthält einen ungültigen Knoten';
    if (++nodes > MAX_NODES) return 'Inhalt hat zu viele Knoten';
    const node = n as { type?: unknown; content?: unknown };
    if (typeof node.type !== 'string') return 'Inhalt enthält einen Knoten ohne Typ';
    if (node.content === undefined) return null;
    if (!Array.isArray(node.content)) return 'Inhalt enthält einen Knoten, dessen Inhalt keine Liste ist';
    for (const child of node.content) {
      const err = walk(child, depth + 1);
      if (err) return err;
    }
    return null;
  };
  return walk(content, 0);
}

function validate(c: ClientChange): string | null {
  if (!c || typeof c !== 'object') return 'ungültige Änderung';
  if (typeof c.id !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(c.id)) return 'ungültige ID';
  if (typeof c.baseRev !== 'number' || c.baseRev < 0) return 'ungültige Basisrevision';
  return validateContent(c.content);
}

interface Meta {
  ownerId: string;
  shared: 0 | 1;
  /** Zustand vor der Änderung (für `hiddenRev`). */
  prev?: { shared: number; hiddenRev: number | null };
}

const EMPTY_DOC = { type: 'doc', content: [] };

/** Schreibt (oder überschreibt) ein Protokoll und liefert die vergebene Revision. */
function write(db: DatabaseSync, id: string, c: ClientChange, deleted: boolean, meta: Meta): number {
  const content = JSON.stringify(c.content ?? EMPTY_DOC);
  if (content.length > MAX_CONTENT) throw new Error('Protokoll zu groß');
  const now = Date.now();
  const rev = nextRev(db);
  const hiddenRev = meta.prev && meta.prev.shared === 1 && meta.shared === 0 ? rev : (meta.prev?.hiddenRev ?? null);
  db.prepare(
    `INSERT INTO protocols(id, title, folderId, datum, beginn, ende, ort, leitung, content, ownerId, shared, hiddenRev, rev, updatedAt, deletedAt)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, folderId=excluded.folderId, datum=excluded.datum, beginn=excluded.beginn,
       ende=excluded.ende, ort=excluded.ort, leitung=excluded.leitung, content=excluded.content,
       ownerId=excluded.ownerId, shared=excluded.shared, hiddenRev=excluded.hiddenRev,
       rev=excluded.rev, updatedAt=excluded.updatedAt, deletedAt=excluded.deletedAt, purgedAt=NULL`,
  ).run(
    id,
    str(c.title, 200),
    str(c.folderId, 64),
    str(c.datum, 20),
    str(c.beginn, 10),
    str(c.ende, 10),
    str(c.ort, 200),
    str(c.leitung, 200),
    content,
    meta.ownerId,
    meta.shared,
    hiddenRev,
    rev,
    Number.isFinite(c.updatedAt) ? c.updatedAt : now,
    deleted ? now : null,
  );
  return rev;
}

/**
 * Leert ein Protokoll im Papierkorb endgültig: Titel und Inhalt verschwinden, die Zeile bleibt als Grabstein mit neuer Revision,
 * damit jedes Gerät die Löschung erfährt (sonst bliebe die Kopie auf einem lange offline gewesenen Gerät stehen und käme beim
 * nächsten „Alles neu abgleichen“ zurück). Liefert false, wenn das Protokoll nicht im Papierkorb liegt oder schon geleert ist.
 */
export function purgeProtocol(db: DatabaseSync, id: string, now = Date.now()): boolean {
  const r = db
    .prepare(
      `UPDATE protocols SET title = '', content = '{"type":"doc","content":[]}', ort = '', leitung = '', purgedAt = ?, rev = ?
       WHERE id = ? AND deletedAt IS NOT NULL AND purgedAt IS NULL`,
    )
    .run(now, nextRev(db), id);
  return r.changes > 0;
}

const DAY = 86_400_000;

/**
 * Räumt den Papierkorb auf: Einträge, die länger als `trashDays` darin liegen, werden geleert (der Grabstein bleibt), und
 * Grabsteine verschwinden erst nach `max(tokenDays, 90)` Tagen. So lange kann ein Gerät offline gewesen sein, ohne
 * dass Gelöschtes bei ihm wieder auftaucht.
 */
export function sweepTrash(db: DatabaseSync, now = Date.now()): { purged: number; removed: number } {
  const settings = getSettings(db);
  const trashDays = Number(settings.trashDays) || 30;
  const stoneDays = Math.max(Number(settings.tokenDays) || 90, 90);
  const due = db.prepare('SELECT id FROM protocols WHERE deletedAt IS NOT NULL AND purgedAt IS NULL AND deletedAt < ?').all(now - trashDays * DAY) as { id: string }[];
  for (const { id } of due) purgeProtocol(db, id, now);
  const gone = db.prepare('DELETE FROM protocols WHERE purgedAt IS NOT NULL AND purgedAt < ?').run(now - stoneDays * DAY);
  return { purged: due.length, removed: Number(gone.changes) };
}

/** Steht genau diese Fassung (Kopfdaten und Inhalt) schon beim Server? Dann ist eine veraltete Basis kein Konflikt. */
function sameDoc(r: ProtocolRow, c: ClientChange): boolean {
  return (
    r.title === str(c.title, 200) &&
    r.folderId === str(c.folderId, 64) &&
    r.datum === str(c.datum, 20) &&
    r.beginn === str(c.beginn, 10) &&
    r.ende === str(c.ende, 10) &&
    r.ort === str(c.ort, 200) &&
    r.leitung === str(c.leitung, 200) &&
    r.content === JSON.stringify(c.content ?? EMPTY_DOC)
  );
}

/**
 * Kennung der Konfliktkopie: dieselbe für denselben Nutzer, dasselbe Dokument und dieselbe veraltete Basis. Wer auf einem
 * veralteten Stand weitertippt, schreibt so dieselbe Kopie fort, statt bei jedem Abgleich eine neue anzulegen.
 */
const conflictCopyId = (userId: string, c: ClientChange): string => createHash('sha256').update(`${userId}\n${c.id}\n${c.baseRev}`).digest('hex').slice(0, 32);

/**
 * Wendet Client-Änderungen an und liefert alles, was seit `since` neu ist und für den Nutzer sichtbar ist.
 * Last-Write-Wins nur, wenn der Client auf dem aktuellen Stand aufbaut; sonst bleibt die
 * Server-Fassung und die Client-Fassung wird als Konfliktkopie gesichert – es geht nichts verloren.
 *
 * Sichtbarkeit: Protokolle und Aufgaben sind privat (nur Besitzer) oder veröffentlicht (alle Betreuer).
 * Veröffentlichte Einträge dürfen alle bearbeiten; Sichtbarkeit ändern kann nur der Besitzer,
 * löschen Besitzer und Admins. Wird ein Eintrag wieder privat, erhalten andere Clients einen Löschhinweis.
 */
export function applySync(db: DatabaseSync, req: SyncRequest, user: SyncUser): SyncResponse {
  const conflicts: SyncResponse['conflicts'] = [];
  /** Dokumente, die in die Antwort gehören, auch wenn ihre Revision nicht über dem Stand des Clients liegt. */
  const resend = new Set<string>();
  const rejected: SyncResponse['rejected'] = [];
  /**
   * Führt eine einzelne Änderung isoliert aus: Scheitert sie, wird nur sie zurückgenommen und gemeldet, die übrigen laufen weiter.
   * Sonst sperrt ein einziges unbrauchbares Protokoll (zu groß, ungültig) den Abgleich des ganzen Geräts, und zwar dauerhaft.
   */
  const isolated = (what: { kind: SyncResponse['rejected'][number]['kind']; id: unknown; collection?: unknown }, fn: () => void): void => {
    db.exec('SAVEPOINT change');
    try {
      fn();
      db.exec('RELEASE change');
    } catch (e) {
      db.exec('ROLLBACK TO change');
      db.exec('RELEASE change');
      rejected.push({
        kind: what.kind,
        id: typeof what.id === 'string' ? what.id : '',
        ...(typeof what.collection === 'string' ? { collection: what.collection } : {}),
        reason: e instanceof Error ? e.message : 'unbekannter Fehler',
      });
    }
  };
  const epoch = getEpoch(db);
  let since = Number.isFinite(req.since) ? req.since : 0;
  // Der gemerkte Stand des Clients passt nicht zu dieser Datenbank (neu angelegt/zurückgesetzt/ersetzt):
  // alles neu ausliefern; der Client sendet danach hoch, was dem Server fehlt.
  const reset = since > 0 && (req.epoch !== undefined ? req.epoch !== epoch : since > currentRev(db));
  if (reset) since = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const c of req.changes ?? []) {
      isolated({ kind: 'protocol', id: c?.id }, () => {
        const err = validate(c);
        if (err) throw new Error(err);
        const existing = db.prepare('SELECT * FROM protocols WHERE id = ?').get(c.id) as ProtocolRow | undefined;
        if (!existing) {
          write(db, c.id, c, c.deleted, { ownerId: user.id, shared: c.shared === true ? 1 : 0 });
          return;
        }
        if (!canSee(existing, user)) return; // fremdes privates Protokoll: ignorieren
        const isOwner = existing.ownerId === user.id;
        const meta: Meta = {
          ownerId: existing.ownerId,
          shared: isOwner && typeof c.shared === 'boolean' ? (c.shared ? 1 : 0) : (existing.shared as 0 | 1),
          prev: existing,
        };
        const serverDeleted = existing.deletedAt !== null;
        if (c.deleted) {
          if (!isOwner && user.role !== 'admin') return;
          // Löschen gewinnt, auch gegen eine Bearbeitung auf veraltetem Stand: Der Papierkorb macht es umkehrbar, und sonst bliebe ein
          // bewusst gelöschtes Protokoll durch ein Gerät am Leben, das nur noch nicht abgeglichen hatte.
          if (serverDeleted) resend.add(c.id);
          else write(db, c.id, { ...c, ...rowFields(existing) }, true, { ...meta, shared: existing.shared as 0 | 1 });
          return;
        }
        if (existing.rev === c.baseRev || serverDeleted) {
          write(db, c.id, c, false, meta);
          return;
        }
        // Das Gerät baut auf einem veralteten Stand auf. Das Original geht in jedem Fall mit zurück, damit es aufholen kann,
        // auch wenn sein Stand schon darüber hinausgerückt ist.
        resend.add(c.id);
        // Steht genau diese Fassung schon beim Server (Wiederholung nach verlorener Antwort, gleiche Änderung auf zwei Geräten), ist nichts zu tun.
        if (sameDoc(existing, c)) return;
        // Sonst bleibt die Server-Fassung, und die Fassung des Geräts wird als Kopie gesichert. Dieselbe Kopie wird fortgeschrieben,
        // solange das Gerät auf derselben veralteten Basis weitertippt und niemand die Kopie geändert hat.
        let copyId = conflictCopyId(user.id, c);
        const prev = db.prepare('SELECT rev, conflictRev, deletedAt FROM protocols WHERE id = ?').get(copyId) as
          | { rev: number; conflictRev: number | null; deletedAt: number | null }
          | undefined;
        if (prev && (prev.deletedAt !== null || prev.conflictRev !== prev.rev)) copyId = randomUUID().replace(/-/g, '');
        const copyRev = write(db, copyId, { ...c, title: `${str(c.title, 180) || 'Protokoll'} (Konflikt)` }, false, { ownerId: user.id, shared: existing.shared as 0 | 1 });
        db.prepare('UPDATE protocols SET conflictRev = ? WHERE id = ?').run(copyRev, copyId);
        conflicts.push({ id: c.id, copyId });
      });
    }
    const now = Date.now();
    for (const f of req.folders ?? []) {
      isolated({ kind: 'folder', id: f?.id }, () => {
        if (typeof f?.id !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(f.id)) throw new Error('ungültige Ordner-ID');
        db.prepare(
          `INSERT INTO folders(id, name, parentId, rev, updatedAt, deletedAt) VALUES(?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, parentId=excluded.parentId, rev=excluded.rev,
             updatedAt=excluded.updatedAt, deletedAt=excluded.deletedAt`,
        ).run(f.id, str(f.name, 120), str(f.parentId, 64), nextRev(db), Number.isFinite(f.updatedAt) ? f.updatedAt : now, f.deleted ? now : null);
      });
    }
    for (const r of req.records ?? []) {
      isolated({ kind: 'record', id: r?.id, collection: r?.collection }, () => {
        if (!COLLECTIONS.includes(r.collection) || typeof r.id !== 'string' || !/^[\w.:-]{1,100}$/.test(r.id)) throw new Error('ungültiger Datensatz');
        const data = JSON.stringify(r.data ?? {});
        if (data.length > 200_000) throw new Error('Datensatz zu groß');
        const at = Number.isFinite(r.updatedAt) ? r.updatedAt : now;
        const privateCapable = PRIVATE_CAPABLE.includes(r.collection);
        const old = db.prepare('SELECT updatedAt, ownerId, shared, hiddenRev FROM records WHERE collection = ? AND id = ?').get(r.collection, r.id) as
          | { updatedAt: number; ownerId: string; shared: number; hiddenRev: number | null }
          | undefined;
        if (old && privateCapable && !canSee(old, user)) return;
        if (old && old.updatedAt > at) return; // Server hat die neuere Fassung: letzte Änderung gewinnt
        const isOwner = !old || old.ownerId === user.id || old.ownerId === '';
        if (old && r.deleted && privateCapable && !isOwner && user.role !== 'admin') return;
        const shared = !privateCapable ? 1 : isOwner ? (r.shared === true ? 1 : 0) : old!.shared;
        const rev = nextRev(db);
        const hiddenRev = old && old.shared === 1 && shared === 0 ? rev : (old?.hiddenRev ?? null);
        db.prepare(
          `INSERT INTO records(collection, id, data, ownerId, shared, hiddenRev, rev, updatedAt, deletedAt) VALUES(?,?,?,?,?,?,?,?,?)
           ON CONFLICT(collection, id) DO UPDATE SET data=excluded.data, ownerId=excluded.ownerId, shared=excluded.shared,
             hiddenRev=excluded.hiddenRev, rev=excluded.rev, updatedAt=excluded.updatedAt, deletedAt=excluded.deletedAt`,
        ).run(r.collection, r.id, data, old?.ownerId || user.id, shared, hiddenRev, rev, at, r.deleted ? now : null);
      });
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  const rows = db.prepare(`SELECT * FROM protocols WHERE rev > ? AND ${VISIBLE_SQL} ORDER BY rev`).all(since, user.id) as unknown as ProtocolRow[];
  for (const id of resend) {
    if (rows.some((r) => r.id === id)) continue;
    const row = db.prepare(`SELECT * FROM protocols WHERE id = ? AND ${VISIBLE_SQL}`).get(id, user.id) as unknown as ProtocolRow | undefined;
    if (row) rows.push(row);
  }
  const hiddenDocs = (
    db.prepare('SELECT id, rev FROM protocols WHERE rev > ? AND shared = 0 AND ownerId != ? AND hiddenRev > ?').all(since, user.id, since) as { id: string; rev: number }[]
  ).map((h) => hiddenDoc(h.id, h.rev));
  const folderRows = db.prepare('SELECT * FROM folders WHERE rev > ? ORDER BY rev').all(since) as unknown as FolderRow[];
  const folders = folderRows.map(
    (f): ServerFolder => ({ id: f.id, name: f.name, parentId: f.parentId, rev: f.rev, updatedAt: f.updatedAt, deleted: f.deletedAt !== null }),
  );
  const recordRows = db.prepare(`SELECT * FROM records WHERE rev > ? AND ${VISIBLE_SQL} ORDER BY rev`).all(since, user.id) as unknown as RecordRow[];
  const records = recordRows.map((r): ServerRecord => {
    const parsed = JSON.parse(r.data) as unknown;
    // Aufgaben tragen Besitzer und Sichtbarkeit im Datensatz selbst, damit der Client sie ohne Sonderfall speichern kann.
    const data = PRIVATE_CAPABLE.includes(r.collection) && parsed && typeof parsed === 'object' ? { ...parsed, ownerId: r.ownerId, shared: r.shared === 1 } : parsed;
    return { collection: r.collection, id: r.id, data, rev: r.rev, updatedAt: r.updatedAt, deleted: r.deletedAt !== null, ownerId: r.ownerId, shared: r.shared === 1 };
  });
  const hiddenRecords = (
    db.prepare('SELECT collection, id, rev FROM records WHERE rev > ? AND shared = 0 AND ownerId != ? AND hiddenRev > ?').all(since, user.id, since) as {
      collection: string;
      id: string;
      rev: number;
    }[]
  ).map((h): ServerRecord => ({ collection: h.collection, id: h.id, data: {}, rev: h.rev, updatedAt: Date.now(), deleted: true, ownerId: '', shared: false }));

  const count = (sql: string) => (db.prepare(sql).get(user.id) as { n: number }).n;
  const counts = {
    protocols: count(`SELECT COUNT(*) AS n FROM protocols WHERE deletedAt IS NULL AND ${VISIBLE_SQL}`),
    folders: (db.prepare('SELECT COUNT(*) AS n FROM folders WHERE deletedAt IS NULL').get() as { n: number }).n,
    records: count(`SELECT COUNT(*) AS n FROM records WHERE deletedAt IS NULL AND ${VISIBLE_SQL}`),
  };
  const users = (db.prepare('SELECT id, username, displayName FROM users ORDER BY username').all() as { id: string; username: string; displayName: string }[]).map(
    (u): DirectoryUser => ({ id: u.id, name: u.displayName || u.username }),
  );
  return {
    rev: currentRev(db),
    epoch,
    reset,
    changes: [...rows.map(toServerDoc), ...hiddenDocs],
    folders,
    records: [...records, ...hiddenRecords],
    collections: COLLECTIONS,
    users,
    counts,
    conflicts,
    rejected,
  };
}

function rowFields(r: ProtocolRow) {
  return {
    title: r.title,
    folderId: r.folderId ?? '',
    datum: r.datum,
    beginn: r.beginn,
    ende: r.ende,
    ort: r.ort,
    leitung: r.leitung,
    content: JSON.parse(r.content) as unknown,
    updatedAt: r.updatedAt,
  };
}
