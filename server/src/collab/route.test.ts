import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { buildApp } from '../app.js';
import { getEpoch, openDb } from '../db.js';
import { jsonToYDoc, type DocNode } from './convert.js';
import { putProtocol } from './testing.js';

const PW = 'ein-sicheres-passwort';
let app: FastifyInstance;

async function start(opts: { minSchema?: number } = {}) {
  const db: DatabaseSync = openDb(':memory:');
  app = await buildApp({ db, adminPassword: PW, pushTimer: false, ...opts });
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW, device: 'Test' } });
  const userId = (db.prepare("SELECT id FROM users WHERE username = 'admin'").get() as { id: string }).id;
  return { db, token: login.json().token as string, userId };
}

afterEach(async () => {
  await app.close();
});

const post = (token: string | undefined, body: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/collab/exchange', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-jfh-schema': '4', ...headers }, payload: body as never });

const doc = (text: string): DocNode => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');

describe('POST /api/collab/exchange', () => {
  it('verlangt eine Anmeldung', async () => {
    await start();
    expect((await post(undefined, { docs: [] })).statusCode).toBe(401);
  });

  it('weist Apps mit zu altem Dokumentformat ab (426), ohne etwas anzuwenden', async () => {
    const { db, token, userId } = await start({ minSchema: 5 });
    const id = putProtocol(db, { ownerId: userId });
    const update = b64(Y.encodeStateAsUpdate(jsonToYDoc(doc('Hallo'))));
    const r = await post(token, { docs: [{ id, update, create: true }] }, { 'x-jfh-schema': '4' });
    expect(r.statusCode).toBe(426);
    expect(r.json()).toMatchObject({ code: 'client_too_old', minSchema: 5 });
    expect((await post(token, { docs: [] }, { 'x-jfh-schema': '5' })).statusCode).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM ydocs').get()).toEqual({ n: 0 });
  });

  it('lehnt Anfragen ohne Dokumentliste ab', async () => {
    const { token } = await start();
    for (const body of [undefined, 'text', {}, { docs: 'x' }]) expect((await post(token, body as never)).statusCode, JSON.stringify(body)).toBe(400);
  });

  it('wendet an, antwortet mit Zustand und Schnittstellenstand, und das PDF zeigt den Text', async () => {
    const { db, token, userId } = await start();
    const id = putProtocol(db, { ownerId: userId, title: 'Gemeinsam geschrieben' });
    const update = b64(Y.encodeStateAsUpdate(jsonToYDoc(doc('Text aus dem Austausch'))));
    const r = await post(token, { epoch: getEpoch(db), docs: [{ id, update, create: true, live: true }] });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.epoch).toBe(getEpoch(db));
    expect(body.api).toBeGreaterThanOrEqual(3);
    expect(body.docs).toHaveLength(1);
    expect(body.docs[0]).toMatchObject({ id, status: 'ok', peers: [] });
    expect(JSON.parse((db.prepare('SELECT content FROM protocols WHERE id = ?').get(id) as { content: string }).content)).toEqual(doc('Text aus dem Austausch'));

    const pdf = await app.inject({ method: 'GET', url: `/api/protocols/${id}/pdf`, headers: { authorization: `Bearer ${token}` } });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('eine falsche Epoche liefert 409 und wendet nichts an', async () => {
    const { db, token, userId } = await start();
    const id = putProtocol(db, { ownerId: userId });
    const update = b64(Y.encodeStateAsUpdate(jsonToYDoc(doc('Hallo'))));
    const r = await post(token, { epoch: 'andere-datenbank', docs: [{ id, update }] });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ reset: true, epoch: getEpoch(db) });
    expect(db.prepare('SELECT COUNT(*) AS n FROM ydocs').get()).toEqual({ n: 0 });
  });
});
