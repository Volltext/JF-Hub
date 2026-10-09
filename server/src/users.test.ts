import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DatabaseSync } from 'node:sqlite';
import { buildApp, parseTrustProxy } from './app.js';
import { openDb } from './db.js';
import { hashPassword } from './auth.js';
import { sendDue, type PushPayload } from './push.js';
import type { ClientChange, SyncResponse } from './sync.js';

const PW = 'ein-sicheres-passwort';
let db: DatabaseSync;
let app: FastifyInstance;

beforeEach(async () => {
  db = openDb(':memory:');
  app = await buildApp({ db, adminPassword: PW, pushTimer: false });
});
afterEach(async () => {
  await app.close();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}`, 'x-jfh-schema': '2' });

async function login(username: string, password: string) {
  const r = await app.inject({ method: 'POST', url: '/api/login', payload: { username, password, device: 'Test' } });
  return { status: r.statusCode, token: r.json().token as string };
}

/** Legt einen Betreuer über die Admin-API an und nimmt die Einladung an. Liefert dessen Token. */
async function addBetreuer(adminToken: string, username: string, password = 'passwort-fuer-betreuer'): Promise<string> {
  const created = await app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(adminToken), payload: { username, displayName: username.toUpperCase() } });
  expect(created.statusCode).toBe(200);
  const accepted = await app.inject({ method: 'POST', url: '/api/invite/accept', payload: { username, code: created.json().invite.code, password } });
  expect(accepted.statusCode).toBe(200);
  return accepted.json().token as string;
}

const proto = (id: string, over: Partial<ClientChange> = {}): ClientChange => ({
  id,
  baseRev: 0,
  title: 'Sitzung',
  datum: '2026-10-01',
  beginn: '',
  ende: '',
  ort: '',
  leitung: '',
  content: { type: 'doc', content: [] },
  updatedAt: Date.now(),
  deleted: false,
  ...over,
});

const task = (id: string, shared: boolean, over: Record<string, unknown> = {}) => ({
  collection: 'tasks',
  id,
  data: { id, title: 'Material besorgen', completed: false, ...over },
  updatedAt: Date.now(),
  deleted: false,
  shared,
});

async function sync(token: string, body: { since?: number; changes?: ClientChange[]; records?: unknown[] } = {}): Promise<SyncResponse> {
  const r = await app.inject({ method: 'POST', url: '/api/sync', headers: auth(token), payload: { since: 0, changes: [], ...body } });
  expect(r.statusCode).toBe(200);
  return r.json() as SyncResponse;
}

describe('Benutzerverwaltung', () => {
  it('Admin legt Betreuer per Einladung an; der Code gilt nur einmal', async () => {
    const admin = (await login('admin', PW)).token;
    const created = await app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(admin), payload: { username: 'anna', displayName: 'Anna' } });
    const { code } = created.json().invite as { code: string };
    expect((await login('anna', 'irgendwas-langes')).status).toBe(401); // noch ohne Passwort
    const bad = await app.inject({ method: 'POST', url: '/api/invite/accept', payload: { username: 'anna', code: 'AAAA-BBBB-CCCC-DDDD', password: 'passwort-fuer-anna' } });
    expect(bad.statusCode).toBe(403);
    const short = await app.inject({ method: 'POST', url: '/api/invite/accept', payload: { username: 'anna', code, password: 'kurz' } });
    expect(short.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/invite/accept', payload: { username: 'anna', code, password: 'passwort-fuer-anna' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user).toMatchObject({ username: 'anna', role: 'betreuer' });
    const again = await app.inject({ method: 'POST', url: '/api/invite/accept', payload: { username: 'anna', code, password: 'passwort-fuer-anna' } });
    expect(again.statusCode).toBe(403);
    expect((await login('ANNA', 'passwort-fuer-anna')).status).toBe(200); // Benutzername ohne Groß-/Kleinschreibung
  });

  it('Betreuer dürfen die Administration nicht benutzen', async () => {
    const admin = (await login('admin', PW)).token;
    const anna = await addBetreuer(admin, 'anna');
    for (const [method, url] of [['GET', '/api/admin/users'], ['GET', '/api/admin/settings'], ['GET', '/api/admin/backup']] as const) {
      expect((await app.inject({ method, url, headers: auth(anna) })).statusCode).toBe(403);
    }
    expect((await app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(anna), payload: { username: 'x-user' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: auth(anna) })).json().user.role).toBe('betreuer');
  });

  it('prüft Benutzernamen und verhindert doppelte Namen', async () => {
    const admin = (await login('admin', PW)).token;
    const post = (username: string) => app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(admin), payload: { username } });
    expect((await post('a')).statusCode).toBe(400);
    expect((await post('mit leerzeichen')).statusCode).toBe(400);
    expect((await post('anna')).statusCode).toBe(200);
    expect((await post('Anna')).statusCode).toBe(409);
  });

  it('der letzte Admin kann weder entfernt noch herabgestuft noch gesperrt werden', async () => {
    const admin = (await login('admin', PW)).token;
    const id = (await app.inject({ method: 'GET', url: '/api/me', headers: auth(admin) })).json().user.id as string;
    expect((await app.inject({ method: 'PATCH', url: `/api/admin/users/${id}`, headers: auth(admin), payload: { role: 'betreuer' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PATCH', url: `/api/admin/users/${id}`, headers: auth(admin), payload: { disabled: true } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/users/${id}`, headers: auth(admin) })).statusCode).toBe(400);
  });

  it('gesperrte Benutzer sind sofort abgemeldet und können sich nicht anmelden', async () => {
    const admin = (await login('admin', PW)).token;
    const anna = await addBetreuer(admin, 'anna');
    const id = (await app.inject({ method: 'GET', url: '/api/me', headers: auth(anna) })).json().user.id as string;
    await app.inject({ method: 'PATCH', url: `/api/admin/users/${id}`, headers: auth(admin), payload: { disabled: true } });
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: auth(anna) })).statusCode).toBe(401);
    expect((await login('anna', 'passwort-fuer-betreuer')).status).toBe(401);
    await app.inject({ method: 'PATCH', url: `/api/admin/users/${id}`, headers: auth(admin), payload: { disabled: false } });
    expect((await login('anna', 'passwort-fuer-betreuer')).status).toBe(200);
  });

  it('neue Einladung setzt das Passwort neu und meldet alte Geräte ab', async () => {
    const admin = (await login('admin', PW)).token;
    const anna = await addBetreuer(admin, 'anna');
    const id = (await app.inject({ method: 'GET', url: '/api/me', headers: auth(anna) })).json().user.id as string;
    const code = (await app.inject({ method: 'POST', url: `/api/admin/users/${id}/invite`, headers: auth(admin) })).json().code as string;
    expect((await login('anna', 'passwort-fuer-betreuer')).status).toBe(200); // altes Passwort gilt bis zur Annahme
    await app.inject({ method: 'POST', url: '/api/invite/accept', payload: { username: 'anna', code, password: 'ganz-neues-passwort' } });
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: auth(anna) })).statusCode).toBe(401);
    expect((await login('anna', 'passwort-fuer-betreuer')).status).toBe(401);
    expect((await login('anna', 'ganz-neues-passwort')).status).toBe(200);
  });

  it('Löschen eines Benutzers: Private Daten verschwinden, veröffentlichte gehen an den Admin', async () => {
    const admin = (await login('admin', PW)).token;
    const anna = await addBetreuer(admin, 'anna');
    const id = (await app.inject({ method: 'GET', url: '/api/me', headers: auth(anna) })).json().user.id as string;
    await sync(anna, { changes: [proto('doc-privat', { shared: false }), proto('doc-offen', { shared: true })], records: [task('task-privat', false), task('task-offen', true)] });
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/users/${id}`, headers: auth(admin) })).statusCode).toBe(200);
    const view = await sync(admin);
    expect(view.changes.map((c) => c.id)).toEqual(['doc-offen']);
    expect(view.records.map((r) => r.id)).toEqual(['task-offen']);
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: auth(anna) })).statusCode).toBe(401);
  });

  it('Passwortänderung im Konto erfordert das aktuelle Passwort', async () => {
    const admin = (await login('admin', PW)).token;
    const anna = await addBetreuer(admin, 'anna');
    const bad = await app.inject({ method: 'POST', url: '/api/account/password', headers: auth(anna), payload: { current: 'falsch', next: 'neues-passwort-123' } });
    expect(bad.statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: '/api/account/password', headers: auth(anna), payload: { current: 'passwort-fuer-betreuer', next: 'neues-passwort-123' } });
    expect(ok.statusCode).toBe(200);
    expect((await login('anna', 'neues-passwort-123')).status).toBe(200);
  });

  it('Konto-Geräte: jeder sieht und beendet nur die eigenen Sitzungen', async () => {
    const admin = (await login('admin', PW)).token;
    const anna = await addBetreuer(admin, 'anna');
    const annaList = (await app.inject({ method: 'GET', url: '/api/account/sessions', headers: auth(anna) })).json() as { id: string; current: boolean }[];
    expect(annaList).toHaveLength(1);
    const adminList = (await app.inject({ method: 'GET', url: '/api/account/sessions', headers: auth(admin) })).json() as { id: string }[];
    await app.inject({ method: 'DELETE', url: `/api/account/sessions/${annaList[0]!.id}`, headers: auth(admin) }); // fremde ID: wirkungslos
    expect((await app.inject({ method: 'GET', url: '/api/me', headers: auth(anna) })).statusCode).toBe(200);
    expect(adminList.length).toBeGreaterThan(0);
  });

  it('Altinstallation: das einzelne Passwort wird zum Admin-Konto, Aufgaben bleiben privat', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jfh-legacy-'));
    const file = join(dir, 'alt.sqlite');
    try {
      // Datenbank im Stand vor 2.0: ein Passwort, keine Benutzer, keine Besitzer-Spalten.
      const old = new DatabaseSync(file);
      old.exec(`
        CREATE TABLE protocols (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', datum TEXT NOT NULL DEFAULT '', beginn TEXT NOT NULL DEFAULT '', ende TEXT NOT NULL DEFAULT '',
          ort TEXT NOT NULL DEFAULT '', leitung TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '{}', rev INTEGER NOT NULL, updatedAt INTEGER NOT NULL, deletedAt INTEGER);
        CREATE TABLE records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', rev INTEGER NOT NULL, updatedAt INTEGER NOT NULL, deletedAt INTEGER, PRIMARY KEY (collection, id));
        CREATE TABLE sessions (hash TEXT PRIMARY KEY, device TEXT NOT NULL, createdAt INTEGER NOT NULL, lastUsedAt INTEGER NOT NULL, expiresAt INTEGER NOT NULL);
        CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      `);
      old.prepare('INSERT INTO config VALUES(?, ?)').run('passwordHash', await hashPassword('altes-passwort-123'));
      old.prepare("INSERT INTO protocols(id, title, rev, updatedAt) VALUES('doc-alt', 'Altes Protokoll', 1, 1)").run();
      old.prepare("INSERT INTO records(collection, id, data, rev, updatedAt) VALUES('tasks', 'task-alt', '{}', 2, 1), ('members', 'mem-alt', '{}', 3, 1)").run();
      old.prepare("INSERT INTO sessions VALUES('h1', 'Altes Handy', 1, 1, ?)").run(Date.now() + 1e9);
      old.close();

      const mem = openDb(file);
      const migrated = await buildApp({ db: mem, pushTimer: false });
      expect(migrated.setupCode).toBeUndefined();
      const r = await migrated.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: 'altes-passwort-123' } });
      expect(r.statusCode).toBe(200);
      expect(r.json().user.role).toBe('admin');
      const admin = (mem.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string }).id;
      expect(mem.prepare("SELECT ownerId, shared FROM records WHERE id = 'task-alt'").get()).toEqual({ ownerId: admin, shared: 0 });
      expect((mem.prepare("SELECT shared FROM records WHERE id = 'mem-alt'").get() as { shared: number }).shared).toBe(1);
      expect(mem.prepare("SELECT ownerId, shared FROM protocols WHERE id = 'doc-alt'").get()).toEqual({ ownerId: admin, shared: 1 });
      expect((mem.prepare("SELECT userId FROM sessions WHERE hash = 'h1'").get() as { userId: string }).userId).toBe(admin);
      expect(mem.prepare("SELECT 1 FROM config WHERE key = 'passwordHash'").get()).toBeUndefined();
      await migrated.close();
      mem.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('Sichtbarkeit von Protokollen und Aufgaben', () => {
  it('private Einträge sieht nur der Besitzer, veröffentlichte alle', async () => {
    const admin = (await login('admin', PW)).token;
    const anna = await addBetreuer(admin, 'anna');
    const ben = await addBetreuer(admin, 'ben');
    await sync(anna, { changes: [proto('doc-privat', { shared: false }), proto('doc-offen', { shared: true })], records: [task('task-privat', false), task('task-offen', true)] });

    const annaView = await sync(anna);
    expect(annaView.changes.map((c) => c.id).sort()).toEqual(['doc-offen', 'doc-privat']);
    const benView = await sync(ben);
    expect(benView.changes.map((c) => c.id)).toEqual(['doc-offen']);
    expect(benView.records.map((r) => r.id)).toEqual(['task-offen']);
    expect(benView.counts).toMatchObject({ protocols: 1, records: 1 });
    // Besitzer und Sichtbarkeit stehen im Datensatz
    expect(benView.records[0]!.data).toMatchObject({ shared: true });
    expect((benView.records[0]!.data as { ownerId: string }).ownerId).toBeTruthy();
    expect(benView.users.map((u) => u.name).sort()).toEqual(['ANNA', 'Admin', 'BEN']);
  });

  it('fremde private Einträge sind nicht les-, änderbar oder abrufbar', async () => {
    const admin = (await login('admin', PW)).token;
    const anna = await addBetreuer(admin, 'anna');
    const ben = await addBetreuer(admin, 'ben');
    await sync(anna, { changes: [proto('doc-privat', { shared: false, title: 'Geheim' })], records: [task('task-privat', false, { title: 'Geheim' })] });
    const r = await sync(ben, { changes: [proto('doc-privat', { title: 'Überschrieben', shared: true })], records: [{ ...task('task-privat', true, { title: 'Überschrieben' }), updatedAt: Date.now() + 10_000 }] });
    expect(r.changes).toHaveLength(0);
    expect(r.records).toHaveLength(0);
    const annaView = await sync(anna);
    expect(annaView.changes.find((c) => c.id === 'doc-privat')).toMatchObject({ title: 'Geheim', shared: false });
    expect(annaView.records.find((x) => x.id === 'task-privat')!.data).toMatchObject({ title: 'Geheim' });
    expect((await app.inject({ method: 'GET', url: '/api/protocols/doc-privat/pdf', headers: auth(ben) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/protocols/doc-privat/pdf', headers: auth(anna) })).statusCode).toBe(200);
  });

  it('Veröffentlichen und Zurücknehmen: andere Geräte erhalten Eintrag bzw. Löschhinweis', async () => {
    const admin = (await login('admin', PW)).token;
    const anna = await addBetreuer(admin, 'anna');
    const ben = await addBetreuer(admin, 'ben');
    const first = await sync(anna, { changes: [proto('doc-0001', { shared: false })], records: [task('task-0001', false)] });
    const benEmpty = await sync(ben);
    expect(benEmpty.changes).toHaveLength(0);

    // veröffentlichen
    const rev1 = first.changes[0]!.rev;
    await sync(anna, { since: first.rev, changes: [proto('doc-0001', { baseRev: rev1, shared: true })], records: [{ ...task('task-0001', true), updatedAt: Date.now() + 1 }] });
    const benShared = await sync(ben, { since: benEmpty.rev });
    expect(benShared.changes.map((c) => c.id)).toEqual(['doc-0001']);
    expect(benShared.records.map((r) => r.id)).toEqual(['task-0001']);

    // wieder privat: Ben bekommt Tombstones, damit seine lokale Kopie verschwindet
    const rev2 = benShared.changes[0]!.rev;
    await sync(anna, { since: first.rev, changes: [proto('doc-0001', { baseRev: rev2, shared: false })], records: [{ ...task('task-0001', false), updatedAt: Date.now() + 2 }] });
    const benHidden = await sync(ben, { since: benShared.rev });
    expect(benHidden.changes).toMatchObject([{ id: 'doc-0001', deleted: true }]);
    expect(benHidden.records).toMatchObject([{ id: 'task-0001', deleted: true }]);
    const benAgain = await sync(ben, { since: benHidden.rev });
    expect(benAgain.changes).toHaveLength(0);
  });

  it('Nie veröffentlichte Einträge erzeugen keinen Löschhinweis (kein Hinweis auf die Existenz)', async () => {
    const admin = (await login('admin', PW)).token;
    const anna = await addBetreuer(admin, 'anna');
    const ben = await addBetreuer(admin, 'ben');
    await sync(anna, { changes: [proto('doc-privat', { shared: false })] });
    const r = await sync(ben, { since: 0 });
    expect(r.changes).toHaveLength(0);
  });

  it('veröffentlichte Einträge dürfen alle bearbeiten, aber nur Besitzer/Admin löschen und freigeben', async () => {
    const admin = (await login('admin', PW)).token;
    const anna = await addBetreuer(admin, 'anna');
    const ben = await addBetreuer(admin, 'ben');
    const first = await sync(anna, { changes: [proto('doc-0001', { shared: true })], records: [task('task-0001', true)] });
    const base = first.changes[0]!.rev;

    // Ben bearbeitet und versucht, es privat zu stellen: Bearbeitung zählt, Sichtbarkeit bleibt
    const edit = await sync(ben, { since: 0, changes: [proto('doc-0001', { baseRev: base, title: 'Von Ben', shared: false })], records: [{ ...task('task-0001', false, { completed: true }), updatedAt: Date.now() + 5 }] });
    expect(edit.changes[0]).toMatchObject({ title: 'Von Ben', shared: true });
    expect(edit.records[0]!.data).toMatchObject({ completed: true, shared: true });

    // Ben kann nicht löschen
    const cur = edit.changes[0]!.rev;
    const del = await sync(ben, { since: edit.rev, changes: [proto('doc-0001', { baseRev: cur, deleted: true })], records: [{ ...task('task-0001', true), deleted: true, updatedAt: Date.now() + 9 }] });
    expect(del.changes).toHaveLength(0);
    expect(del.records).toHaveLength(0);
    const still = await sync(anna);
    expect(still.changes[0]!.deleted).toBe(false);

    // Admin darf löschen (Moderation)
    const adminDel = await sync(admin, { since: 0, changes: [proto('doc-0001', { baseRev: cur, deleted: true })] });
    expect(adminDel.changes[0]!.deleted).toBe(true);
  });

  it('Konfliktkopie gehört dem Bearbeitenden und erbt die Sichtbarkeit', async () => {
    const admin = (await login('admin', PW)).token;
    const anna = await addBetreuer(admin, 'anna');
    const ben = await addBetreuer(admin, 'ben');
    const first = await sync(anna, { changes: [proto('doc-0001', { shared: true })] });
    const base = first.changes[0]!.rev;
    await sync(anna, { since: first.rev, changes: [proto('doc-0001', { baseRev: base, title: 'A' })] });
    const r = await sync(ben, { since: 0, changes: [proto('doc-0001', { baseRev: base, title: 'B' })] });
    expect(r.conflicts).toHaveLength(1);
    const copy = r.changes.find((c) => c.id === r.conflicts[0]!.copyId)!;
    expect(copy).toMatchObject({ title: 'B (Konflikt)', shared: true });
    expect(copy.ownerId).not.toBe(first.changes[0]!.ownerId);
  });

  it('Mitglieder, Dienste und Kleidung gehören immer der ganzen Gruppe', async () => {
    const admin = (await login('admin', PW)).token;
    const anna = await addBetreuer(admin, 'anna');
    const ben = await addBetreuer(admin, 'ben');
    await sync(anna, { records: [{ collection: 'members', id: 'mem-0001', data: { id: 'mem-0001', name: 'Max' }, updatedAt: 1, deleted: false, shared: false }] });
    expect((await sync(ben)).records.map((r) => r.id)).toEqual(['mem-0001']);
  });

  it('Export enthält nur sichtbare Protokolle', async () => {
    const admin = (await login('admin', PW)).token;
    const anna = await addBetreuer(admin, 'anna');
    await sync(anna, { changes: [proto('doc-privat', { shared: false, title: 'Privatnotiz' }), proto('doc-offen', { shared: true, title: 'Offen' })] });
    const zip = async (t: string) => (await app.inject({ method: 'GET', url: '/api/export.zip', headers: auth(t) })).rawPayload.toString('latin1');
    expect(await zip(admin)).toContain('Offen');
    expect(await zip(admin)).not.toContain('Privatnotiz');
    expect(await zip(anna)).toContain('Privatnotiz');
    // Admin-Liste: ebenfalls nur Sichtbares
    const list = (await app.inject({ method: 'GET', url: '/api/admin/protocols', headers: auth(admin) })).json() as { id: string; owner: string }[];
    expect(list.map((p) => p.id)).toEqual(['doc-offen']);
    expect(list[0]!.owner).toBe('ANNA');
  });
});

describe('Web-Push', () => {
  const sub = (host = 'fcm.googleapis.com') => ({ endpoint: `https://${host}/fcm/send/abc123`, keys: { p256dh: 'BPublicKeyDummy', auth: 'authDummy' } });
  const future = (min: number) => Date.now() + min * 60_000;

  it('liefert den öffentlichen Schlüssel nur Angemeldeten und behält ihn', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/push/key' })).statusCode).toBe(401);
    const t = (await login('admin', PW)).token;
    const k1 = (await app.inject({ method: 'GET', url: '/api/push/key', headers: auth(t) })).json().publicKey as string;
    const k2 = (await app.inject({ method: 'GET', url: '/api/push/key', headers: auth(t) })).json().publicKey as string;
    expect(k1).toBe(k2);
    expect(k1.length).toBeGreaterThan(40);
  });

  it('lehnt unsichere Push-Adressen ab (keine internen Ziele)', async () => {
    const t = (await login('admin', PW)).token;
    for (const endpoint of ['http://fcm.googleapis.com/x', 'https://127.0.0.1/x', 'https://localhost/x', 'https://intern/x', 'https://[::1]/x', 'https://nas.local/x']) {
      const r = await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: auth(t), payload: { subscription: { ...sub(), endpoint }, device: 'x' } });
      expect(r.statusCode, endpoint).toBe(400);
    }
  });

  it('verschickt fällige Erinnerungen genau einmal und entfernt tote Abonnements', async () => {
    const t = (await login('admin', PW)).token;
    const s = sub();
    expect((await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: auth(t), payload: { subscription: s, device: 'Handy' } })).statusCode).toBe(200);
    const put = (kind: string, reminders: unknown[]) =>
      app.inject({ method: 'PUT', url: '/api/push/reminders', headers: auth(t), payload: { endpoint: s.endpoint, kind, reminders } });
    const now = Date.now();
    expect((await put('service', [{ key: 'a', at: now + 1000, title: 'Dienst gleich', body: 'Montag', url: '/dienste' }, { key: 'b', at: future(60), title: 'später', body: '' }])).json().count).toBe(2);
    expect((await put('boese', [])).statusCode).toBe(400);

    const sent: PushPayload[] = [];
    const sender = async (_s: unknown, p: PushPayload) => void sent.push(p);
    expect(await sendDue(db, sender, now)).toEqual({ sent: 0, failed: 0 }); // noch nicht fällig
    expect(await sendDue(db, sender, now + 2000)).toEqual({ sent: 1, failed: 0 });
    expect(sent[0]).toMatchObject({ title: 'Dienst gleich', url: '/dienste', tag: 'service:a' });
    expect(await sendDue(db, sender, now + 3000)).toEqual({ sent: 0, failed: 0 }); // nicht doppelt

    // Der Push-Dienst kennt das Abo nicht mehr (410): Abo und Erinnerungen verschwinden
    const gone = async () => Promise.reject(Object.assign(new Error('gone'), { statusCode: 410 }));
    await sendDue(db, gone, future(61));
    expect((db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get() as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) AS n FROM push_reminders').get() as { n: number }).n).toBe(0);
  });

  it('Erinnerungen ersetzen sich je Art und gehören nur dem eigenen Gerät', async () => {
    const admin = (await login('admin', PW)).token;
    const anna = await addBetreuer(admin, 'anna');
    const s = sub();
    await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: auth(admin), payload: { subscription: s, device: 'Handy' } });
    const put = (token: string, kind: string, reminders: unknown[]) => app.inject({ method: 'PUT', url: '/api/push/reminders', headers: auth(token), payload: { endpoint: s.endpoint, kind, reminders } });
    await put(admin, 'task', [{ key: '1', at: future(5), title: 'T', body: '' }]);
    await put(admin, 'service', [{ key: '1', at: future(5), title: 'S', body: '' }]);
    await put(admin, 'task', []); // ersetzt nur 'task'
    const left = db.prepare('SELECT kind FROM push_reminders').all() as { kind: string }[];
    expect(left.map((l) => l.kind)).toEqual(['service']);
    expect((await put(anna, 'task', [])).statusCode).toBe(404); // fremdes Gerät
  });

  it('Testnachricht geht nur an das eigene, angemeldete Gerät', async () => {
    const sent: PushPayload[] = [];
    const local = await buildApp({ db: openDb(':memory:'), adminPassword: PW, pushTimer: false, pushSender: async (_s, p) => void sent.push(p) });
    try {
      const t = (await local.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW } })).json().token as string;
      const s = sub();
      const post = (url: string, payload: object) => local.inject({ method: 'POST', url, headers: auth(t), payload });
      expect((await post('/api/push/test', { endpoint: s.endpoint })).statusCode).toBe(404);
      await post('/api/push/subscribe', { subscription: s, device: 'Handy' });
      expect((await post('/api/push/test', { endpoint: s.endpoint })).statusCode).toBe(200);
      expect(sent).toHaveLength(1);
    } finally {
      await local.close();
    }
  });

  it('Abmelden entfernt das Push-Abonnement des Geräts', async () => {
    const t = (await login('admin', PW)).token;
    await app.inject({ method: 'POST', url: '/api/push/subscribe', headers: auth(t), payload: { subscription: sub(), device: 'Handy' } });
    await app.inject({ method: 'POST', url: '/api/logout', headers: auth(t) });
    expect((db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').get() as { n: number }).n).toBe(0);
  });
});

describe('Ferien-Weitergabe', () => {
  it('holt Ferien einmal und liefert sie aus dem Zwischenspeicher; lehnt fremde Bundesländer ab', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return { ok: true, status: 200, json: async () => [{ startDate: '2026-10-12', endDate: '2026-10-24', name: [{ language: 'DE', text: 'Herbstferien' }] }] };
    };
    const local = await buildApp({ db: openDb(':memory:'), adminPassword: PW, pushTimer: false, fetchImpl });
    try {
      const t = (await local.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW } })).json().token as string;
      const get = (state: string) => local.inject({ method: 'GET', url: `/api/holidays?state=${state}`, headers: auth(t) });
      expect((await get('NI')).json()[0].startDate).toBe('2026-10-12');
      await get('NI');
      expect(calls).toBe(1);
      expect((await get('XX')).statusCode).toBe(502);
      expect((await local.inject({ method: 'GET', url: '/api/holidays?state=NI' })).statusCode).toBe(401);
    } finally {
      await local.close();
    }
  });
});

describe('Proxy-Einstellung', () => {
  it('liest TRUST_PROXY', () => {
    expect(parseTrustProxy(undefined)).toEqual(['loopback', 'linklocal', 'uniquelocal']);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('10.0.0.0/8, 172.16.0.0/12')).toEqual(['10.0.0.0/8', '172.16.0.0/12']);
  });

  it('übernimmt X-Forwarded-For nur von vertrauten Proxys (Login-Begrenzung je Client-IP)', async () => {
    const strict = await buildApp({ db: openDb(':memory:'), adminPassword: PW, pushTimer: false, trustProxy: false });
    try {
      // Ohne Vertrauen zählt immer die direkte Adresse: ein gefälschter Header umgeht die Begrenzung nicht.
      let last = 0;
      for (let i = 0; i < 10; i++) {
        last = (await strict.inject({ method: 'POST', url: '/api/login', headers: { 'x-forwarded-for': `203.0.113.${i}` }, payload: { username: `nutzer-${i}`, password: 'x' } })).statusCode;
      }
      expect(last).toBe(429);
    } finally {
      await strict.close();
    }
  });
});
