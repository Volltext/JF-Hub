import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtoError, request } from './http';
import { SCHEMA_VERSION } from './schemaVersion';

type Call = { url: string; init: RequestInit };
let calls: Call[];

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
    }),
  );
}

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const conn = { url: 'https://hub.example', token: 'geheim' };

describe('request', () => {
  it('meldet App-Version und Dokumentformat und sendet das Token', async () => {
    respond(200, { ok: true });
    await request(conn, 'GET', '/api/me');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.url).toBe('https://hub.example/api/me');
    expect(headers).toMatchObject({ Authorization: 'Bearer geheim', 'X-JFH-Client': __APP_VERSION__, 'X-JFH-Schema': String(SCHEMA_VERSION) });
  });

  it('schickt JSON und liefert die Antwort', async () => {
    respond(200, { rev: 3 });
    expect(await request(conn, 'POST', '/api/sync', { since: 0 })).toEqual({ rev: 3 });
    expect(calls[0]!.init.body).toBe('{"since":0}');
    expect((calls[0]!.init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('übersetzt Fehler: Meldung des Servers, 401, 426 und zu viele Versuche', async () => {
    respond(401, { error: 'Nicht angemeldet' });
    await expect(request(conn, 'GET', '/api/me')).rejects.toMatchObject({ status: 401, message: 'Nicht angemeldet' });
    respond(426, { error: 'Diese App-Version ist zu alt für den Server. Bitte die App aktualisieren.', code: 'client_too_old' });
    await expect(request(conn, 'POST', '/api/sync', {})).rejects.toMatchObject({ status: 426, message: expect.stringContaining('App aktualisieren') });
    respond(429, {});
    await expect(request(conn, 'POST', '/api/login', {})).rejects.toMatchObject({ status: 429 });
    respond(500, 'kein JSON');
    await expect(request(conn, 'GET', '/api/x')).rejects.toMatchObject({ status: 500, message: 'Serverfehler 500.' });
  });

  it('ohne Netz: keine Verbindung (Status 0), ohne Adresse: nicht eingerichtet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(request(conn, 'GET', '/api/me')).rejects.toMatchObject({ status: 0, message: 'Keine Verbindung zum Server.' });
    await expect(request({ url: '', token: null }, 'GET', '/api/me')).rejects.toBeInstanceOf(ProtoError);
  });
});
