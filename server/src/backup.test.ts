import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { createBackup, listBackups, pruneBackups, restoreFromFile, runAutoBackup, RestoreError } from './backup.js';
import { getConfig, getEpoch, openDb, setConfig } from './db.js';
import type { ClientChange, SyncResponse } from './sync.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jfh-bt-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string) => new Date(iso);
const rows = (db: DatabaseSync, sql: string) => db.prepare(sql).all() as Record<string, unknown>[];

function seed(db: DatabaseSync, title: string) {
  db.prepare("INSERT INTO users(id, username, displayName, role, passwordHash, createdAt) VALUES('u1','admin','Admin','admin','x',1) ON CONFLICT(id) DO NOTHING").run();
  db.prepare("INSERT INTO protocols(id, title, rev, updatedAt, ownerId) VALUES(?, ?, 1, 1, 'u1')").run(`p-${title}`, title);
}

describe('Backups anlegen und aufräumen', () => {
  it('legt Dateien mit Art und Zeitpunkt an, auch bei gleicher Sekunde', () => {
    const db = openDb(':memory:');
    const a = createBackup(db, dir, 'manuell', at('2026-10-05T10:00:00'));
    const b = createBackup(db, dir, 'manuell', at('2026-10-05T10:00:00'));
    expect(a.name).toBe('jf-hub-manuell-20261005-100000.sqlite');
    expect(b.name).not.toBe(a.name);
    expect(listBackups(dir)).toHaveLength(2);
  });

  it('behält nur die letzten automatischen Backups, manuelle bleiben', () => {
    const db = openDb(':memory:');
    for (let d = 1; d <= 5; d++) createBackup(db, dir, 'auto', at(`2026-10-0${d}T03:00:00`));
    createBackup(db, dir, 'manuell', at('2026-09-01T03:00:00'));
    pruneBackups(dir, 2);
    const names = listBackups(dir).map((b) => b.name);
    expect(names).toEqual(['jf-hub-auto-20261005-030000.sqlite', 'jf-hub-auto-20261004-030000.sqlite', 'jf-hub-manuell-20260901-030000.sqlite']);
  });

  it('ignoriert fremde Dateien im Ordner', () => {
    writeFileSync(join(dir, 'notizen.txt'), 'x');
    writeFileSync(join(dir, '../evil.sqlite'), 'x', { flag: 'w' });
    rmSync(join(dir, '../evil.sqlite'), { force: true });
    expect(listBackups(dir)).toEqual([]);
  });

  it('automatisch höchstens einmal pro Tag, abschaltbar', () => {
    const db = openDb(':memory:');
    expect(runAutoBackup(db, dir, at('2026-10-05T03:00:00'))).not.toBeNull();
    expect(runAutoBackup(db, dir, at('2026-10-05T15:00:00'))).toBeNull();
    expect(runAutoBackup(db, dir, at('2026-10-06T03:00:00'))).not.toBeNull();
    setConfig(db, 'backupKeep', '0');
    expect(runAutoBackup(db, dir, at('2026-10-08T03:00:00'))).toBeNull();
  });
});

describe('Wiederherstellen', () => {
  it('stellt den Inhalt wieder her, behält Push-Schlüssel und dreht Revision nicht zurück', () => {
    const db = openDb(':memory:');
    seed(db, 'alt');
    setConfig(db, 'vapidPublic', 'pub-alt');
    setConfig(db, 'revCounter', '5');
    const epoch = getEpoch(db);
    const backup = createBackup(db, dir, 'manuell');

    seed(db, 'neu');
    setConfig(db, 'vapidPublic', 'pub-neu');
    setConfig(db, 'revCounter', '9');

    restoreFromFile(db, join(dir, backup.name));

    expect(rows(db, 'SELECT title FROM protocols ORDER BY title')).toEqual([{ title: 'alt' }]);
    expect(getConfig(db, 'vapidPublic')).toBe('pub-neu');
    expect(getConfig(db, 'revCounter')).toBe('9');
    expect(getEpoch(db)).not.toBe(epoch);
  });

  it('nimmt eine Sicherung ohne neuere Spalten an (Migration)', () => {
    const old = new DatabaseSync(join(dir, 'alt.sqlite'));
    old.exec(`
      CREATE TABLE protocols (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '{}', rev INTEGER NOT NULL, updatedAt INTEGER NOT NULL, deletedAt INTEGER);
      CREATE TABLE records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', rev INTEGER NOT NULL, updatedAt INTEGER NOT NULL, deletedAt INTEGER, PRIMARY KEY (collection, id));
      CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE sessions (hash TEXT PRIMARY KEY, device TEXT NOT NULL, createdAt INTEGER NOT NULL, lastUsedAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL);
      INSERT INTO protocols(id, title, rev, updatedAt) VALUES('p1', 'Aus 1.x', 1, 1);
      INSERT INTO config(key, value) VALUES('passwordHash', 'hash');
    `);
    old.close();
    const db = openDb(':memory:');
    seed(db, 'heute');
    restoreFromFile(db, join(dir, 'alt.sqlite'));
    expect(rows(db, 'SELECT title, ownerId FROM protocols')).toEqual([{ title: 'Aus 1.x', ownerId: expect.any(String) }]);
    expect(rows(db, "SELECT username, role FROM users")).toEqual([{ username: 'admin', role: 'admin' }]);
  });

  it('lehnt Fremdes ab und lässt die Datenbank unverändert', () => {
    const db = openDb(':memory:');
    seed(db, 'bleibt');
    writeFileSync(join(dir, 'text.sqlite'), 'das ist keine datenbank, nur text '.repeat(10));
    expect(() => restoreFromFile(db, join(dir, 'text.sqlite'))).toThrow(RestoreError);

    const other = new DatabaseSync(join(dir, 'andere.sqlite'));
    other.exec('CREATE TABLE etwas (a TEXT)');
    other.close();
    expect(() => restoreFromFile(db, join(dir, 'andere.sqlite'))).toThrow(/keine JF-Hub-Sicherung/);

    const leer = openDb(join(dir, 'leer.sqlite'));
    leer.close();
    expect(() => restoreFromFile(db, join(dir, 'leer.sqlite'))).toThrow(/Admin-Konto/);

    expect(rows(db, 'SELECT title FROM protocols')).toEqual([{ title: 'bleibt' }]);
  });
});

describe('Backup-API', () => {
  let app: FastifyInstance;
  let token: string;
  const PW = 'ein-sicheres-passwort';
  const auth = () => ({ authorization: `Bearer ${token}` });

  beforeEach(async () => {
    app = await buildApp({ db: openDb(':memory:'), adminPassword: PW, pushTimer: false, backupTimer: false, backupDir: join(dir, 'backups') });
    const r = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW } });
    token = r.json().token;
  });
  afterEach(async () => {
    await app.close();
  });

  const protocol = (id: string, title: string): ClientChange => ({
    id,
    baseRev: 0,
    title,
    datum: '2026-10-01',
    beginn: '',
    ende: '',
    ort: '',
    leitung: '',
    content: { type: 'doc', content: [] },
    updatedAt: Date.now(),
    deleted: false,
  });
  const titles = async () => {
    const r = await app.inject({ method: 'POST', url: '/api/sync', headers: auth(), payload: { since: 0, changes: [] } });
    return (r.json() as SyncResponse).changes.filter((p) => !p.deleted).map((p) => p.title);
  };

  it('sichert, lädt herunter, stellt wieder her und legt vorher eine Sicherung an', async () => {
    await app.inject({ method: 'POST', url: '/api/sync', headers: auth(), payload: { since: 0, changes: [protocol('doc-aaaa', 'Vorher')] } });
    const made = await app.inject({ method: 'POST', url: '/api/admin/backups', headers: auth() });
    expect(made.statusCode).toBe(200);
    const name = made.json().name as string;
    await app.inject({ method: 'POST', url: '/api/sync', headers: auth(), payload: { since: 0, changes: [protocol('doc-bbbb', 'Nachher')] } });
    expect((await titles()).sort()).toEqual(['Nachher', 'Vorher']);

    const dl = await app.inject({ method: 'GET', url: `/api/admin/backups/${name}`, headers: auth() });
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.subarray(0, 15).toString()).toBe('SQLite format 3');

    const res = await app.inject({ method: 'POST', url: `/api/admin/backups/${name}/restore`, headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(await titles()).toEqual(['Vorher']);

    const list = (await app.inject({ method: 'GET', url: '/api/admin/backups', headers: auth() })).json();
    expect(list.items.map((b: { kind: string }) => b.kind).sort()).toEqual(['manuell', 'vorher']);
  });

  it('stellt aus hochgeladener Datei wieder her und weist Müll ab', async () => {
    await app.inject({ method: 'POST', url: '/api/sync', headers: auth(), payload: { since: 0, changes: [protocol('doc-aaaa', 'Eins')] } });
    const name = (await app.inject({ method: 'POST', url: '/api/admin/backups', headers: auth() })).json().name as string;
    const bytes = readFileSync(join(dir, 'backups', name));
    await app.inject({ method: 'POST', url: '/api/sync', headers: auth(), payload: { since: 0, changes: [protocol('doc-bbbb', 'Zwei')] } });

    const bad = await app.inject({ method: 'POST', url: '/api/admin/restore', headers: { ...auth(), 'content-type': 'application/x-sqlite3' }, payload: Buffer.alloc(500, 1) });
    expect(bad.statusCode).toBe(400);
    expect((await titles()).sort()).toEqual(['Eins', 'Zwei']);

    const ok = await app.inject({ method: 'POST', url: '/api/admin/restore', headers: { ...auth(), 'content-type': 'application/x-sqlite3' }, payload: bytes });
    expect(ok.statusCode).toBe(200);
    expect(await titles()).toEqual(['Eins']);
  });

  it('erlaubt keine Pfad-Tricks und nur Admins', async () => {
    for (const bad of ['..%2F..%2Fetc%2Fpasswd', 'evil.sqlite']) {
      expect((await app.inject({ method: 'GET', url: `/api/admin/backups/${bad}`, headers: auth() })).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url: `/api/admin/backups/${bad}/restore`, headers: auth() })).statusCode).toBe(404);
      expect((await app.inject({ method: 'DELETE', url: `/api/admin/backups/${bad}`, headers: auth() })).statusCode).toBe(404);
    }
    const invite = await app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(), payload: { username: 'anna', displayName: 'Anna' } });
    const acc = await app.inject({ method: 'POST', url: '/api/invite/accept', payload: { username: 'anna', code: invite.json().invite.code, password: 'anna-passwort-123' } });
    const annaAuth = { authorization: `Bearer ${acc.json().token}` };
    expect((await app.inject({ method: 'GET', url: '/api/admin/backups', headers: annaAuth })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/admin/restore', headers: { ...annaAuth, 'content-type': 'application/x-sqlite3' }, payload: Buffer.alloc(500) })).statusCode).toBe(403);
  });

  it('meldet, wenn kein Backup-Ordner eingerichtet ist', async () => {
    const plain = await buildApp({ db: openDb(':memory:'), adminPassword: PW, pushTimer: false });
    const t = (await plain.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW } })).json().token;
    const h = { authorization: `Bearer ${t}` };
    expect((await plain.inject({ method: 'GET', url: '/api/admin/backups', headers: h })).json()).toMatchObject({ enabled: false, items: [] });
    expect((await plain.inject({ method: 'POST', url: '/api/admin/backups', headers: h })).statusCode).toBe(404);
    await plain.close();
  });
});
