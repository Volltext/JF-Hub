import { createHash, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import { buildApp } from './app.js';
import { DEMO_MAX_PHOTO_BYTES, MAX_FILE_BYTES, MAX_PHOTO_BYTES } from './blobs.js';
import { openDb } from './db.js';
import { DEMO_PASSWORD } from './demo.js';
import type { DocNode } from './collab/convert.js';
import { headerChange, putProtocol } from './collab/testing.js';
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

const auth = (token: string) => ({ authorization: `Bearer ${token}`, 'x-jfh-schema': '5' });

async function adminToken(): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW, device: 'Test' } });
  expect(r.statusCode).toBe(200);
  return r.json().token as string;
}

async function betreuer(admin: string, username: string): Promise<string> {
  const created = await app.inject({ method: 'POST', url: '/api/admin/users', headers: auth(admin), payload: { username, displayName: username.toUpperCase() } });
  const accepted = await app.inject({ method: 'POST', url: '/api/invite/accept', payload: { username, code: created.json().invite.code, password: 'passwort-fuer-betreuer' } });
  expect(accepted.statusCode).toBe(200);
  return accepted.json().token as string;
}

/** Beginnt wie ein JPEG (mehr prüft der Server nicht): Anfang, ein Kopfstück, Zufallsdaten, Ende. */
const jpeg = (size = 64): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(size), Buffer.from([0xff, 0xd9])]);
const png = (): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(32)]);

interface Upload {
  kind?: string;
  name?: string;
  mime?: string;
}
const put = (token: string, id: string, bytes: Buffer, over: Upload = {}, a: FastifyInstance = app) =>
  a.inject({ method: 'PUT', url: `/api/blobs/${id}`, headers: auth(token), payload: { kind: 'photo', mime: 'image/jpeg', ...over, data: bytes.toString('base64') } });
const get = (token: string, id: string, a: FastifyInstance = app) => a.inject({ method: 'GET', url: `/api/blobs/${id}`, headers: auth(token) });

const userId = (username: string) => (db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: string }).id;
const photoContent = (blobId: string): DocNode => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Text' }] },
    { type: 'photo', attrs: { blobId, mime: 'image/jpeg', w: 800, h: 600, caption: 'Teich' } },
  ],
});

/** Ein Protokoll mit Foto, der Text als Yjs-Dokument (wie nach 3.0.0). */
const photoDoc = (owner: string, id: string, blobId: string, shared = false) =>
  putProtocol(db, { id, title: 'Mit Foto', ownerId: userId(owner), shared, content: photoContent(blobId) });

/** Änderung der Kopfdaten eines solchen Protokolls. */
const header = (id: string, over: Partial<ClientChange> = {}) => headerChange(id, { title: 'Mit Foto', ...over });

async function sync(token: string, protocols: ClientChange[]): Promise<SyncResponse> {
  const r = await app.inject({ method: 'POST', url: '/api/sync', headers: auth(token), payload: { since: 0, protocols } });
  expect(r.statusCode).toBe(200);
  return r.json() as SyncResponse;
}

describe('Blob-Schnittstelle', () => {
  it('speichert ein Foto und liefert dieselben Bytes zurück', async () => {
    const anna = await betreuer(await adminToken(), 'anna');
    const bytes = jpeg(500);
    const r = await put(anna, 'foto-0001', bytes);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, id: 'foto-0001', size: bytes.length, created: true });
    expect(r.json().sha256).toMatch(/^[0-9a-f]{64}$/);

    const g = await get(anna, 'foto-0001');
    expect(g.statusCode).toBe(200);
    expect(g.headers['content-type']).toBe('image/jpeg');
    expect(g.headers['content-disposition']).toBe('inline');
    expect(g.headers['x-content-type-options']).toBe('nosniff');
    expect(g.headers['cache-control']).toBe('no-store');
    expect(Buffer.compare(g.rawPayload, bytes)).toBe(0);
  });

  it('HEAD sagt, ob es das Foto gibt, und nennt seine Länge, ohne es zu senden', async () => {
    const anna = await betreuer(await adminToken(), 'anna');
    const bytes = jpeg(300);
    await put(anna, 'foto-0001', bytes);
    const h = await app.inject({ method: 'HEAD', url: '/api/blobs/foto-0001', headers: auth(anna) });
    expect(h.statusCode).toBe(200);
    expect(h.body).toBe('');
    expect(h.headers['content-length']).toBe(String(bytes.length));
    expect((await app.inject({ method: 'HEAD', url: '/api/blobs/gibt-es-nicht', headers: auth(anna) })).statusCode).toBe(404);
  });

  it('Hochladen ist wiederholbar; andere Bytes unter derselben Kennung werden abgewiesen', async () => {
    const anna = await betreuer(await adminToken(), 'anna');
    const bytes = jpeg();
    expect((await put(anna, 'foto-0001', bytes)).json().created).toBe(true);
    const again = await put(anna, 'foto-0001', bytes);
    expect(again.statusCode).toBe(200);
    expect(again.json().created).toBe(false);
    expect((await put(anna, 'foto-0001', jpeg())).statusCode).toBe(409);
    expect(Buffer.compare((await get(anna, 'foto-0001')).rawPayload, bytes)).toBe(0);
  });

  it('ein Foto muss ein JPEG sein, auch wenn es sich anders ausgibt', async () => {
    const anna = await betreuer(await adminToken(), 'anna');
    const notJpeg = await put(anna, 'foto-0001', png());
    expect(notJpeg.statusCode).toBe(400);
    expect(notJpeg.json().error).toContain('JPEG');
    expect((await put(anna, 'foto-0002', Buffer.from('<html>kein Bild</html>'), { mime: 'image/jpeg' })).statusCode).toBe(400);
    expect((await put(anna, 'foto-0003', Buffer.alloc(0))).statusCode).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS n FROM blobs').get()).toEqual({ n: 0 });
  });

  it('Kennungen, die der Server aus dem Inhalt bildet, tragen nur passenden Inhalt', async () => {
    const anna = await betreuer(await adminToken(), 'anna');
    const bytes = jpeg(200);
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 40);
    // Eine App darf einen solchen Anhang erneut hochladen (zum Beispiel nach einer ersetzten Datenbank) …
    expect((await put(anna, `p-${hash}`, bytes)).statusCode).toBe(200);
    // … aber niemand kann die Kennung mit anderem Inhalt besetzen oder als andere Art ausgeben.
    expect((await put(anna, `p-${hash}`, jpeg(200))).statusCode).toBe(400);
    const other = jpeg(50);
    const otherHash = createHash('sha256').update(other).digest('hex').slice(0, 40);
    expect((await put(anna, `p-${otherHash.replace(/.$/, '0')}`, other)).statusCode).toBe(400); // andere Kennung als der Hash
    expect((await put(anna, `f-${otherHash}`, other)).statusCode).toBe(400); // Kennung einer Datei, aber als Foto hochgeladen
    expect((await put(anna, `f-${otherHash}`, other, { kind: 'file', name: 'x.bin', mime: 'application/octet-stream' })).statusCode).toBe(200);
  });

  it('begrenzt Fotos und Dateien', async () => {
    const anna = await betreuer(await adminToken(), 'anna');
    const bigPhoto = Buffer.concat([jpeg(), Buffer.alloc(MAX_PHOTO_BYTES)]);
    expect((await put(anna, 'foto-gross', bigPhoto)).statusCode).toBe(413);
    const bigFile = Buffer.alloc(MAX_FILE_BYTES + 1, 7);
    expect((await put(anna, 'datei-gross', bigFile, { kind: 'file', name: 'x.bin', mime: 'application/octet-stream' })).statusCode).toBe(413);
    // knapp darunter geht
    expect((await put(anna, 'datei-fast', Buffer.alloc(MAX_FILE_BYTES, 7), { kind: 'file', name: 'x.bin', mime: 'application/octet-stream' })).statusCode).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM blobs').get()).toEqual({ n: 1 });
  });

  it('Dateien werden nie inline ausgeliefert und tragen nur einen bereinigten Namen', async () => {
    const anna = await betreuer(await adminToken(), 'anna');
    const html = Buffer.from('<script>alert(1)</script>');
    const r = await put(anna, 'datei-001', html, { kind: 'file', name: 'ä<b>"Plan".html', mime: 'text/html' });
    expect(r.statusCode).toBe(200);
    const g = await get(anna, 'datei-001');
    expect(g.statusCode).toBe(200);
    expect(g.headers['content-type']).toBe('application/octet-stream');
    expect(g.headers['x-content-type-options']).toBe('nosniff');
    const disposition = String(g.headers['content-disposition']);
    expect(disposition).toMatch(/^attachment; filename\*=UTF-8''/);
    expect(decodeURIComponent(disposition.replace(/^.*UTF-8''/, ''))).toBe('äbPlan.html');
    expect(Buffer.compare(g.rawPayload, html)).toBe(0);
  });

  it('lehnt ungültige Angaben ab', async () => {
    const anna = await betreuer(await adminToken(), 'anna');
    const raw = (id: string, payload: unknown) => app.inject({ method: 'PUT', url: `/api/blobs/${id}`, headers: auth(anna), payload: payload as never });
    const data = jpeg().toString('base64');
    expect((await raw('foto-0001', { data })).statusCode).toBe(400); // Art fehlt
    expect((await raw('foto-0001', { kind: 'video', data })).statusCode).toBe(400);
    expect((await raw('foto-0001', { kind: 'photo', data: 'das ist kein base64!' })).statusCode).toBe(400);
    expect((await raw('foto-0001', { kind: 'photo' })).statusCode).toBe(400);
    expect((await raw('abc', { kind: 'photo', data })).statusCode).toBe(400); // Kennung zu kurz
    expect((await raw('foto-0001', [1, 2, 3])).statusCode).toBe(400);
    expect(db.prepare('SELECT COUNT(*) AS n FROM blobs').get()).toEqual({ n: 0 });
  });

  it('verlangt eine Anmeldung', async () => {
    const anna = await betreuer(await adminToken(), 'anna');
    await put(anna, 'foto-0001', jpeg());
    expect((await app.inject({ method: 'GET', url: '/api/blobs/foto-0001' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'HEAD', url: '/api/blobs/foto-0001' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: '/api/blobs/foto-0002', payload: { kind: 'photo', data: jpeg().toString('base64') } })).statusCode).toBe(401);
  });
});

describe('Wer ein Foto sehen darf', () => {
  it('der Hochladende immer, andere nur über ein sichtbares, nicht gelöschtes Protokoll', async () => {
    const admin = await adminToken();
    const anna = await betreuer(admin, 'anna');
    const ben = await betreuer(admin, 'ben');
    const bytes = jpeg();
    const status = async (t: string) => (await get(t, 'foto-0001')).statusCode;

    expect((await put(anna, 'foto-0001', bytes)).statusCode).toBe(200);
    expect(await status(anna)).toBe(200);
    expect(await status(ben)).toBe(404); // noch verweist nichts darauf

    photoDoc('anna', 'doc-0001', 'foto-0001'); // privates Protokoll
    expect(await status(ben)).toBe(404);
    expect(await status(admin)).toBe(404); // auch der Admin sieht Privates anderer nicht

    await sync(anna, [header('doc-0001', { shared: true })]);
    expect(await status(ben)).toBe(200);
    expect(await status(admin)).toBe(200);
    expect(Buffer.compare((await get(ben, 'foto-0001')).rawPayload, bytes)).toBe(0);

    await sync(anna, [header('doc-0001', { shared: false })]);
    expect(await status(ben)).toBe(404); // zurückgenommen
    expect(await status(anna)).toBe(200);

    await sync(anna, [header('doc-0001', { shared: true })]);
    expect(await status(ben)).toBe(200);
    await sync(anna, [header('doc-0001', { shared: true, deleted: true })]);
    expect(await status(ben)).toBe(404); // das Protokoll liegt im Papierkorb
    expect(await status(anna)).toBe(200);
  });

  it('ein Foto in einem Protokoll, das jemand wiederherstellt, ist wieder sichtbar', async () => {
    const admin = await adminToken();
    const anna = await betreuer(admin, 'anna');
    const ben = await betreuer(admin, 'ben');
    await put(anna, 'foto-0001', jpeg());
    photoDoc('anna', 'doc-0001', 'foto-0001', true);
    expect((await get(ben, 'foto-0001')).statusCode).toBe(200);
    const b = await sync(anna, [header('doc-0001', { shared: true, deleted: true })]);
    expect((await get(ben, 'foto-0001')).statusCode).toBe(404);
    expect(b.changes[0]!.deleted).toBe(true);
    expect((await app.inject({ method: 'POST', url: '/api/protocols/doc-0001/restore', headers: auth(anna) })).statusCode).toBe(200);
    expect((await get(ben, 'foto-0001')).statusCode).toBe(200);
  });
});

describe('Demo', () => {
  it('nimmt nur kleine Fotos an, keine Dateien', async () => {
    const demo = await buildApp({ db: openDb(':memory:'), pushTimer: false, demo: { timer: false } });
    try {
      const login = await demo.inject({ method: 'POST', url: '/api/login', payload: { username: 'betreuer', password: DEMO_PASSWORD, device: 'Test' } });
      const token = login.json().token as string;
      expect((await put(token, 'foto-0001', jpeg(), {}, demo)).statusCode).toBe(200);
      const big = Buffer.concat([jpeg(), Buffer.alloc(DEMO_MAX_PHOTO_BYTES)]);
      expect((await put(token, 'foto-gross', big, {}, demo)).statusCode).toBe(413);
      const file = await put(token, 'datei-001', Buffer.from('hallo'), { kind: 'file', name: 'x.txt', mime: 'text/plain' }, demo);
      expect(file.statusCode).toBe(403);
      expect(file.json().error).toContain('Demo');
      expect((await get(token, 'foto-0001', demo)).statusCode).toBe(200);
    } finally {
      await demo.close();
    }
  });
});
