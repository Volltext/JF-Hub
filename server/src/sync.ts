import type { DatabaseSync } from 'node:sqlite';
import { clearRefs } from './blobs.js';
import { currentRev, getEpoch, getSettings, nextRev, type FolderRow, type ProtocolRow, type RecordRow, type Role } from './db.js';

/** Wer synchronisiert (aus der Sitzung). */
export interface SyncUser {
  id: string;
  role: Role;
}

/**
 * Kopffelder eines Protokolls. Jedes trägt seine eigene Änderungszeit: Bei gleichzeitigen Änderungen gewinnt Feld für Feld die
 * jüngere. Der Text liegt nicht hier, sondern als Yjs-Dokument beim Austausch (`collab/exchange.ts`).
 */
export const META_FIELDS = ['title', 'datum', 'beginn', 'ende', 'ort', 'leitung', 'folderId', 'shared'] as const;
export type MetaField = (typeof META_FIELDS)[number];
/** Zeitpunkt (ms) der letzten Änderung je Kopffeld. */
export type MetaAt = Partial<Record<MetaField, number>>;

/** Änderung der Kopfdaten eines Protokolls durch einen Client. `baseRev` ist die Server-Revision, auf der sie beruht (0 = neu). */
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
  /** Wann der Client welches Feld zuletzt geändert hat. Felder ohne Zeit behauptet der Client nicht. */
  metaAt?: MetaAt;
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
  /**
   * Kopfdaten der Protokolle. Das Feld heißt absichtlich nicht mehr `changes`: Ein Server vor 3.0.0 würde eine Änderung ohne Inhalt als
   * leeres Dokument speichern, so ignoriert er das neue Feld.
   */
  protocols: ClientChange[];
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
  /** Schnappschuss des Textes (aus dem Yjs-Dokument abgeleitet) für Liste, Suche, PDF und die Nur-lesen-Ansicht. */
  content: unknown;
  shared: boolean;
  ownerId: string;
  rev: number;
  updatedAt: number;
  deleted: boolean;
  /** 1 = der Text liegt als Yjs-Dokument beim Server; 0 = noch nicht umgestellt (nur lesen). */
  ymode: number;
  metaAt: MetaAt;
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
  /** Seit 3.0.0 immer leer (der Text wird zusammengeführt, die Kopfdaten Feld für Feld); bleibt im Format für den Abgleich von Altfällen. */
  conflicts: { id: string; copyId: string }[];
  /** Änderungen, die der Server nicht annimmt (ungültig, zu groß …). Die übrigen sind trotzdem angewendet. */
  rejected: { kind: 'protocol' | 'folder' | 'record'; id: string; collection?: string; reason: string }[];
  /** Seit 3.0.0 immer leer: Fehlende Anhänge meldet der Austausch des Textes (`collab/exchange.ts`). */
  missingBlobs: string[];
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
export const MAX_CONTENT = 12_000_000;

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
    ymode: r.ymode,
    metaAt: parseMetaAt(r.metaAt),
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
  ymode: 1,
  metaAt: {},
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
  return null;
}

const EMPTY_CONTENT = '{"type":"doc","content":[]}';
/** Wie weit die Uhr eines Geräts vorgehen darf: Wer in der Zukunft schreibt, gewinnt sonst jede spätere Änderung. */
const FUTURE_SKEW_MS = 5 * 60_000;

function parseMetaAt(text: string): MetaAt {
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as MetaAt) : {};
  } catch {
    return {};
  }
}

/** Die vom Client genannten Änderungszeiten, begrenzt auf „jetzt + 5 Minuten“. Felder ohne gültige Zeit fehlen. */
function sentTimes(c: ClientChange, now: number): MetaAt {
  const out: MetaAt = {};
  const given: unknown = c.metaAt;
  if (!given || typeof given !== 'object' || Array.isArray(given)) return out;
  for (const f of META_FIELDS) {
    const t = (given as Record<string, unknown>)[f];
    if (typeof t === 'number' && Number.isFinite(t) && t > 0) out[f] = Math.min(Math.floor(t), now + FUTURE_SKEW_MS);
  }
  return out;
}

/** Wert eines Kopffeldes, wie der Server ihn speichern würde. */
function incomingValue(c: ClientChange, f: MetaField): string | number {
  switch (f) {
    case 'title':
      return str(c.title, 200);
    case 'datum':
      return str(c.datum, 20);
    case 'beginn':
      return str(c.beginn, 10);
    case 'ende':
      return str(c.ende, 10);
    case 'ort':
      return str(c.ort, 200);
    case 'leitung':
      return str(c.leitung, 200);
    case 'folderId':
      return str(c.folderId, 64);
    case 'shared':
      return c.shared === true ? 1 : 0;
  }
}

const storedValue = (r: ProtocolRow, f: MetaField): string | number => (f === 'folderId' ? (r.folderId ?? '') : r[f]);

/** Legt ein Protokoll aus den Kopfdaten an. Der Text kommt später über den Austausch. */
function createProtocol(db: DatabaseSync, c: ClientChange, user: SyncUser, sent: MetaAt, now: number): void {
  const at = typeof c.updatedAt === 'number' && Number.isFinite(c.updatedAt) && c.updatedAt > 0 ? Math.min(Math.floor(c.updatedAt), now + FUTURE_SKEW_MS) : now;
  const metaAt: MetaAt = {};
  for (const f of META_FIELDS) metaAt[f] = sent[f] ?? at;
  db.prepare(
    `INSERT INTO protocols(id, title, folderId, datum, beginn, ende, ort, leitung, content, ownerId, shared, hiddenRev, rev, updatedAt, deletedAt, ymode, metaAt)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,1,?)`,
  ).run(
    c.id,
    str(c.title, 200),
    str(c.folderId, 64),
    str(c.datum, 20),
    str(c.beginn, 10),
    str(c.ende, 10),
    str(c.ort, 200),
    str(c.leitung, 200),
    EMPTY_CONTENT,
    user.id,
    c.shared === true ? 1 : 0,
    nextRev(db),
    now,
    c.deleted ? now : null,
    JSON.stringify(metaAt),
  );
}

/**
 * Wendet die Kopfdaten eines Clients an. Jedes Feld gilt für sich: Es gewinnt die jüngere Änderungszeit, bei Gleichstand der größere
 * Wert (damit alle Geräte gleich entscheiden). War der Server bei einem Feld neuer, geht das Protokoll in die Antwort (`resend`), und
 * das Gerät übernimmt es. Löschen gewinnt; ein gelöschtes oder geleertes Protokoll holt nur eine Änderung zurück, die jünger ist.
 */
function applyProtocol(db: DatabaseSync, c: ClientChange, user: SyncUser, now: number, resend: Set<string>): void {
  const sent = sentTimes(c, now);
  const existing = db.prepare('SELECT * FROM protocols WHERE id = ?').get(c.id) as ProtocolRow | undefined;
  if (!existing) {
    createProtocol(db, c, user, sent, now);
    return;
  }
  if (!canSee(existing, user)) return; // fremdes privates Protokoll: ignorieren
  const isOwner = existing.ownerId === user.id;
  if (c.deleted) {
    if (!isOwner && user.role !== 'admin') return;
    // Löschen gewinnt, auch gegen eine Bearbeitung auf veraltetem Stand: Der Papierkorb macht es umkehrbar, und sonst bliebe ein
    // bewusst gelöschtes Protokoll durch ein Gerät am Leben, das nur noch nicht abgeglichen hatte.
    if (existing.deletedAt !== null) resend.add(c.id);
    else db.prepare('UPDATE protocols SET deletedAt = ?, rev = ?, updatedAt = ? WHERE id = ?').run(now, nextRev(db), now, c.id);
    return;
  }
  const removedAt = existing.purgedAt ?? existing.deletedAt;
  let revive = false;
  if (removedAt !== null) {
    if (Math.max(0, ...Object.values(sent)) <= removedAt) {
      resend.add(c.id); // die Änderung ist älter als das Löschen
      return;
    }
    revive = true;
  }

  // Das Leeren hat Titel, Ort und Leitung gelöscht, ihre Feldzeiten aber stehen lassen. Lebt der Eintrag durch eine jüngere Änderung wieder auf,
  // gelten alle Felder, die das Gerät schickt: Niemand hat sie nach dem Leeren geändert, und ein älterer Titel soll nicht am leeren Wert scheitern.
  const known = revive && existing.purgedAt !== null ? {} : parseMetaAt(existing.metaAt);
  const set: Record<string, string | number> = {};
  let serverNewer = false;
  for (const f of META_FIELDS) {
    const t = sent[f];
    if (t === undefined || (f === 'shared' && !isOwner)) continue;
    const current = storedValue(existing, f);
    const incoming = incomingValue(c, f);
    if (incoming === current) continue;
    const at = known[f] ?? 0;
    if (t > at || (t === at && incoming > current)) {
      set[f] = incoming;
      known[f] = t;
    } else {
      serverNewer = true;
    }
  }
  if (serverNewer) resend.add(c.id);
  if (!Object.keys(set).length && !revive) return;

  const rev = nextRev(db);
  const hiddenRev = 'shared' in set && existing.shared === 1 && set.shared === 0 ? rev : existing.hiddenRev;
  const columns = Object.keys(set); // nur Namen aus META_FIELDS
  db.prepare(
    `UPDATE protocols SET ${columns.map((k) => `${k} = ?, `).join('')}metaAt = ?, hiddenRev = ?, rev = ?, updatedAt = ?${
      revive ? `, deletedAt = NULL, purgedAt = NULL${existing.purgedAt !== null ? ', ymode = 1' : ''}` : ''
    } WHERE id = ?`,
  ).run(...columns.map((k) => set[k]!), JSON.stringify(known), hiddenRev, rev, now, c.id);
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
  if (r.changes > 0) {
    clearRefs(db, id); // Die Anhänge sind frei und werden nach der Schonfrist aufgeräumt.
    db.prepare('DELETE FROM ydocs WHERE id = ?').run(id);
  }
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
    const now = Date.now();
    for (const c of Array.isArray(req.protocols) ? req.protocols : []) {
      isolated({ kind: 'protocol', id: c?.id }, () => {
        const err = validate(c);
        if (err) throw new Error(err);
        applyProtocol(db, c, user, now, resend);
      });
    }
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
    conflicts: [],
    rejected,
    missingBlobs: [],
  };
}
