import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { API_VERSION, MIN_SCHEMA, buildApp } from './app.js';
import { openDb } from './db.js';

const PW = 'ein-sicheres-passwort';
let app: FastifyInstance;

async function start(minSchema?: number) {
  app = await buildApp({ db: openDb(':memory:'), adminPassword: PW, pushTimer: false, minSchema });
  const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW, device: 'Test' } });
  return { token: login.json().token as string };
}

afterEach(async () => {
  await app.close();
});

const sync = (token: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url: '/api/sync', headers: { authorization: `Bearer ${token}`, ...headers }, payload: { since: 0, protocols: [] } });

describe('Handshake zwischen App und Server', () => {
  it('der Status nennt Schnittstelle und Mindest-Format (ohne Anmeldung, die App prüft es vor dem Abgleich)', async () => {
    await start();
    const r = await app.inject({ method: 'GET', url: '/api/status' });
    expect(r.json()).toMatchObject({ api: API_VERSION, minSchema: MIN_SCHEMA, features: ['blobs', 'collab'] });
  });

  it('die Abgleich-Antwort nennt Schnittstelle und Mindest-Format', async () => {
    const { token } = await start();
    const r = await sync(token, { 'x-jfh-schema': '5' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ api: API_VERSION, minSchema: MIN_SCHEMA });
  });

  it('seit 3.0.0 werden alle Apps vor Format 5 abgewiesen, auch 2.3.x (der Text wird anders übertragen)', async () => {
    const { token } = await start();
    expect(MIN_SCHEMA).toBe(5);
    expect(API_VERSION).toBe(4);
    const old = await sync(token); // 2.0.x sendet keinen Header: Format 1
    expect(old.statusCode).toBe(426);
    expect(old.json()).toMatchObject({ code: 'client_too_old', minSchema: 5 });
    expect(old.json().error).toContain('App aktualisieren');
    for (const schema of ['1', '2', '3', '4']) expect((await sync(token, { 'x-jfh-schema': schema })).statusCode, schema).toBe(426);
    expect((await sync(token, { 'x-jfh-schema': '5' })).statusCode).toBe(200);
  });

  it('die Sperre gilt auch für den Austausch des Textes', async () => {
    const { token } = await start();
    const exchange = (schema?: string) =>
      app.inject({ method: 'POST', url: '/api/collab/exchange', headers: { authorization: `Bearer ${token}`, ...(schema ? { 'x-jfh-schema': schema } : {}) }, payload: { docs: [] } });
    expect((await exchange()).statusCode).toBe(426);
    expect((await exchange('4')).statusCode).toBe(426);
    expect((await exchange('5')).statusCode).toBe(200);
  });

  it('verlangt der Server ein höheres Format, bekommen ältere Apps 426', async () => {
    const { token } = await start(7);
    expect((await sync(token)).statusCode).toBe(426); // ohne Header: Format 1
    expect((await sync(token, { 'x-jfh-schema': '1' })).statusCode).toBe(426);
    expect((await sync(token, { 'x-jfh-schema': 'kaputt' })).statusCode).toBe(426);
    expect((await sync(token, { 'x-jfh-schema': '6' })).statusCode).toBe(426);
    expect((await sync(token, { 'x-jfh-schema': '7' })).statusCode).toBe(200);
    expect((await sync(token, { 'x-jfh-schema': '8' })).statusCode).toBe(200);
  });

  it('die Sperre trifft nur den Abgleich: Anmeldung und Status gehen weiter, damit die App die Meldung zeigen kann', async () => {
    await start();
    expect((await app.inject({ method: 'GET', url: '/api/status' })).statusCode).toBe(200);
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW, device: 'Alt' } });
    expect(login.statusCode).toBe(200);
  });
});
