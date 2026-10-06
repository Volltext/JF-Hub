import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { buildApp } from './app.js';
import { currentRev, getConfig, openDb } from './db.js';
import { DEMO_PASSWORD, msUntilReset, parseResetAt, resetDemo } from './demo.js';
import type { SyncResponse } from './sync.js';

let db: DatabaseSync;
let app: FastifyInstance & { setupCode?: string };

beforeEach(async () => {
  db = openDb(':memory:');
  app = await buildApp({ db, pushTimer: false, demo: { timer: false } });
});
afterEach(async () => {
  await app.close();
});

async function login(username: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/login', payload: { username, password: DEMO_PASSWORD, device: 'Test' } });
  expect(r.statusCode).toBe(200);
  return r.json().token as string;
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function sync(token: string, body: Record<string, unknown> = {}): Promise<SyncResponse> {
  const r = await app.inject({ method: 'POST', url: '/api/sync', headers: auth(token), payload: { since: 0, changes: [], ...body } });
  expect(r.statusCode).toBe(200);
  return r.json() as SyncResponse;
}

describe('Zeitplan', () => {
  it('liest HH:MM und lehnt Unsinn ab', () => {
    expect(parseResetAt(undefined)).toEqual({ hour: 3, minute: 0 });
    expect(parseResetAt(' 4:30 ')).toEqual({ hour: 4, minute: 30 });
    expect(() => parseResetAt('25:00')).toThrow(/DEMO_RESET_AT/);
    expect(() => parseResetAt('nachts')).toThrow(/DEMO_RESET_AT/);
  });

  it('rechnet bis zur nächsten Uhrzeit, heute oder morgen', () => {
    const at = { hour: 3, minute: 0 };
    expect(msUntilReset(new Date(2026, 9, 6, 2, 0), at)).toBe(3_600_000);
    expect(msUntilReset(new Date(2026, 9, 6, 3, 0), at)).toBe(24 * 3_600_000);
    expect(msUntilReset(new Date(2026, 9, 6, 22, 30), at)).toBe(4.5 * 3_600_000);
  });
});

describe('Demo-Modus', () => {
  it('startet mit Beispieldaten und nennt die Zugänge', async () => {
    expect(app.setupCode).toBeUndefined();
    const st = (await app.inject({ method: 'GET', url: '/api/status' })).json();
    expect(st.setupRequired).toBe(false);
    expect(st.orgName).toBe('Jugendfeuerwehr Musterstadt');
    expect(st.demo.resetAt).toBe('03:00');
    expect(st.demo.accounts.map((a: { username: string }) => a.username)).toEqual(['jugendwart', 'betreuer']);

    const res = await sync(await login('jugendwart'));
    const by = (c: string) => res.records.filter((r) => r.collection === c && !r.deleted);
    expect(by('members').length).toBeGreaterThan(10);
    expect(by('sessions').length).toBe(10);
    expect(by('clothingItems').map((r) => r.id)).toEqual(expect.arrayContaining(['kombi-jacke', 'kombi-hose', 'regenjacke', 'handschuhe']));
    expect(by('clothing').length).toBeGreaterThan(5);
    expect(by('runs').length).toBeGreaterThan(5);
    expect(by('lineupTemplates').length).toBe(2);
    expect(res.folders.length).toBe(3);
    expect(res.users.map((u) => u.name)).toEqual(expect.arrayContaining(['Jana Becker', 'Tobias Wagner']));

    // Jeder Dienst liegt in der Vergangenheit, Anwesende und Fehlende zusammen sind alle aktiven Mitglieder.
    const today = new Date().toISOString().slice(0, 10);
    const activeMembers = by('members').filter((m) => (m.data as { active: boolean }).active).length;
    for (const s of by('sessions')) {
      const d = s.data as { date: string; present: string[]; absent: string[] };
      expect(d.date < today || d.date === today).toBe(true);
      expect(d.present.length + d.absent.length).toBe(activeMembers);
    }
  });

  it('zeigt private Einträge nur ihrem Besitzer', async () => {
    const jana = await sync(await login('jugendwart'));
    const tobias = await sync(await login('betreuer'));
    const titles = (r: SyncResponse) => r.changes.map((d) => d.title);
    expect(titles(jana)).toContain('Notizen Jahresplanung (privat)');
    expect(titles(jana)).not.toContain('Ideen Spieleabend (privat)');
    expect(titles(tobias)).toContain('Ideen Spieleabend (privat)');
    expect(titles(tobias)).toContain('Dienst: Knoten und Stiche');
    const tasks = (r: SyncResponse) => r.records.filter((x) => x.collection === 'tasks').map((x) => (x.data as { title: string }).title);
    expect(tasks(jana)).toContain('Dienstplan fürs nächste Halbjahr entwerfen');
    expect(tasks(tobias)).not.toContain('Dienstplan fürs nächste Halbjahr entwerfen');
  });

  it('erzeugt aus den Beispielprotokollen PDFs', async () => {
    const token = await login('betreuer');
    for (const id of ['demo-p-dienst-knoten', 'demo-p-team', 'demo-p-eltern']) {
      const r = await app.inject({ method: 'GET', url: `/api/protocols/${id}/pdf`, headers: auth(token) });
      expect(r.statusCode).toBe(200);
      expect(r.headers['content-type']).toBe('application/pdf');
    }
  });

  it('sperrt, was alle Besucher aussperren würde', async () => {
    const admin = await login('jugendwart');
    const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, headers: auth(admin), payload: payload as never });

    expect((await call('POST', '/api/account/password', { current: DEMO_PASSWORD, next: 'ganz-neues-passwort' })).statusCode).toBe(403);
    expect((await call('POST', '/api/account/sessions/revoke-others')).statusCode).toBe(403);
    expect((await call('GET', '/api/admin/backup')).statusCode).toBe(403);
    expect((await app.inject({ method: 'HEAD', url: '/api/admin/backup', headers: auth(admin) })).statusCode).toBe(403);
    expect((await call('POST', '/api/admin/backups')).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/admin/restore', headers: { ...auth(admin), 'content-type': 'application/x-sqlite3' }, payload: Buffer.alloc(200) })).statusCode).toBe(403);

    const users = (await call('GET', '/api/admin/users')).json() as { id: string; username: string }[];
    const betreuer = users.find((u) => u.username === 'betreuer')!;
    const r = await call('PATCH', `/api/admin/users/${betreuer.id}`, { disabled: true });
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toMatch(/Demo/);
    expect((await call('DELETE', `/api/admin/users/${betreuer.id}`)).statusCode).toBe(403);
    expect((await call('POST', `/api/admin/users/${betreuer.id}/invite`)).statusCode).toBe(403);
    expect(await login('betreuer')).toBeTruthy();

    // Selbst angelegte Benutzer lassen sich ganz normal verwalten.
    const created = (await call('POST', '/api/admin/users', { username: 'gast', displayName: 'Gast' })).json();
    expect(created.invite.code).toBeTruthy();
    expect((await call('PATCH', `/api/admin/users/${created.user.id}`, { displayName: 'Gast 2' })).statusCode).toBe(200);
    expect((await call('DELETE', `/api/admin/users/${created.user.id}`)).statusCode).toBe(200);

    // Normale Arbeit bleibt erlaubt.
    expect((await call('PUT', '/api/admin/settings', { orgName: 'JF Probe' })).statusCode).toBe(200);
  });

  it('lässt sich die Demo-Zugänge nicht durch Fehlversuche sperren', async () => {
    for (let i = 0; i < 15; i++) {
      const r = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'betreuer', password: 'falsch' } });
      expect(r.statusCode).toBe(401);
    }
    expect(await login('betreuer')).toBeTruthy();
  });

  it('setzt alles zurück: Besucherdaten weg, Sitzungen beendet, neue Epoche', async () => {
    const token = await login('jugendwart');
    const before = await sync(token, {
      changes: [{ id: 'besucher-1', baseRev: 0, title: 'Von einem Besucher', datum: '2026-10-01', beginn: '', ende: '', ort: '', leitung: '', content: { type: 'doc', content: [] }, updatedAt: Date.now(), deleted: false, shared: true }],
    });
    expect(before.changes.map((d) => d.title)).toContain('Von einem Besucher');
    const oldUsers = (db.prepare('SELECT id FROM users').all() as { id: string }[]).map((u) => u.id);
    const vapid = getConfig(db, 'vapidPrivate');
    const rev = currentRev(db);

    await resetDemo(db);

    expect((await app.inject({ method: 'POST', url: '/api/sync', headers: auth(token), payload: { since: 0, changes: [] } })).statusCode).toBe(401);
    const newUsers = (db.prepare('SELECT id FROM users').all() as { id: string }[]).map((u) => u.id);
    expect(newUsers.some((id) => oldUsers.includes(id))).toBe(false);
    expect(getConfig(db, 'vapidPrivate')).toBe(vapid);
    expect(currentRev(db)).toBeGreaterThan(rev);

    const after = await sync(await login('jugendwart'), { since: before.rev, epoch: before.epoch });
    expect(after.reset).toBe(true);
    expect(after.epoch).not.toBe(before.epoch);
    expect(after.changes.map((d) => d.title)).not.toContain('Von einem Besucher');
    expect(after.changes.map((d) => d.title)).toContain('Dienst: Knoten und Stiche');
  });
});

describe('ohne Demo-Modus', () => {
  it('verrät keine Zugänge und sperrt nichts', async () => {
    const plain = await buildApp({ db: openDb(':memory:'), adminPassword: 'ein-sicheres-passwort', pushTimer: false });
    try {
      const st = (await plain.inject({ method: 'GET', url: '/api/status' })).json();
      expect(st.demo).toBeUndefined();
      const token = (await plain.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: 'ein-sicheres-passwort' } })).json().token;
      expect((await plain.inject({ method: 'GET', url: '/api/admin/backup', headers: auth(token) })).statusCode).toBe(200);
    } finally {
      await plain.close();
    }
  });
});
