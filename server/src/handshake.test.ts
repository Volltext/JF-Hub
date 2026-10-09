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
  app.inject({ method: 'POST', url: '/api/sync', headers: { authorization: `Bearer ${token}`, ...headers }, payload: { since: 0, changes: [] } });

describe('Handshake zwischen App und Server', () => {
  it('der Status nennt Schnittstelle und Mindest-Format (ohne Anmeldung, die App prüft es vor dem Abgleich)', async () => {
    await start();
    const r = await app.inject({ method: 'GET', url: '/api/status' });
    expect(r.json()).toMatchObject({ api: API_VERSION, minSchema: MIN_SCHEMA, features: ['blobs'] });
  });

  it('die Abgleich-Antwort nennt Schnittstelle und Mindest-Format', async () => {
    const { token } = await start();
    const r = await sync(token, { 'x-jfh-schema': '2' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ api: API_VERSION, minSchema: MIN_SCHEMA });
  });

  it('Apps ohne Angabe (2.0.x) gelten als Format 1 und werden seit der Auslagerung der Anhänge abgewiesen', async () => {
    const { token } = await start();
    expect(MIN_SCHEMA).toBe(2);
    const old = await sync(token);
    expect(old.statusCode).toBe(426);
    expect(old.json()).toMatchObject({ code: 'client_too_old', minSchema: 2 });
    expect(old.json().error).toContain('App aktualisieren');
    expect((await sync(token, { 'x-jfh-schema': '2' })).statusCode).toBe(200); // 2.1.0 und neuer
  });

  it('verlangt der Server ein höheres Format, bekommen ältere Apps 426', async () => {
    const { token } = await start(3);
    expect((await sync(token)).statusCode).toBe(426); // ohne Header: Format 1
    expect((await sync(token, { 'x-jfh-schema': '1' })).statusCode).toBe(426);
    expect((await sync(token, { 'x-jfh-schema': 'kaputt' })).statusCode).toBe(426);
    expect((await sync(token, { 'x-jfh-schema': '2' })).statusCode).toBe(426);
    expect((await sync(token, { 'x-jfh-schema': '3' })).statusCode).toBe(200);
    expect((await sync(token, { 'x-jfh-schema': '4' })).statusCode).toBe(200);
  });

  it('die Sperre trifft nur den Abgleich: Anmeldung und Status gehen weiter, damit die App die Meldung zeigen kann', async () => {
    await start(2);
    expect((await app.inject({ method: 'GET', url: '/api/status' })).statusCode).toBe(200);
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { username: 'admin', password: PW, device: 'Alt' } });
    expect(login.statusCode).toBe(200);
  });
});
