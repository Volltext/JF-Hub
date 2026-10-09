import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { listBackups, restoreFromFile } from './backup.js';
import { storeBlob } from './blobs.js';
import { nextRev, openDb } from './db.js';
import { migrateBlobs } from './migrate.js';
import { applySync, type ClientChange } from './sync.js';

const USER = { id: 'u1', role: 'betreuer' as const };
let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jfh-mig-'));
  db = openDb(':memory:');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const jpeg = (size = 64): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(size), Buffer.from([0xff, 0xd9])]);
const dataUrl = (b: Buffer) => `data:image/jpeg;base64,${b.toString('base64')}`;

interface Node {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
}
const p = (text: string): Node => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const photoInline = (b: Buffer, attrs: Record<string, unknown> = {}): Node => ({ type: 'photo', attrs: { src: dataUrl(b), w: 800, h: 600, caption: '', ...attrs } });
const fileInline = (b: Buffer, attrs: Record<string, unknown> = {}): Node => ({ type: 'attachment', attrs: { name: 'Plan.pdf', mime: 'application/pdf', size: b.length, data: b.toString('base64'), ...attrs } });
const doc = (...content: Node[]) => ({ type: 'doc', content });

/** Schreibt ein Protokoll so, wie es vor dieser Version in der Datenbank stand: Fotos und Dateien stecken im Inhalt. */
function legacy(target: DatabaseSync, id: string, content: unknown, owner = 'u1'): number {
  const rev = nextRev(target);
  target
    .prepare(
      `INSERT INTO protocols(id, title, folderId, datum, beginn, ende, ort, leitung, content, ownerId, shared, hiddenRev, rev, updatedAt, deletedAt)
       VALUES(?, 'Alt', '', '2026-01-01', '', '', '', '', ?, ?, 1, NULL, ?, 1234, NULL)`,
    )
    .run(id, JSON.stringify(content), owner, rev);
  return rev;
}

const row = (target: DatabaseSync, id: string) =>
  target.prepare('SELECT content, rev, updatedAt, migratedFrom FROM protocols WHERE id = ?').get(id) as { content: string; rev: number; updatedAt: number; migratedFrom: number | null };
const count = (target: DatabaseSync, table: string) => (target.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

describe('Migration: Anhänge aus den Protokollen in Blobs', () => {
  it('zieht Fotos und Dateien heraus, ohne die Änderungszeit anzufassen', () => {
    const a = jpeg(3000);
    const f = randomBytes(4000);
    const rev0 = legacy(db, 'doc-0001', doc(p('Text'), photoInline(a, { caption: 'Teich' }), fileInline(f)));

    const result = migrateBlobs(db);
    expect(result).toMatchObject({ protocols: 1, blobs: 2, skipped: 0 });

    const r = row(db, 'doc-0001');
    expect(r.updatedAt).toBe(1234);
    expect(r.rev).toBeGreaterThan(rev0);
    expect(r.migratedFrom).toBe(rev0);
    expect(r.content.length).toBeLessThan(1000);
    const nodes = (JSON.parse(r.content) as Node).content!;
    expect(nodes[1]!.attrs).toMatchObject({ caption: 'Teich', mime: 'image/jpeg', w: 800, h: 600, blobId: expect.stringMatching(/^p-/) });
    expect(nodes[1]!.attrs).not.toHaveProperty('src');
    expect(nodes[2]!.attrs).toEqual({ name: 'Plan.pdf', mime: 'application/pdf', size: 4000, blobId: expect.stringMatching(/^f-/) });
    expect(db.prepare('SELECT kind, size, uploaderId FROM blobs ORDER BY kind').all()).toEqual([
      { kind: 'file', size: 4000, uploaderId: 'u1' },
      { kind: 'photo', size: a.length, uploaderId: 'u1' },
    ]);
    expect(count(db, 'blob_refs')).toBe(2);
  });

  it('ist wiederholbar: ein zweiter Lauf findet nichts mehr und ändert nichts', () => {
    legacy(db, 'doc-0001', doc(photoInline(jpeg())));
    migrateBlobs(db);
    const before = db.prepare('SELECT * FROM protocols').all();
    const again = migrateBlobs(db);
    expect(again).toMatchObject({ protocols: 0, blobs: 0, skipped: 0 });
    expect(db.prepare('SELECT * FROM protocols').all()).toEqual(before);
  });

  it('fasst gleiche Fotos zusammen (auch die Flut aus Konfliktkopien früherer Versionen)', () => {
    const a = jpeg(2000);
    for (let i = 1; i <= 5; i++) legacy(db, `kopie-000${i}`, doc(p(`Kopie ${i}`), photoInline(a)));
    const result = migrateBlobs(db);
    expect(result).toMatchObject({ protocols: 5, blobs: 1 });
    expect(count(db, 'blobs')).toBe(1);
    expect(count(db, 'blob_refs')).toBe(5);
  });

  it('der Besitzer des Protokolls gilt als Hochladender', () => {
    legacy(db, 'doc-0001', doc(photoInline(jpeg())), 'anna');
    migrateBlobs(db);
    expect(db.prepare('SELECT uploaderId FROM blobs').all()).toEqual([{ uploaderId: 'anna' }]);
  });

  it('lässt Unbrauchbares im Protokoll stehen, statt zu scheitern, und zählt es', () => {
    const good = jpeg();
    const png: Node = { type: 'photo', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=', w: 1, h: 1, caption: '' } };
    legacy(db, 'doc-0001', doc(photoInline(good), png));
    const result = migrateBlobs(db);
    expect(result).toMatchObject({ protocols: 1, blobs: 1, skipped: 1 });
    const nodes = (JSON.parse(row(db, 'doc-0001').content) as Node).content!;
    expect(nodes[0]!.attrs).toHaveProperty('blobId');
    expect(nodes[1]!.attrs).toHaveProperty('src', 'data:image/png;base64,iVBORw0KGgo='); // unverändert
  });

  it('übergeht Protokolle, deren Inhalt nicht gelesen werden kann', () => {
    db.prepare(
      `INSERT INTO protocols(id, title, content, ownerId, shared, rev, updatedAt) VALUES('kaputt-001', 'Kaputt', '{"type":"doc","content":[{"type":"photo","attrs":{"src":"data:image/jpeg;base64,AAAA", kaputt', 'u1', 1, ?, 1)`,
    ).run(nextRev(db));
    legacy(db, 'doc-0001', doc(photoInline(jpeg())));
    expect(migrateBlobs(db)).toMatchObject({ protocols: 1, blobs: 1, skipped: 1 });
  });

  it('legt vor dem Eingriff ein Backup der Art „update“ an, nur wenn es etwas zu tun gibt', () => {
    const backups = join(dir, 'backups');
    expect(migrateBlobs(db, { backupDir: backups })).toMatchObject({ protocols: 0 });
    expect(existsSync(backups) ? listBackups(backups) : []).toEqual([]);

    const a = jpeg(1000);
    legacy(db, 'doc-0001', doc(photoInline(a)));
    const result = migrateBlobs(db, { backupDir: backups });
    expect(result.backup).toMatch(/^jf-hub-update-\d{8}-\d{6}\.sqlite$/);
    expect(listBackups(backups).map((b) => b.kind)).toEqual(['update']);

    // Das Backup zeigt den Stand vor der Migration (Daten noch im Protokoll).
    const before = new DatabaseSync(join(backups, result.backup!), { readOnly: true });
    try {
      expect((before.prepare('SELECT content FROM protocols WHERE id = ?').get('doc-0001') as { content: string }).content).toContain('data:image/jpeg;base64,');
    } finally {
      before.close();
    }
  });

  it('eine Bearbeitung auf dem Stand vor der Migration ist kein Konflikt', () => {
    const rev0 = legacy(db, 'doc-0001', doc(p('alt'), photoInline(jpeg())));
    migrateBlobs(db);
    const edit = (baseRev: number, title: string): ClientChange => ({
      id: 'doc-0001',
      baseRev,
      title,
      datum: '2026-01-01',
      beginn: '',
      ende: '',
      ort: '',
      leitung: '',
      content: doc(p('Offline geändert')),
      updatedAt: Date.now(),
      deleted: false,
    });
    const first = applySync(db, { since: 0, changes: [edit(rev0, 'Offline')] }, USER);
    expect(first.conflicts).toEqual([]);
    expect(first.changes.find((c) => c.id === 'doc-0001')).toMatchObject({ title: 'Offline' });
    expect(row(db, 'doc-0001').migratedFrom).toBeNull();

    // Dieselbe alte Basis noch einmal von einem anderen Gerät: jetzt ist es ein echter Konflikt.
    const second = applySync(db, { since: 0, changes: [edit(rev0, 'Anderes Gerät')] }, USER);
    expect(second.conflicts).toHaveLength(1);
  });
});

describe('Migration beim Start und bei der Wiederherstellung', () => {
  it('der Start migriert vorhandene Daten und sichert vorher', async () => {
    const live = openDb(join(dir, 'jf-hub.sqlite'));
    legacy(live, 'doc-0001', doc(photoInline(jpeg(500))));
    const backups = join(dir, 'backups');
    const app = await buildApp({ db: live, adminPassword: 'ein-sicheres-passwort', pushTimer: false, backupTimer: false, backupDir: backups });
    try {
      expect(row(live, 'doc-0001').content).not.toContain('data:image');
      expect(count(live, 'blobs')).toBe(1);
      expect(listBackups(backups).map((b) => b.kind)).toEqual(['update']);
    } finally {
      await app.close();
      live.close();
    }
  });

  it('scheitert der Umbau beim Start, läuft der Server trotzdem und alles bleibt unverändert', async () => {
    const live = openDb(join(dir, 'jf-hub.sqlite'));
    legacy(live, 'doc-0001', doc(photoInline(jpeg(500))));
    live.exec("CREATE TRIGGER voll BEFORE INSERT ON blobs BEGIN SELECT RAISE(ABORT, 'Platte voll'); END;");
    const app = await buildApp({ db: live, adminPassword: 'ein-sicheres-passwort', pushTimer: false, backupTimer: false, backupDir: join(dir, 'backups') });
    try {
      expect(row(live, 'doc-0001').content).toContain('data:image/jpeg;base64,'); // nichts halb umgebaut
      expect(count(live, 'blobs')).toBe(0);
      expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
      expect(listBackups(join(dir, 'backups')).map((b) => b.kind)).toEqual(['update']); // die Sicherung gab es vorher
    } finally {
      await app.close();
      live.close();
    }
  });

  it('der Start prüft die Verweise gegen den Inhalt', async () => {
    const live = openDb(join(dir, 'jf-hub.sqlite'));
    storeBlob(live, { id: 'foto-0001', kind: 'photo', name: '', mime: 'image/jpeg', data: jpeg(100), uploaderId: 'u1' });
    legacy(live, 'doc-0001', doc({ type: 'photo', attrs: { blobId: 'foto-0001', mime: 'image/jpeg', w: 1, h: 1, caption: '' } }));
    expect(count(live, 'blob_refs')).toBe(0); // so kann eine Datenbank nach einem Eingriff von Hand aussehen
    const app = await buildApp({ db: live, adminPassword: 'ein-sicheres-passwort', pushTimer: false, backupTimer: false });
    try {
      expect(live.prepare('SELECT blobId, protocolId FROM blob_refs').all()).toEqual([{ blobId: 'foto-0001', protocolId: 'doc-0001' }]);
    } finally {
      await app.close();
      live.close();
    }
  });

  it('eine Sicherung aus einer älteren Version wird beim Einspielen migriert', () => {
    const old = openDb(join(dir, 'alt.sqlite'));
    old.prepare("INSERT INTO users(id, username, displayName, role, passwordHash, createdAt) VALUES('u1','admin','Admin','admin','x',1)").run();
    const a = jpeg(700);
    legacy(old, 'doc-0001', doc(p('Alt'), photoInline(a)));
    old.close();

    const live = openDb(':memory:');
    restoreFromFile(live, join(dir, 'alt.sqlite'));
    expect(row(live, 'doc-0001').content).not.toContain('data:image');
    expect(live.prepare('SELECT size FROM blobs').all()).toEqual([{ size: a.length }]);
    expect(count(live, 'blob_refs')).toBe(1);
  });

  it('eine Sicherung ohne die neuen Tabellen wird angenommen', () => {
    const old = new DatabaseSync(join(dir, 'sehr-alt.sqlite'));
    old.exec(`
      CREATE TABLE protocols (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '{}', rev INTEGER NOT NULL, updatedAt INTEGER NOT NULL, deletedAt INTEGER);
      CREATE TABLE records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', rev INTEGER NOT NULL, updatedAt INTEGER NOT NULL, deletedAt INTEGER, PRIMARY KEY (collection, id));
      CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE sessions (hash TEXT PRIMARY KEY, device TEXT NOT NULL, createdAt INTEGER NOT NULL, lastUsedAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL);
      INSERT INTO protocols(id, title, rev, updatedAt, content) VALUES('p1', 'Aus 1.x', 1, 1, '{"type":"doc","content":[]}');
      INSERT INTO config(key, value) VALUES('passwordHash', 'hash');
    `);
    old.close();
    const live = openDb(':memory:');
    live.prepare('INSERT INTO blobs(id, sha256, size, mime, name, kind, uploaderId, uploadedAt, data) VALUES(?,?,?,?,?,?,?,?,?)').run('x-0000001', 'h', 1, 'image/jpeg', '', 'photo', 'u1', 1, Buffer.from([1]));
    restoreFromFile(live, join(dir, 'sehr-alt.sqlite'));
    expect(count(live, 'protocols')).toBe(1);
    expect(count(live, 'blobs')).toBe(0); // Der Stand der Sicherung gilt, auch für die Blobs.
  });
});
