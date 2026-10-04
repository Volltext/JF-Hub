import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { loadSettings } from '@/core/settings/settings';
import { secure } from '@/core/native/secure';
import { IS_WEB } from '@/core/env';

export const PROTO_TOKEN_KEY = 'protokolle.token';

/**
 * Im Browser (PWA) liegt die Sitzung in einem httpOnly-Cookie, das Skripte nicht lesen können.
 * Lokal steht nur diese Markierung, damit die App auch offline weiß, dass jemand angemeldet ist.
 */
export const COOKIE_SESSION = 'cookie';

export class ProtoError extends Error {
  constructor(
    message: string,
    /** HTTP-Status; 0 = keine Verbindung. */
    readonly status = 0,
  ) {
    super(message);
  }
}

export interface ProtoConn {
  url: string;
  token: string | null;
}

/** Adresse und Token der aktuellen Verbindung; `url` ist leer, solange nichts eingerichtet ist. */
export async function loadConn(): Promise<ProtoConn> {
  const url = IS_WEB ? location.origin : (await loadSettings()).protocolServerUrl;
  return { url, token: await secure.get(PROTO_TOKEN_KEY) };
}

async function nativeRequest(method: string, url: string, headers: Record<string, string>, body: unknown, binary: boolean) {
  const res = await CapacitorHttp.request({
    method,
    url,
    // Ohne Content-Type lehnt der Server den Body ab (415).
    headers: body !== undefined ? { ...headers, 'Content-Type': 'application/json' } : headers,
    data: body,
    responseType: binary ? 'blob' : 'json',
    connectTimeout: 15000,
    readTimeout: 60000,
  });
  return { status: res.status, data: res.data as unknown };
}

async function webRequest(method: string, url: string, headers: Record<string, string>, body: unknown, binary: boolean) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { ...headers, 'Content-Type': 'application/json' } : headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  if (binary && res.ok) {
    const buf = new Uint8Array(await res.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { status: res.status, data: btoa(s) as unknown };
  }
  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* kein JSON */
  }
  return { status: res.status, data };
}

/** Eine Anfrage an den Server. Binärantworten kommen als Base64-String zurück. */
export async function request<T>(conn: ProtoConn, method: string, path: string, body?: unknown, binary = false): Promise<T> {
  if (!conn.url) throw new ProtoError('Kein Server eingerichtet.', 0);
  const headers: Record<string, string> = {};
  if (conn.token && conn.token !== COOKIE_SESSION) headers.Authorization = `Bearer ${conn.token}`;
  if (IS_WEB) headers['X-JFH'] = '1'; // verlangt der Server bei Cookie-Sitzungen (CSRF-Schutz)
  let res: { status: number; data: unknown };
  try {
    const send = Capacitor.isNativePlatform() ? nativeRequest : webRequest;
    res = await send(method, conn.url + path, headers, body, binary);
  } catch {
    throw new ProtoError('Keine Verbindung zum Server.', 0);
  }
  if (res.status >= 200 && res.status < 300) return res.data as T;
  const msg = (res.data as { error?: string } | null)?.error;
  if (res.status === 401) throw new ProtoError(msg ?? 'Nicht angemeldet.', 401);
  if (res.status === 429) throw new ProtoError('Zu viele Versuche. Bitte später erneut probieren.', 429);
  throw new ProtoError(msg ?? `Serverfehler ${res.status}.`, res.status);
}
