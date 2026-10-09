import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/**
 * Anhänge (Fotos, Dateien) von Protokollen. Sie liegen binär in der Tabelle `blobs`, im Inhalt des Protokolls steht nur
 * ein Verweis (`blobId`). Das hält die Protokolle klein: Abgleich, Liste, Suche und Konfliktkopien tragen keine Bilder mit.
 */

export const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Die öffentliche Demo nimmt nur kleine Fotos an. */
export const DEMO_MAX_PHOTO_BYTES = 2 * 1024 * 1024;
/** Ein Blob ohne Verweis bleibt so lange liegen: Die App lädt ihn vor dem Protokoll hoch, das auf ihn verweist. */
export const BLOB_GRACE_DAYS = 7;

const DAY = 86_400_000;

export type BlobKind = 'photo' | 'file';

/** Kennungen kommen aus der Adresse und stehen im Inhalt von Protokollen; nur diese Zeichen sind zulässig. */
export const BLOB_ID_RE = /^[A-Za-z0-9_-]{6,80}$/;

export class BlobError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** Beginnt die Datei wie ein JPEG? (Mehr prüft der Server nicht; Browser und PDF-Erzeugung ziehen den Rest.) */
export const isJpeg = (b: Uint8Array): boolean => b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Strenges Base64: liefert null, wenn der Text nicht nur aus Base64-Zeichen besteht. */
export function decodeBase64(text: string): Buffer | null {
  if (text.length % 4 === 1 || !BASE64.test(text)) return null;
  return Buffer.from(text, 'base64');
}

const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

const MIME = /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,100}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,100}$/;
/** Ein unbrauchbarer Medientyp wird zu `application/octet-stream`. */
export const cleanMime = (v: unknown): string => (typeof v === 'string' && MIME.test(v) ? v.toLowerCase() : 'application/octet-stream');
/** Dateiname ohne Steuerzeichen und Pfadtrenner. */
// eslint-disable-next-line no-control-regex
export const cleanName = (v: unknown): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f/\\]+/g, '').trim().slice(0, 120) : '');

// ---------- Hochladen: Prüfung ----------

export interface UploadRequest {
  id: string;
  kind: unknown;
  name: unknown;
  mime: unknown;
  /** Base64 */
  data: unknown;
}

export interface CheckedUpload {
  kind: BlobKind;
  name: string;
  mime: string;
  data: Buffer;
}

/**
 * Prüft einen Upload so, wie es der Server tut, und liefert, was gespeichert wird: Kennung, Art, Base64, Größe, bei Fotos die
 * JPEG-Kennung. Wirft `BlobError` mit dem passenden HTTP-Status. `demo`: Die öffentliche Demo nimmt nur kleine Fotos an.
 */
export function checkUpload(req: UploadRequest, opts: { demo?: boolean } = {}): CheckedUpload {
  if (!BLOB_ID_RE.test(req.id)) throw new BlobError('Ungültige Kennung', 400);
  const kind = req.kind;
  if (kind !== 'photo' && kind !== 'file') throw new BlobError('Die Art muss „photo“ oder „file“ sein', 400);
  if (opts.demo && kind === 'file') throw new BlobError('In der Demo können nur Fotos hochgeladen werden.', 403);
  if (typeof req.data !== 'string' || req.data === '') throw new BlobError('Keine Daten übermittelt', 400);
  const data = decodeBase64(req.data);
  if (!data) throw new BlobError('Die Daten sind kein gültiges Base64', 400);
  const limit = kind === 'photo' ? (opts.demo ? DEMO_MAX_PHOTO_BYTES : MAX_PHOTO_BYTES) : MAX_FILE_BYTES;
  if (data.length > limit) throw new BlobError(`${kind === 'photo' ? 'Das Foto' : 'Die Datei'} ist größer als ${Math.round(limit / 1024 / 1024)} MB`, 413);
  if (kind === 'photo' && !isJpeg(data)) throw new BlobError('Fotos müssen JPEG-Dateien sein', 400);
  return {
    kind,
    name: kind === 'file' ? cleanName(req.name) || 'Datei' : '',
    mime: kind === 'photo' ? 'image/jpeg' : cleanMime(req.mime),
    data,
  };
}

// ---------- Speichern und Lesen ----------

export interface BlobInput {
  id: string;
  kind: BlobKind;
  name: string;
  mime: string;
  data: Buffer;
  uploaderId: string;
  /** Hat der Aufrufer die Prüfsumme schon berechnet, spart sich der Server die zweite Berechnung. */
  sha256?: string;
  now?: number;
}

/**
 * Legt einen Blob an. Dieselbe Kennung mit denselben Bytes ist ein unschädlicher Wiederholungsversuch (und verlängert die Schonfrist
 * vor dem Aufräumen), dieselbe Kennung mit anderen Bytes ein Fehler.
 */
export function storeBlob(db: DatabaseSync, input: BlobInput): { created: boolean; sha256: string } {
  if (!BLOB_ID_RE.test(input.id)) throw new BlobError('Ungültige Kennung', 400);
  const hash = input.sha256 ?? sha256(input.data);
  const now = input.now ?? Date.now();
  const existing = db.prepare('SELECT sha256 FROM blobs WHERE id = ?').get(input.id) as { sha256: string } | undefined;
  if (existing) {
    if (existing.sha256 !== hash) throw new BlobError('Unter dieser Kennung liegt schon etwas anderes', 409);
    db.prepare('UPDATE blobs SET uploadedAt = ? WHERE id = ?').run(now, input.id);
    return { created: false, sha256: hash };
  }
  db.prepare('INSERT INTO blobs(id, sha256, size, mime, name, kind, uploaderId, uploadedAt, data) VALUES(?,?,?,?,?,?,?,?,?)').run(
    input.id,
    hash,
    input.data.length,
    input.mime,
    input.name,
    input.kind,
    input.uploaderId,
    now,
    input.data,
  );
  return { created: true, sha256: hash };
}

export interface BlobMeta {
  id: string;
  kind: BlobKind;
  mime: string;
  name: string;
  size: number;
}

/**
 * Der Blob, wenn `userId` ihn sehen darf: Er hat ihn hochgeladen, oder ein Protokoll, das der Nutzer sehen darf (veröffentlicht oder
 * eigen) und das nicht im Papierkorb liegt, verweist darauf. Sonst undefined, ohne zu verraten, ob es ihn gibt.
 */
export function findBlob(db: DatabaseSync, id: string, userId: string): BlobMeta | undefined {
  return db
    .prepare(
      `SELECT b.id, b.kind, b.mime, b.name, b.size FROM blobs b
       WHERE b.id = ? AND (
         b.uploaderId = ?
         OR EXISTS (
           SELECT 1 FROM blob_refs r JOIN protocols p ON p.id = r.protocolId
           WHERE r.blobId = b.id AND p.deletedAt IS NULL AND (p.shared = 1 OR p.ownerId = ?)
         )
       )`,
    )
    .get(id, userId, userId) as BlobMeta | undefined;
}

export function readBlobData(db: DatabaseSync, id: string): Buffer | undefined {
  const row = db.prepare('SELECT data FROM blobs WHERE id = ?').get(id) as { data: Uint8Array } | undefined;
  return row ? Buffer.from(row.data.buffer, row.data.byteOffset, row.data.byteLength) : undefined;
}

export function blobStats(db: DatabaseSync): { count: number; bytes: number } {
  const r = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM blobs').get() as { n: number; bytes: number };
  return { count: r.n, bytes: r.bytes };
}

/** Räumt Blobs auf, auf die nichts mehr verweist und die seit der Schonfrist niemand mehr hochgeladen hat. Liefert die Anzahl. */
export function sweepBlobs(db: DatabaseSync, now = Date.now()): number {
  const r = db.prepare('DELETE FROM blobs WHERE uploadedAt < ? AND NOT EXISTS (SELECT 1 FROM blob_refs r WHERE r.blobId = blobs.id)').run(now - BLOB_GRACE_DAYS * DAY);
  return Number(r.changes);
}

// ---------- Verweise ----------

interface Node {
  type?: unknown;
  attrs?: Record<string, unknown>;
  content?: unknown;
}

export interface BlobNode {
  blobId: string;
  type: string;
  name: string;
}

/** Alle Knoten eines Protokolls, die auf einen Blob verweisen (Foto, Anhang, künftige Arten). */
export function blobNodesOf(content: unknown): BlobNode[] {
  const out: BlobNode[] = [];
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object' || Array.isArray(n)) return;
    const node = n as Node;
    const id = node.attrs?.blobId;
    if (typeof id === 'string' && BLOB_ID_RE.test(id)) {
      out.push({ blobId: id, type: typeof node.type === 'string' ? node.type : '', name: typeof node.attrs?.name === 'string' ? node.attrs.name : '' });
    }
    if (Array.isArray(node.content)) for (const c of node.content) walk(c);
  };
  walk(content);
  return out;
}

export const blobIdsOf = (content: unknown): string[] => [...new Set(blobNodesOf(content).map((n) => n.blobId))];

/** Setzt die Verweise eines Protokolls auf genau diese Anhänge. */
function setRefs(db: DatabaseSync, protocolId: string, blobIds: string[]): void {
  db.prepare('DELETE FROM blob_refs WHERE protocolId = ?').run(protocolId);
  const insert = db.prepare('INSERT OR IGNORE INTO blob_refs(blobId, protocolId) VALUES(?, ?)');
  for (const id of blobIds) insert.run(id, protocolId);
}

/** Schreibt die Verweise eines Protokolls neu, passend zu seinem Inhalt. */
export function refreshRefs(db: DatabaseSync, protocolId: string, content: unknown): void {
  setRefs(db, protocolId, blobIdsOf(content));
}

export function clearRefs(db: DatabaseSync, protocolId: string): void {
  db.prepare('DELETE FROM blob_refs WHERE protocolId = ?').run(protocolId);
}

/**
 * Baut die Verweise aller Protokolle aus ihrem Inhalt neu auf. Die Verweise sind abgeleitete Daten; stimmen sie einmal nicht (Fehler,
 * Eingriff von Hand), würde die Müllsammlung Anhänge entfernen, die noch gebraucht werden. Der Start prüft deshalb jedes Mal nach.
 * Geleerte Protokolle (Grabsteine) verweisen auf nichts. Liefert die Zahl der Protokolle, deren Verweise sich geändert haben.
 */
export function reindexBlobRefs(db: DatabaseSync): number {
  const have = new Map<string, Set<string>>();
  for (const r of db.prepare('SELECT protocolId, blobId FROM blob_refs').all() as { protocolId: string; blobId: string }[]) {
    if (!have.has(r.protocolId)) have.set(r.protocolId, new Set());
    have.get(r.protocolId)!.add(r.blobId);
  }
  let changed = 0;
  const seen = new Set<string>();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of db.prepare('SELECT id, content, purgedAt FROM protocols').all() as { id: string; content: string; purgedAt: number | null }[]) {
      seen.add(row.id);
      let want: string[] = [];
      if (row.purgedAt === null) {
        try {
          want = blobIdsOf(JSON.parse(row.content));
        } catch {
          continue; // unlesbarer Inhalt: die vorhandenen Verweise bleiben, besser zu viele als zu wenige
        }
      }
      const had = have.get(row.id) ?? new Set<string>();
      if (want.length === had.size && want.every((id) => had.has(id))) continue;
      setRefs(db, row.id, want);
      changed++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return changed;
}

/** Blobs, auf die eines der Protokolle verweist, die der Server aber nicht hat. */
export function missingBlobIds(db: DatabaseSync, protocolIds: string[]): string[] {
  const missing = new Set<string>();
  for (let i = 0; i < protocolIds.length; i += 400) {
    const chunk = protocolIds.slice(i, i + 400);
    const marks = chunk.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT DISTINCT r.blobId FROM blob_refs r LEFT JOIN blobs b ON b.id = r.blobId WHERE r.protocolId IN (${marks}) AND b.id IS NULL`)
      .all(...chunk) as { blobId: string }[];
    for (const r of rows) missing.add(r.blobId);
  }
  return [...missing].sort();
}

// ---------- Anhänge aus dem Inhalt auslagern ----------

export interface NewBlob {
  id: string;
  kind: BlobKind;
  mime: string;
  name: string;
  data: Buffer;
  sha256: string;
}

export interface Normalized {
  content: unknown;
  /** Blobs, die aus dem Inhalt herausgelöst wurden (noch nicht gespeichert). */
  blobs: NewBlob[];
  /** Anhänge, die nicht ausgelagert werden konnten (nur ohne `strict`). */
  skipped: number;
}

/** Die Kennung folgt dem Inhalt: Dieselben Bytes ergeben immer denselben Blob, egal in welchem Protokoll und wie oft. */
function derive(kind: BlobKind, data: Buffer, mime: string, name: string): NewBlob {
  const hash = sha256(data);
  return { id: `${kind === 'photo' ? 'p' : 'f'}-${hash.slice(0, 40)}`, kind, mime, name, data, sha256: hash };
}

const JPEG_DATA_URL = /^data:image\/jpeg;base64,([A-Za-z0-9+/]*={0,2})$/;

const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;

/**
 * Löst Fotos (Data-URL in `src`) und Dateien (Base64 in `data`) aus dem Inhalt eines Protokolls heraus und ersetzt sie durch
 * Verweise. Das Ergebnis hängt nur vom Inhalt ab und hat keine Nebenwirkungen: Wer Blobs braucht, speichert `blobs` danach selbst.
 * Bleibt nichts zu tun, kommt derselbe Inhalt (dasselbe Objekt) zurück.
 *
 * `strict`: Unbrauchbares (kein JPEG, kein Base64, zu groß) ist ein Fehler. Sonst bleibt es unverändert im Inhalt stehen und wird
 * gezählt. So scheitert die Migration alter Daten nicht an einem einzigen kaputten Anhang.
 */
export function normalizeContent(content: unknown, strict: boolean): Normalized {
  const found = new Map<string, NewBlob>();
  let skipped = 0;
  const refuse = (message: string): void => {
    if (strict) throw new BlobError(message, 400);
    skipped++;
  };

  const photo = (node: Node): Node => {
    const attrs = node.attrs;
    const src = attrs?.src;
    if (!attrs || typeof src !== 'string' || !src.startsWith('data:')) return node;
    const m = JPEG_DATA_URL.exec(src);
    if (!m) {
      refuse('Foto: nur JPEG erlaubt');
      return node;
    }
    const data = decodeBase64(m[1]!);
    if (!data || !isJpeg(data)) {
      refuse('Foto: kein gültiges JPEG');
      return node;
    }
    if (strict && data.length > MAX_PHOTO_BYTES) {
      refuse(`Foto ist größer als ${mb(MAX_PHOTO_BYTES)}`);
      return node;
    }
    const blob = derive('photo', data, 'image/jpeg', '');
    found.set(blob.id, blob);
    const { src: _src, ...rest } = attrs;
    void _src;
    return { ...node, attrs: { ...rest, blobId: blob.id, mime: 'image/jpeg' } };
  };

  const attachment = (node: Node): Node => {
    const attrs = node.attrs;
    const text = attrs?.data;
    if (!attrs || typeof text !== 'string' || text === '') return node;
    const data = decodeBase64(text);
    if (!data) {
      refuse('Anhang: Daten sind kein gültiges Base64');
      return node;
    }
    if (strict && data.length > MAX_FILE_BYTES) {
      refuse(`Anhang ist größer als ${mb(MAX_FILE_BYTES)}`);
      return node;
    }
    const mime = cleanMime(attrs.mime);
    const name = cleanName(attrs.name) || 'Datei';
    const blob = derive('file', data, mime, name);
    if (!found.has(blob.id)) found.set(blob.id, blob);
    const { data: _data, ...rest } = attrs;
    void _data;
    return { ...node, attrs: { ...rest, name, mime, size: data.length, blobId: blob.id } };
  };

  const walk = (n: unknown): unknown => {
    if (!n || typeof n !== 'object' || Array.isArray(n)) return n;
    let node = n as Node;
    if (node.type === 'photo') node = photo(node);
    else if (node.type === 'attachment') node = attachment(node);
    if (Array.isArray(node.content)) {
      let changed = false;
      const next = node.content.map((c: unknown) => {
        const w = walk(c);
        if (w !== c) changed = true;
        return w;
      });
      if (changed) node = { ...node, content: next };
    }
    return node;
  };

  const out = walk(content);
  return { content: out, blobs: [...found.values()], skipped };
}

/** Speichert ausgelagerte Blobs. Dieselbe Kennung gibt es schon: Die Schonfrist beginnt von vorn. Liefert die Zahl neu angelegter. */
export function saveBlobs(db: DatabaseSync, blobs: NewBlob[], uploaderId: string, now = Date.now()): number {
  let created = 0;
  for (const b of blobs) {
    if (storeBlob(db, { id: b.id, kind: b.kind, name: b.name, mime: b.mime, data: b.data, uploaderId, sha256: b.sha256, now }).created) created++;
  }
  return created;
}
