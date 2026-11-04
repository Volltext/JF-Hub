import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { buildApp } from './app.js';
import { openDb } from './db.js';
import { createUser } from './auth.js';
import { resetDemo } from './demo.js';
import { LIVE_MAX_BYTES, type LiveDraft } from './live.js';

const PW = 'ein-sicheres-passwort';
let db: DatabaseSync;
let app: FastifyInstance;

beforeEach(async () => {
  db = openDb(':memory:');
  app = await buildApp({ db, adminPassword: PW, pushTimer: false, liveWaitMs: 300 });
  await createUser(db, { username: 'tobias', displayName: 'Tobias', role: 'betreuer', password: PW });
});
afterEach(async () => {
  await app.close();
});

async function login(username: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/login', payload: { username, password: PW, device: 'Test' } });
  expect(r.statusCode).toBe(200);
  return r.json().token as string;
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

interface PollResponse {
  epoch: string;
  rev: number;
  full: boolean;
  now: number;
  held: number;
  drafts: LiveDraft[];
}

const poll = (token: string, query: string) => app.inject({ method: 'GET', url: `/api/live?${query}`, headers: auth(token) });

async function put(token: string, mode: string, baseRev: number, draft: unknown) {
  const r = await app.inject({ method: 'PUT', url: `/api/live/${mode}`, headers: auth(token), payload: { baseRev, draft } });
  return { status: r.statusCode, body: r.json() };
}

describe('Live-Stoppuhr', () => {
  it('verlangt eine Anmeldung', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/live' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: '/api/live/a', payload: { baseRev: 0, draft: {} } })).statusCode).toBe(401);
  });

  it('liefert beim ersten Abruf sofort die vollständige Liste mit Epoche und Server-Zeit', async () => {
    const t = await login('admin');
    const before = Date.now();
    const r = await poll(t, 'since=0');
    expect(r.statusCode).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const body = r.json() as PollResponse;
    expect(body).toMatchObject({ full: true, rev: 0, drafts: [] });
    expect(body.epoch).toBeTruthy();
    expect(body.now).toBeGreaterThanOrEqual(before);
    expect(body.held).toBeLessThan(300);
  });

  it('eine wartende Abfrage bekommt die Änderung eines anderen Betreuers sofort', async () => {
    const admin = await login('admin');
    const tobias = await login('tobias');
    const { epoch } = (await poll(tobias, 'since=0')).json() as PollResponse;

    const waiting = poll(tobias, `since=0&epoch=${epoch}`);
    await new Promise((r) => setTimeout(r, 20));
    const w = await put(admin, 'a', 0, { mode: 'a', isRunning: true, startTimestamp: 1000 });
    expect(w).toMatchObject({ status: 200, body: { accepted: true, rev: 1 } });

    const body = (await waiting).json() as PollResponse;
    expect(body.full).toBe(false);
    expect(body.rev).toBe(1);
    expect(body.drafts).toEqual([
      expect.objectContaining({ mode: 'a', rev: 1, draft: { mode: 'a', isRunning: true, startTimestamp: 1000 }, by: { id: expect.any(String), name: 'Admin' } }),
    ]);
    expect(body.held).toBeGreaterThan(0);
  });

  it('wartet ohne Änderung höchstens die eingestellte Zeit, mit wait=0 gar nicht', async () => {
    const t = await login('admin');
    const { epoch } = (await poll(t, 'since=0')).json() as PollResponse;
    const t0 = Date.now();
    const idle = (await poll(t, `since=0&epoch=${epoch}`)).json() as PollResponse;
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    expect(idle).toMatchObject({ full: false, drafts: [] });

    const t1 = Date.now();
    await poll(t, `since=0&epoch=${epoch}&wait=0`);
    expect(Date.now() - t1).toBeLessThan(250);
  });

  it('liefert nur, was nach `since` kam', async () => {
    const t = await login('admin');
    const { epoch } = (await poll(t, 'since=0')).json() as PollResponse;
    await put(t, 'a', 0, { v: 1 });
    await put(t, 'b', 0, { v: 1 });
    await put(t, 'a', 1, { v: 2 });
    const body = (await poll(t, `since=2&epoch=${epoch}`)).json() as PollResponse;
    expect(body.drafts.map((d) => [d.mode, d.rev])).toEqual([['a', 3]]);
  });

  it('schreibt nur auf dem aktuellen Stand, sonst kommt dieser zurück', async () => {
    const admin = await login('admin');
    const tobias = await login('tobias');
    expect((await put(admin, 'a', 0, { v: 'admin' })).body).toMatchObject({ accepted: true, rev: 1 });
    // Tobias kennt den Stand noch nicht (baseRev 0) und tippt gleichzeitig.
    const stale = await put(tobias, 'a', 0, { v: 'tobias' });
    expect(stale.status).toBe(200);
    expect(stale.body).toMatchObject({ accepted: false, current: { mode: 'a', rev: 1, draft: { v: 'admin' } } });
    expect(typeof stale.body.now).toBe('number');
    expect((await put(tobias, 'a', 1, { v: 'beide' })).body).toMatchObject({ accepted: true, rev: 2 });
    // Ein Stand, den es nicht (mehr) gibt: aktueller Stand ist „keiner“.
    expect((await put(tobias, 'b', 5, { v: 1 })).body).toMatchObject({ accepted: false, current: null });
  });

  it('prüft Modus, Revision und Größe', async () => {
    const t = await login('admin');
    expect((await put(t, 'A%20Teil', 0, {})).status).toBe(400);
    expect((await put(t, 'a', -1, {})).status).toBe(400);
    expect((await put(t, 'a', 0, [1, 2])).status).toBe(400);
    expect((await put(t, 'a', 0, null)).status).toBe(400);
    expect((await put(t, 'a', 0, { notes: 'x'.repeat(LIVE_MAX_BYTES) })).status).toBe(400);
    expect((await put(t, 'lsp-schnelligkeit', 0, { ok: true })).status).toBe(200);
  });

  it('Cookie-Sitzungen brauchen beim Schreiben den CSRF-Header', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW } });
    const cookie = (r.headers['set-cookie'] as string).split(';')[0]!;
    const bad = await app.inject({ method: 'PUT', url: '/api/live/a', headers: { cookie }, payload: { baseRev: 0, draft: {} } });
    expect(bad.statusCode).toBe(403);
    const ok = await app.inject({ method: 'PUT', url: '/api/live/a', headers: { cookie, 'x-jfh': '1' }, payload: { baseRev: 0, draft: {} } });
    expect(ok.statusCode).toBe(200);
  });

  it('andere Epoche oder unbekannt hohe Revision: sofort die vollständige Liste', async () => {
    const t = await login('admin');
    await put(t, 'a', 0, { v: 1 });
    const { epoch } = (await poll(t, 'since=0')).json() as PollResponse;
    expect(((await poll(t, `since=1&epoch=alt`)).json() as PollResponse)).toMatchObject({ full: true, drafts: [{ mode: 'a' }] });
    expect(((await poll(t, `since=99&epoch=${epoch}`)).json() as PollResponse)).toMatchObject({ full: true, drafts: [{ mode: 'a' }] });
  });

  it('Beenden des Servers beantwortet wartende Abfragen sofort', async () => {
    const slow = await buildApp({ db: openDb(':memory:'), adminPassword: PW, pushTimer: false, liveWaitMs: 60_000 });
    const r = await slow.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW } });
    const t = r.json().token as string;
    const { epoch } = (await slow.inject({ method: 'GET', url: '/api/live?since=0', headers: auth(t) })).json() as PollResponse;
    const waiting = slow.inject({ method: 'GET', url: `/api/live?since=0&epoch=${epoch}`, headers: auth(t) });
    await new Promise((res) => setTimeout(res, 20));
    const t0 = Date.now();
    await slow.close();
    expect((await waiting).statusCode).toBe(200);
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it('Demo-Zurücksetzen leert die Stoppuhren und wechselt die Epoche', async () => {
    const t = await login('admin');
    await put(t, 'a', 0, { v: 1 });
    const before = (await poll(t, 'since=0')).json() as PollResponse;
    await resetDemo(db);
    expect((db.prepare('SELECT COUNT(*) AS n FROM live_drafts').get() as { n: number }).n).toBe(0);
    const { getConfig } = await import('./db.js');
    expect(getConfig(db, 'liveRev')).toBe('1');
    expect(getConfig(db, 'epoch')).not.toBe(before.epoch);
  });
});
