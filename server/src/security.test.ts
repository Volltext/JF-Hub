import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance, HTTPMethods } from 'fastify';
import { strFromU8, unzipSync } from 'fflate';
import { buildApp } from './app.js';
import { openDb } from './db.js';
import type { ClientChange } from './sync.js';

const PW = 'ein-sicheres-passwort';

/** Die einzigen Routen unter /api, die ohne Anmeldung erreichbar sein dürfen. Jede weitere Route verlangt eine Sitzung. */
const PUBLIC_ROUTES = new Set(['/api/health', '/api/status', '/api/login', '/api/setup', '/api/invite/accept']);

let app: FastifyInstance;
const routes: { method: string; url: string }[] = [];

beforeEach(async () => {
  routes.length = 0;
  app = await buildApp({ db: openDb(':memory:'), adminPassword: PW, pushTimer: false, onRoute: (r) => routes.push(r) });
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function adminToken(): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW, device: 'Test' } });
  expect(r.statusCode).toBe(200);
  return r.json().token as string;
}

async function betreuerToken(admin: string): Promise<string> {
  const created = await app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(admin), payload: { username: 'anna', displayName: 'Anna' } });
  expect(created.statusCode).toBe(200);
  const accepted = await app.inject({ method: 'POST', url: '/api/invite/accept', payload: { username: 'anna', code: created.json().invite.code, password: 'passwort-fuer-anna' } });
  expect(accepted.statusCode).toBe(200);
  return accepted.json().token as string;
}

interface Target {
  method: HTTPMethods;
  path: string;
  admin: boolean;
}

/** Alle geschützten Routen mit eingesetzten Platzhaltern (`/api/admin/users/:id` wird `/api/admin/users/x`). */
function protectedTargets(): Target[] {
  const seen = new Set<string>();
  const out: Target[] = [];
  for (const r of routes) {
    if (r.method === 'HEAD' || !r.url.startsWith('/api/') || PUBLIC_ROUTES.has(r.url)) continue;
    const path = r.url.replace(/:[A-Za-z]+/g, 'x');
    if (seen.has(`${r.method} ${path}`)) continue;
    seen.add(`${r.method} ${path}`);
    out.push({ method: r.method as HTTPMethods, path, admin: r.url.startsWith('/api/admin/') });
  }
  return out;
}

const hex = (c: string, lower = false) => {
  const h = c.charCodeAt(0).toString(16).padStart(2, '0');
  return `%${lower ? h : h.toUpperCase()}`;
};

/**
 * Pfade, die der Router zum selben Ziel auflöst, in denen aber Zeichen kodiert sind: je Segment das erste Zeichen,
 * außerdem alle Buchstaben und Ziffern, in Groß- und Kleinschreibung.
 */
function encodedVariants(path: string): string[] {
  const segs = path.split('/');
  const out: string[] = [];
  segs.forEach((seg, i) => {
    if (seg) out.push(segs.map((s, j) => (j === i ? hex(s[0]!) + s.slice(1) : s)).join('/'));
  });
  out.push(path.replace(/[A-Za-z0-9]/g, (c) => hex(c)));
  out.push(path.replace(/[A-Za-z0-9]/g, (c) => hex(c, true)));
  return out;
}

describe('Zugriffsschutz der API', () => {
  it('kennt die Routen (Schutz vor einem leeren Inventar)', () => {
    const targets = protectedTargets();
    expect(targets.length).toBeGreaterThan(25);
    expect(targets.some((t) => t.admin)).toBe(true);
    expect(targets.some((t) => t.path === '/api/admin/backup')).toBe(true);
  });

  it('jede geschützte Route verlangt eine Anmeldung, in jeder Schreibweise des Pfads', async () => {
    for (const t of protectedTargets()) {
      const plain = await app.inject({ method: t.method, url: t.path });
      expect(plain.statusCode, `${t.method} ${t.path}`).toBe(401);
      for (const url of encodedVariants(t.path)) {
        const r = await app.inject({ method: t.method, url });
        expect(r.statusCode, `${t.method} ${url}`).toBeGreaterThanOrEqual(400);
      }
    }
  });

  it('Betreuer erreichen keine Admin-Route, in keiner Schreibweise des Pfads', async () => {
    const anna = await betreuerToken(await adminToken());
    for (const t of protectedTargets().filter((x) => x.admin)) {
      const plain = await app.inject({ method: t.method, url: t.path, headers: auth(anna) });
      expect(plain.statusCode, `${t.method} ${t.path}`).toBe(403);
      for (const url of encodedVariants(t.path)) {
        const r = await app.inject({ method: t.method, url, headers: auth(anna) });
        expect(r.statusCode, `${t.method} ${url}`).toBeGreaterThanOrEqual(400);
      }
    }
  });

  it('prüft die Anmeldung, bevor der Body gelesen wird', async () => {
    // Ein kaputter Body darf ohne Anmeldung nie bis zum Parser kommen.
    const r = await app.inject({ method: 'POST', url: '/api/sync', headers: { 'content-type': 'application/json' }, payload: '{kaputt' });
    expect(r.statusCode).toBe(401);
  });

  it('Gesundheit und Status bleiben ohne Anmeldung erreichbar', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/status' })).statusCode).toBe(200);
  });

  it('weist unnötig kodierte Zeichen im Pfad ab, lässt notwendige Kodierung aber durch', async () => {
    expect((await app.inject({ method: 'GET', url: encodedVariants('/api/health')[0]! })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/health?x=%61' })).statusCode).toBe(200); // der Query-String zählt nicht
    expect((await app.inject({ method: 'GET', url: '/api/admin/backups/a%20b' })).statusCode).toBe(401); // ein Leerzeichen muss kodiert werden
  });

  it('API-Antworten sind nicht zwischenspeicherbar', async () => {
    const t = await adminToken();
    for (const [url, headers] of [
      ['/api/health', {}],
      ['/api/me', auth(t)],
      ['/api/export.zip', auth(t)],
      ['/api/gibt-es-nicht', {}],
    ] as const) {
      const r = await app.inject({ method: 'GET', url, headers });
      expect(r.headers['cache-control'], url).toBe('no-store');
    }
  });
});

describe('Export', () => {
  const change = (id: string, over: Partial<ClientChange> = {}): ClientChange => ({
    id,
    baseRev: 0,
    title: 'Sitzung',
    datum: '2026-10-01',
    beginn: '17:30',
    ende: '19:00',
    ort: 'Gerätehaus',
    leitung: 'Anna',
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hallo' }] }] },
    updatedAt: Date.now(),
    deleted: false,
    ...over,
  });

  async function sync(token: string, changes: ClientChange[], folders: unknown[] = [], since = 0) {
    const r = await app.inject({ method: 'POST', url: '/api/sync', headers: auth(token), payload: { since, changes, folders } });
    expect(r.statusCode).toBe(200);
    return r.json() as { rev: number; changes: { id: string; rev: number }[] };
  }

  it('das PDF eines gelöschten Protokolls gibt es nicht mehr', async () => {
    const t = await adminToken();
    const first = await sync(t, [change('doc-0001')]);
    expect((await app.inject({ method: 'GET', url: '/api/protocols/doc-0001/pdf', headers: auth(t) })).statusCode).toBe(200);
    await sync(t, [change('doc-0001', { baseRev: first.changes[0]!.rev, deleted: true })], [], first.rev);
    expect((await app.inject({ method: 'GET', url: '/api/protocols/doc-0001/pdf', headers: auth(t) })).statusCode).toBe(404);
  });

  it('ein Protokoll mit kaputtem Inhalt bricht PDF und ZIP nicht für alle', async () => {
    const t = await adminToken();
    await sync(t, [change('gut-0001', { title: 'Gut' }), change('kaputt-1', { title: 'Kaputt', content: { type: 'doc', content: [{ type: 'bulletList', content: 5 }] } })]);
    const pdf = await app.inject({ method: 'GET', url: '/api/protocols/kaputt-1/pdf', headers: auth(t) });
    expect(pdf.statusCode).toBe(422);
    expect(pdf.json().error).toContain('PDF');
    expect((await app.inject({ method: 'GET', url: '/api/protocols/gut-0001/pdf', headers: auth(t) })).statusCode).toBe(200);

    const zip = await app.inject({ method: 'GET', url: '/api/export.zip', headers: auth(t) });
    expect(zip.statusCode).toBe(200);
    const files = unzipSync(new Uint8Array(zip.rawPayload));
    const names = Object.keys(files);
    expect(names.some((n) => n.endsWith('Gut.pdf'))).toBe(true);
    expect(names.some((n) => n.endsWith('Kaputt.json'))).toBe(true); // der Rohinhalt bleibt erhalten
    expect(strFromU8(files['export-fehler.txt']!)).toContain('Kaputt');
  });

  it('Ordnernamen können das ZIP nicht verlassen', async () => {
    const t = await adminToken();
    const folder = (id: string, name: string, parentId = '') => ({ id, name, parentId, updatedAt: Date.now(), deleted: false });
    await sync(t, [change('doc-0001', { folderId: 'ordner-02' })], [folder('ordner-01', '..'), folder('ordner-02', '.', 'ordner-01')]);
    const zip = await app.inject({ method: 'GET', url: '/api/export.zip', headers: auth(t) });
    expect(zip.statusCode).toBe(200);
    for (const name of Object.keys(unzipSync(new Uint8Array(zip.rawPayload)))) {
      expect(name.split('/').filter((s) => s === '.' || s === '..'), name).toEqual([]);
    }
  });
});
