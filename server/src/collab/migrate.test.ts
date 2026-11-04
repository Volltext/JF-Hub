import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { DatabaseSync } from 'node:sqlite';
import { buildApp } from '../app.js';
import { createBackup, listBackups, restoreFromFile } from '../backup.js';
import { openDb, type ProtocolRow } from '../db.js';
import { resetDemo } from '../demo.js';
import { canonicalJson, yDocToJson, type DocNode } from './convert.js';
import { exchange } from './exchange.js';
import { migrateBlobs } from '../migrate.js';
import { collabStats, migrateYjs } from './migrate.js';
import { createPeers } from './peers.js';
import { putProtocol } from './testing.js';

let dir: string;
let db: DatabaseSync;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jfh-ymig-'));
  db = openDb(':memory:');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const p = (text: string): DocNode => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const doc = (...content: DocNode[]): DocNode => ({ type: 'doc', content });
const row = (id: string, target: DatabaseSync = db) => target.prepare('SELECT * FROM protocols WHERE id = ?').get(id) as unknown as ProtocolRow;
const ydoc = (id: string, target: DatabaseSync = db) => target.prepare('SELECT state, sv, updatedAt FROM ydocs WHERE id = ?').get(id) as { state: Uint8Array; sv: Uint8Array; updatedAt: number } | undefined;
const count = (table: string, target: DatabaseSync = db) => (target.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
/** Ein Protokoll im Stand vor 3.0.0: der Text steht nur als JSON in der Zeile. */
const legacy = (id: string, content: DocNode, extra: Parameters<typeof putProtocol>[1] = {}) => putProtocol(db, { id, title: `Titel ${id}`, ymode: 0, content, updatedAt: 1234, ...extra });

describe('migrateYjs', () => {
  it('stellt ein Protokoll um: Zustand und ymode neu, Inhalt und Änderungszeit unberührt, Revision höher', () => {
    const content = doc({ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Überschrift' }] }, p('Hallo Welt'), { type: 'photo', attrs: { blobId: 'foto-0001', mime: 'image/jpeg', w: 3, h: 2, caption: 'Teich' } });
    legacy('doc-0001', content);
    const before = row('doc-0001');

    const result = migrateYjs(db);
    expect(result).toMatchObject({ migrated: 1, failed: [] });

    const after = row('doc-0001');
    expect(after.ymode).toBe(1);
    expect(after.content).toBe(before.content); // der Schnappschuss bleibt, wie er war
    expect(after.updatedAt).toBe(1234);
    expect(after.rev).toBeGreaterThan(before.rev); // damit alle Geräte erfahren, dass der Text nun zusammen bearbeitet wird

    const stored = ydoc('doc-0001')!;
    const restored = new Y.Doc();
    Y.applyUpdate(restored, stored.state);
    expect(canonicalJson(yDocToJson(restored))).toBe(canonicalJson(content));
    expect(Buffer.from(stored.sv).equals(Buffer.from(Y.encodeStateVector(restored)))).toBe(true);
  });

  it('ein leeres Protokoll wird umgestellt, ohne einen Zustand anzulegen (wie ein neu angelegtes)', () => {
    legacy('doc-0001', doc());
    expect(migrateYjs(db)).toMatchObject({ migrated: 1, failed: [] });
    expect(row('doc-0001').ymode).toBe(1);
    expect(ydoc('doc-0001')).toBeUndefined();
  });

  it('trägt Protokolle im Papierkorb mit um, übergeht geleerte und rührt Umgestelltes nicht an', () => {
    legacy('doc-0001', doc(p('im Papierkorb')), { deleted: true });
    legacy('doc-0002', doc(), { purged: true });
    putProtocol(db, { id: 'doc-0003', content: doc(p('schon Yjs')) });
    const revs = Object.fromEntries(['doc-0001', 'doc-0002', 'doc-0003'].map((id) => [id, row(id).rev]));

    expect(migrateYjs(db)).toMatchObject({ migrated: 1, failed: [] });
    expect(row('doc-0001').ymode).toBe(1);
    expect(ydoc('doc-0001')).toBeDefined();
    expect(row('doc-0002').ymode).toBe(0); // der Grabstein hat keinen Text
    expect(row('doc-0003').rev).toBe(revs['doc-0003']);
    expect(row('doc-0002').rev).toBe(revs['doc-0002']);
  });

  it('ist wiederholbar: der zweite Lauf findet nichts und ändert nichts', () => {
    legacy('doc-0001', doc(p('Hallo')));
    migrateYjs(db);
    const snapshot = { rev: row('doc-0001').rev, state: Buffer.from(ydoc('doc-0001')!.state).toString('base64') };
    expect(migrateYjs(db, { backupDir: join(dir, 'backups') })).toMatchObject({ migrated: 0, failed: [] });
    expect(row('doc-0001').rev).toBe(snapshot.rev);
    expect(Buffer.from(ydoc('doc-0001')!.state).toString('base64')).toBe(snapshot.state);
    expect(existsSync(join(dir, 'backups'))).toBe(false); // nichts zu tun, kein Backup
  });

  it('ein Protokoll, das nicht umgestellt werden kann, bleibt wie es ist und wird gemeldet; die übrigen laufen', () => {
    legacy('gut-0001', doc(p('gut')));
    // zwei gleiche Formate an einem Text: Yjs kennt ein Format nur einmal, die Gegenprobe fällt durch
    legacy('doppelt1', doc({ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'bold' }] }] }));
    db.prepare("INSERT INTO protocols(id, title, content, rev, updatedAt, ownerId, shared, ymode) VALUES('kaputt-01', 'Kaputt', '{\"type\":\"doc\",\"content\":[', ?, 1, '', 1, 0)").run(900);
    let deep: DocNode = p('tief');
    for (let i = 0; i < 150; i++) deep = { type: 'blockquote', content: [deep] };
    legacy('tief-0001', doc(deep));
    legacy('gut-0002', doc(p('auch gut')));

    const result = migrateYjs(db);
    expect(result.migrated).toBe(2);
    expect(result.failed.map((f) => f.id).sort()).toEqual(['doppelt1', 'kaputt-01', 'tief-0001']);
    for (const f of result.failed) {
      expect(f.title).toBeTruthy();
      expect(f.reason).toBeTruthy();
    }
    for (const id of ['doppelt1', 'kaputt-01', 'tief-0001']) {
      expect(row(id).ymode, id).toBe(0);
      expect(ydoc(id), id).toBeUndefined();
    }
    expect(row('doppelt1').content).toContain('bold'); // unverändert
    expect(row('gut-0001').ymode).toBe(1);
    expect(row('gut-0002').ymode).toBe(1);
  });

  it('Inhalte mit einem einzelnen Surrogat oder einem ausdrücklichen null bei einem Attribut mit Vorgabe werden umgestellt, statt für immer nur lesbar zu bleiben', () => {
    legacy('surr-0001', doc(p('Teich \uD83D')));
    legacy('null-0001', doc({ type: 'orderedList', attrs: { start: null }, content: [{ type: 'listItem', content: [p('eins')] }] }, { type: 'heading', attrs: { level: null }, content: [{ type: 'text', text: 'H' }] }));
    expect(migrateYjs(db)).toMatchObject({ migrated: 2, failed: [] });
    const state = new Y.Doc();
    Y.applyUpdate(state, ydoc('surr-0001')!.state);
    expect(JSON.stringify(yDocToJson(state))).toContain('Teich \uFFFD');
  });

  it('ein Protokoll, aus dem sich noch Anhänge auslagern lassen, kommt erst danach dran, und ohne Arbeit gibt es kein Backup', () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7), Buffer.from([0xff, 0xd9])]);
    const inline = doc(p('Text'), { type: 'photo', attrs: { src: `data:image/jpeg;base64,${jpeg.toString('base64')}`, w: 1, h: 1, caption: '' } });
    legacy('doc-0001', inline);
    const backups = join(dir, 'backups');
    const first = migrateYjs(db, { backupDir: backups });
    expect(first.migrated).toBe(0);
    expect(first.failed).toMatchObject([{ id: 'doc-0001', reason: expect.stringContaining('ausgelagert') }]);
    expect(first.backup).toBeUndefined();
    expect(existsSync(backups)).toBe(false);
    expect(row('doc-0001').ymode).toBe(0);
    expect(ydoc('doc-0001')).toBeUndefined();

    // Nach der Auslagerung der Anhänge geht es durch.
    migrateBlobs(db);
    expect(migrateYjs(db)).toMatchObject({ migrated: 1, failed: [] });
    expect(row('doc-0001').ymode).toBe(1);
    expect(row('doc-0001').content).not.toContain('data:image');
  });

  it('wurde im selben Start schon gesichert, bleibt es bei einem Backup', () => {
    const backups = join(dir, 'backups');
    legacy('doc-0001', doc(p('vorher')));
    const result = migrateYjs(db, { backupDir: backups, backedUp: true });
    expect(result.migrated).toBe(1);
    expect(result.backup).toBeUndefined();
    expect(existsSync(backups)).toBe(false);
  });

  it('ein Schreibfehler bei einem Protokoll macht nur dieses rückgängig', () => {
    legacy('doc-aaaa', doc(p('eins')));
    legacy('doc-bbbb', doc(p('zwei')));
    legacy('doc-cccc', doc(p('drei')));
    db.exec("CREATE TRIGGER boom BEFORE INSERT ON ydocs WHEN NEW.id = 'doc-bbbb' BEGIN SELECT RAISE(ABORT, 'Platte voll'); END");
    const result = migrateYjs(db);
    expect(result.migrated).toBe(2);
    expect(result.failed).toEqual([{ id: 'doc-bbbb', title: 'Titel doc-bbbb', reason: 'Platte voll' }]);
    expect(row('doc-bbbb').ymode).toBe(0);
    expect(row('doc-aaaa').ymode).toBe(1);
    expect(row('doc-cccc').ymode).toBe(1);
    // nach dem Beheben läuft der nächste Versuch durch
    db.exec('DROP TRIGGER boom');
    expect(migrateYjs(db)).toMatchObject({ migrated: 1, failed: [] });
    expect(row('doc-bbbb').ymode).toBe(1);
  });

  it('legt vor dem Eingriff ein Backup der Art „update“ an, mit dem Stand davor', () => {
    const backups = join(dir, 'backups');
    legacy('doc-0001', doc(p('vorher')));
    const result = migrateYjs(db, { backupDir: backups });
    expect(result.backup).toMatch(/^jf-hub-update-\d{8}-\d{6}\.sqlite$/);
    expect(listBackups(backups).map((b) => b.kind)).toEqual(['update']);
  });

  it('merkt sich Fehlschläge für die Verwaltung und räumt sie nach einem Erfolg ab', () => {
    legacy('gut-0001', doc(p('gut')));
    legacy('doppelt1', doc({ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'bold' }] }] }));
    migrateYjs(db);
    const stats = collabStats(db, { id: 'u-admin', role: 'admin' });
    expect(stats).toMatchObject({ docs: 1, pending: 1 });
    expect(stats.bytes).toBeGreaterThan(0);
    expect(stats.failed).toMatchObject([{ id: 'doppelt1', title: 'Titel doppelt1' }]);

    // das Protokoll wird beim Gerät bearbeitet (hier: Zeile ersetzt) und der nächste Lauf ist sauber
    db.prepare("UPDATE protocols SET content = ? WHERE id = 'doppelt1'").run(JSON.stringify(doc(p('repariert'))));
    migrateYjs(db);
    expect(collabStats(db, { id: 'u-admin', role: 'admin' })).toMatchObject({ docs: 2, pending: 0, failed: [] });
  });

  it('der Austausch liefert nach der Umstellung den Text, auch für ein Gerät ohne Vorwissen', () => {
    const owner = 'u-anna';
    legacy('doc-0001', doc(p('Aus der alten Zeit')), { ownerId: owner });
    migrateYjs(db);
    const res = exchange(db, { docs: [{ id: 'doc-0001' }] }, { id: owner, role: 'betreuer' }, createPeers());
    expect(res.docs[0]!.status).toBe('ok');
    const client = new Y.Doc();
    Y.applyUpdate(client, Buffer.from(res.docs[0]!.update!, 'base64'));
    expect(canonicalJson(yDocToJson(client))).toBe(canonicalJson(doc(p('Aus der alten Zeit'))));
  });

  it('scheitert das Backup vor der Umstellung, wird nichts umgestellt, und die Verwaltung nennt den Grund', () => {
    legacy('doc-0001', doc(p('Bestand')));
    const notADir = join(dir, 'datei');
    writeFileSync(notADir, 'keine Ordner');
    const result = migrateYjs(db, { backupDir: notADir });
    expect(result).toMatchObject({ migrated: 0, failed: [] });
    expect(result.error).toMatch(/Backup/);
    expect(row('doc-0001').ymode).toBe(0);
    expect(collabStats(db, { id: 'u-admin', role: 'admin' }).error).toBe(result.error);
    // beim nächsten Start geht es, und der Hinweis verschwindet
    expect(migrateYjs(db, { backupDir: join(dir, 'backups') })).toMatchObject({ migrated: 1 });
    expect(row('doc-0001').ymode).toBe(1);
    expect(collabStats(db, { id: 'u-admin', role: 'admin' }).error).toBeUndefined();
  });

  it('die Verwaltung nennt keine Titel privater Protokolle anderer, weder in der Übersicht noch im Protokoll des Servers', () => {
    const twice = (text: string): DocNode => doc({ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'bold' }, { type: 'bold' }] }] });
    legacy('privat-01', twice('x'), { ownerId: 'u-ben', shared: false, title: 'Bens Arztbrief' });
    legacy('offen-01', twice('y'), { ownerId: 'u-ben', shared: true, title: 'Offener Titel' });
    legacy('eigen-01', twice('z'), { ownerId: 'u-admin', shared: false, title: 'Eigenes Privates' });
    const lines: string[] = [];
    migrateYjs(db, { log: (m) => lines.push(m) });
    const stats = collabStats(db, { id: 'u-admin', role: 'admin' });
    expect(stats.pending).toBe(3);
    const titles = Object.fromEntries(stats.failed.map((f) => [f.id, f.title]));
    expect(titles).toEqual({ 'privat-01': 'Privates Protokoll', 'offen-01': 'Offener Titel', 'eigen-01': 'Eigenes Privates' });
    expect(JSON.stringify(stats)).not.toContain('Arztbrief');
    expect(lines.join('\n')).not.toContain('Arztbrief');
    expect(lines.join('\n')).toContain('privat-01'); // die Kennung genügt für die Suche im Protokoll
  });

  it('die Verwaltung zeigt, wie viele Protokolle umgestellt sind und welche nur lesbar bleiben', async () => {
    legacy('gut-0001', doc(p('gut')));
    legacy('doppelt1', doc({ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'bold' }] }] }));
    const app = await buildApp({ db, adminPassword: 'ein-sicheres-passwort', pushTimer: false, backupTimer: false });
    try {
      const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: 'ein-sicheres-passwort', device: 'Test' } });
      const info = await app.inject({ method: 'GET', url: '/api/admin/info', headers: { authorization: `Bearer ${login.json().token}` } });
      expect(info.statusCode).toBe(200);
      expect(info.json().collab).toMatchObject({ docs: 1, pending: 1, failed: [{ id: 'doppelt1', title: 'Titel doppelt1' }] });
      expect((await app.inject({ method: 'GET', url: '/api/status' })).json().features).toContain('collab');
    } finally {
      await app.close();
    }
  });

  it('vor der Umstellung meldet der Austausch „legacy“', () => {
    const owner = 'u-anna';
    legacy('doc-0001', doc(p('alt')), { ownerId: owner });
    const res = exchange(db, { docs: [{ id: 'doc-0001' }] }, { id: owner, role: 'betreuer' }, createPeers());
    expect(res.docs[0]).toMatchObject({ id: 'doc-0001', status: 'legacy' });
  });
});

describe('Umstellung beim Start, bei der Wiederherstellung und in der Demo', () => {
  it('der Start stellt vorhandene Protokolle um und sichert vorher', async () => {
    const live = openDb(join(dir, 'jf-hub.sqlite'));
    putProtocol(live, { id: 'doc-0001', ymode: 0, content: doc(p('Bestand')) });
    const backups = join(dir, 'backups');
    const app = await buildApp({ db: live, adminPassword: 'ein-sicheres-passwort', pushTimer: false, backupTimer: false, backupDir: backups });
    try {
      expect(row('doc-0001', live).ymode).toBe(1);
      expect(count('ydocs', live)).toBe(1);
      expect(listBackups(backups).map((b) => b.kind)).toEqual(['update']);
    } finally {
      await app.close();
      live.close();
    }
  });

  it('ein Fehler bei der Umstellung hindert den Start nicht', async () => {
    putProtocol(db, { id: 'doc-0001', ymode: 0, content: doc(p('Bestand')) });
    db.exec('DROP TABLE ydocs'); // so geht jeder Schreibversuch schief
    const app = await buildApp({ db, adminPassword: 'ein-sicheres-passwort', pushTimer: false, backupTimer: false });
    try {
      expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
      expect(row('doc-0001').ymode).toBe(0);
    } finally {
      await app.close();
    }
  });

  it('eine Sicherung aus der Zeit vor 3.0.0 wird auf der Kopie umgestellt', () => {
    const old = openDb(join(dir, 'alt.sqlite'));
    putProtocol(old, { id: 'doc-0001', ymode: 0, content: doc(p('Aus der Sicherung')), ownerId: 'u1' });
    old.prepare("INSERT INTO users(id, username, displayName, role, passwordHash, createdAt) VALUES('u1','admin','Admin','admin','x',1)").run();
    const file = join(dir, createBackup(old, dir, 'manuell').name);
    old.close();

    putProtocol(db, { id: 'doc-heute', content: doc(p('heute')) });
    restoreFromFile(db, file);
    expect(count('protocols')).toBe(1);
    expect(row('doc-0001').ymode).toBe(1);
    expect(ydoc('doc-0001')).toBeDefined();
    expect(ydoc('doc-heute')).toBeUndefined(); // der Zustand folgt der Sicherung
  });

  it('eine Sicherung mit Yjs-Zuständen kommt mit ihren Zuständen zurück', () => {
    const src = openDb(join(dir, 'neu.sqlite'));
    putProtocol(src, { id: 'doc-0001', content: doc(p('mit Zustand')), ownerId: 'u1' });
    src.prepare("INSERT INTO users(id, username, displayName, role, passwordHash, createdAt) VALUES('u1','admin','Admin','admin','x',1)").run();
    const before = Buffer.from(ydoc('doc-0001', src)!.state).toString('base64');
    const file = join(dir, createBackup(src, dir, 'manuell').name);
    src.close();

    restoreFromFile(db, file);
    expect(Buffer.from(ydoc('doc-0001')!.state).toString('base64')).toBe(before);
    expect(row('doc-0001').ymode).toBe(1);
  });

  it('das Zurücksetzen der Demo liefert umgestellte Protokolle', async () => {
    const demo = openDb(':memory:');
    await resetDemo(demo);
    const rows = demo.prepare('SELECT id, ymode, content FROM protocols').all() as { id: string; ymode: number; content: string }[];
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.every((r) => r.ymode === 1)).toBe(true);
    const withText = rows.filter((r) => r.content !== '{"type":"doc","content":[]}');
    expect(withText.length).toBeGreaterThan(0);
    expect(count('ydocs', demo)).toBe(withText.length);
    // der Zustand ergibt den Schnappschuss
    for (const r of withText) {
      const d = new Y.Doc();
      Y.applyUpdate(d, ydoc(r.id, demo)!.state);
      expect(canonicalJson(yDocToJson(d)), r.id).toBe(canonicalJson(JSON.parse(r.content)));
    }
  });
});
