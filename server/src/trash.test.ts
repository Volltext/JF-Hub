import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { buildApp } from './app.js';
import { openDb, setConfig } from './db.js';
import { applySync, sweepTrash, type ClientChange, type SyncResponse } from './sync.js';

const PW = 'ein-sicheres-passwort';
const DAY = 86_400_000;
let db: DatabaseSync;
let app: FastifyInstance;

beforeEach(async () => {
  db = openDb(':memory:');
  app = await buildApp({ db, adminPassword: PW, pushTimer: false });
});
afterEach(async () => {
  await app.close();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function adminToken(): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW, device: 'Test' } });
  return r.json().token as string;
}

async function betreuer(admin: string, username: string): Promise<{ token: string; id: string }> {
  const created = await app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(admin), payload: { username, displayName: username.toUpperCase() } });
  const accepted = await app.inject({ method: 'POST', url: '/api/invite/accept', payload: { username, code: created.json().invite.code, password: 'passwort-fuer-betreuer' } });
  return { token: accepted.json().token as string, id: accepted.json().user.id as string };
}

const change = (id: string, over: Partial<ClientChange> = {}): ClientChange => ({
  id,
  baseRev: 0,
  title: 'Sitzung',
  datum: '2026-10-01',
  beginn: '',
  ende: '',
  ort: '',
  leitung: '',
  content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Inhalt' }] }] },
  updatedAt: Date.now(),
  deleted: false,
  ...over,
});

async function sync(token: string, changes: ClientChange[], since = 0): Promise<SyncResponse> {
  const r = await app.inject({ method: 'POST', url: '/api/sync', headers: auth(token), payload: { since, changes } });
  expect(r.statusCode).toBe(200);
  return r.json() as SyncResponse;
}

/** Legt ein Protokoll an und löscht es wieder. Liefert dessen Revision nach dem Löschen. */
async function trashed(token: string, id: string, over: Partial<ClientChange> = {}): Promise<number> {
  const first = await sync(token, [change(id, over)]);
  const rev = first.changes.find((c) => c.id === id)!.rev;
  const second = await sync(token, [change(id, { ...over, baseRev: rev, deleted: true })], first.rev);
  return second.changes.find((c) => c.id === id)!.rev;
}

describe('Papierkorb in der App', () => {
  it('zeigt Betreuern die eigenen gelöschten Protokolle, nicht die anderer', async () => {
    const admin = await adminToken();
    const anna = await betreuer(admin, 'anna');
    const ben = await betreuer(admin, 'ben');
    await trashed(anna.token, 'anna-0001', { title: 'Annas Protokoll' });
    await trashed(ben.token, 'ben-00001', { title: 'Bens Protokoll', shared: true });
    const list = async (t: string) => (await app.inject({ method: 'GET', url: '/api/protocols/trash', headers: auth(t) })).json() as { items: { id: string; title: string }[]; trashDays: number };
    expect((await list(anna.token)).items.map((i) => i.title)).toEqual(['Annas Protokoll']);
    expect((await list(ben.token)).items.map((i) => i.title)).toEqual(['Bens Protokoll']);
    expect((await list(anna.token)).trashDays).toBe(30);
  });

  it('der Admin sieht zusätzlich veröffentlichte, aber keine privaten Protokolle anderer', async () => {
    const admin = await adminToken();
    const anna = await betreuer(admin, 'anna');
    await trashed(anna.token, 'privat-001', { title: 'Privat' });
    await trashed(anna.token, 'geteilt-01', { title: 'Geteilt', shared: true });
    const items = (await app.inject({ method: 'GET', url: '/api/protocols/trash', headers: auth(admin) })).json().items as { title: string }[];
    expect(items.map((i) => i.title)).toEqual(['Geteilt']);
  });

  it('der Besitzer holt ein Protokoll zurück; es erscheint beim nächsten Abgleich wieder', async () => {
    const admin = await adminToken();
    const anna = await betreuer(admin, 'anna');
    const rev = await trashed(anna.token, 'anna-0001');
    const r = await app.inject({ method: 'POST', url: '/api/protocols/anna-0001/restore', headers: auth(anna.token) });
    expect(r.statusCode).toBe(200);
    const next = await sync(anna.token, [], rev);
    expect(next.changes.find((c) => c.id === 'anna-0001')).toMatchObject({ deleted: false, title: 'Sitzung' });
    expect((await app.inject({ method: 'GET', url: '/api/protocols/trash', headers: auth(anna.token) })).json().items).toEqual([]);
  });

  it('andere Betreuer können fremde Protokolle nicht zurückholen; ein zweites Zurückholen findet nichts', async () => {
    const admin = await adminToken();
    const anna = await betreuer(admin, 'anna');
    const ben = await betreuer(admin, 'ben');
    await trashed(anna.token, 'anna-0001', { shared: true });
    expect((await app.inject({ method: 'POST', url: '/api/protocols/anna-0001/restore', headers: auth(ben.token) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/protocols/anna-0001/restore', headers: auth(admin) })).statusCode).toBe(200); // der Admin darf Veröffentlichtes
    expect((await app.inject({ method: 'POST', url: '/api/protocols/anna-0001/restore', headers: auth(admin) })).statusCode).toBe(404);
  });
});

describe('Papierkorb leeren hinterlässt einen Grabstein', () => {
  it('endgültiges Löschen entfernt Titel und Inhalt, das Gerät erfährt es aber trotzdem', async () => {
    const admin = await adminToken();
    const rev = await trashed(admin, 'doc-0001', { title: 'Geheim' });
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/protocols/doc-0001', headers: auth(admin) })).statusCode).toBe(200);
    const row = db.prepare('SELECT title, content, purgedAt FROM protocols WHERE id = ?').get('doc-0001') as { title: string; content: string; purgedAt: number | null };
    expect(row.title).toBe('');
    expect(row.content).not.toContain('Inhalt');
    expect(row.purgedAt).not.toBeNull();
    // Ein Gerät, das den Papierkorb-Eintrag nie gesehen hat, bekommt die Löschung.
    const late = await sync(admin, [], rev - 1);
    expect(late.changes.find((c) => c.id === 'doc-0001')).toMatchObject({ deleted: true });
    // Geleerte Einträge sind weder zurückholbar noch in der Liste.
    expect((await app.inject({ method: 'POST', url: '/api/protocols/doc-0001/restore', headers: auth(admin) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/admin/protocols/doc-0001/restore', headers: auth(admin) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/admin/protocols', headers: auth(admin) })).json()).toEqual([]);
    expect((await app.inject({ method: 'GET', url: '/api/admin/info', headers: auth(admin) })).json().trashed).toBe(0);
  });

  it('eine späte Bearbeitung eines geleerten Eintrags erweckt ihn mit ihrem Inhalt wieder auf', async () => {
    const admin = await adminToken();
    const rev = await trashed(admin, 'doc-0001');
    await app.inject({ method: 'DELETE', url: '/api/admin/protocols/doc-0001', headers: auth(admin) });
    const back = await sync(admin, [change('doc-0001', { baseRev: rev, title: 'Mein Stand' })], 0);
    expect(back.changes.find((c) => c.id === 'doc-0001')).toMatchObject({ deleted: false, title: 'Mein Stand' });
    expect((db.prepare('SELECT purgedAt FROM protocols WHERE id = ?').get('doc-0001') as { purgedAt: number | null }).purgedAt).toBeNull();
  });
});

describe('sweepTrash', () => {
  it('leert nach trashDays, entfernt Grabsteine nach max(tokenDays, 90) Tagen', () => {
    const user = { id: 'u1', role: 'betreuer' as const };
    const put = (id: string, base = 0, deleted = false) =>
      applySync(db, { since: 0, changes: [{ ...change(id, { baseRev: base, deleted }), baseRev: base }] }, user);
    const r = put('alt-00001');
    put('alt-00001', r.changes[0]!.rev, true);
    const t0 = Date.now();

    expect(sweepTrash(db, t0 + 29 * DAY)).toEqual({ purged: 0, removed: 0 }); // noch im Papierkorb
    expect(sweepTrash(db, t0 + 31 * DAY)).toEqual({ purged: 1, removed: 0 }); // geleert, Grabstein bleibt
    expect(db.prepare('SELECT COUNT(*) AS n FROM protocols').get()).toEqual({ n: 1 });
    expect(sweepTrash(db, t0 + 31 * DAY + 80 * DAY)).toEqual({ purged: 0, removed: 0 }); // Grabstein hält mindestens 90 Tage
    expect(sweepTrash(db, t0 + 31 * DAY + 91 * DAY)).toEqual({ purged: 0, removed: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM protocols').get()).toEqual({ n: 0 });
  });

  it('richtet sich nach den Einstellungen', () => {
    const user = { id: 'u1', role: 'betreuer' as const };
    const r = applySync(db, { since: 0, changes: [change('kurz-00001')] }, user);
    applySync(db, { since: 0, changes: [change('kurz-00001', { baseRev: r.changes[0]!.rev, deleted: true })] }, user);
    setConfig(db, 'trashDays', '3');
    expect(sweepTrash(db, Date.now() + 2 * DAY).purged).toBe(0);
    expect(sweepTrash(db, Date.now() + 4 * DAY).purged).toBe(1);
  });
});
