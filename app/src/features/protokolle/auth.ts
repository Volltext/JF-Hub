import { Capacitor } from '@capacitor/core';
import { loadAccount, saveAccount, type Account } from '@/core/account/account';
import { wipeLocalData } from '@/core/db/wipe';
import { saveSettings } from '@/core/settings/settings';
import { secure } from '@/core/native/secure';
import { IS_WEB } from '@/core/env';
import { COOKIE_SESSION, PROTO_TOKEN_KEY, ProtoError, loadConn, request } from './http';
import { normalizeServerUrl } from './serverUrl';
import { syncNow } from './sync';
import { useSyncStatus } from './syncStatus';
import { removePushSubscription } from '@/core/push/webPush';

function deviceName(): string {
  if (Capacitor.isNativePlatform()) return 'JF-Hub-App (Android)';
  const ua = navigator.userAgent;
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : 'Browser';
  return `Web (${os})`;
}

interface SessionResponse {
  token: string;
  user: Account;
}

/** Adresse des Servers: im Browser der eigene Ursprung, in der App die eingegebene (geprüfte) Adresse. */
function serverUrl(urlInput: string): string {
  if (IS_WEB) return location.origin;
  const check = normalizeServerUrl(urlInput);
  if (!check.ok) throw new ProtoError(check.error);
  return check.url;
}

/** Übernimmt eine Server-Antwort mit Sitzung. Wechselt das Konto, werden die Daten des vorigen Kontos von diesem Gerät entfernt. */
async function startSession(url: string, res: SessionResponse): Promise<Account> {
  const previous = await loadAccount();
  if (previous && previous.id !== res.user.id) await wipeLocalData();
  await secure.set(PROTO_TOKEN_KEY, IS_WEB ? COOKIE_SESSION : res.token);
  await saveAccount(res.user);
  if (!IS_WEB) await saveSettings({ protocolServerUrl: url });
  useSyncStatus.getState().set({ state: 'idle', message: '' });
  return res.user;
}

/** Meldet mit Benutzername und Passwort am Server an. */
export async function login(urlInput: string, username: string, password: string): Promise<Account> {
  const url = serverUrl(urlInput);
  const res = await request<SessionResponse>({ url, token: null }, 'POST', '/api/login', { username: username.trim(), password, device: deviceName() });
  return startSession(url, res);
}

/** Löst eine Einladung ein: vergibt das eigene Passwort und meldet gleich an. */
export async function acceptInvite(urlInput: string, username: string, code: string, password: string): Promise<Account> {
  const url = serverUrl(urlInput);
  const res = await request<SessionResponse>({ url, token: null }, 'POST', '/api/invite/accept', { username: username.trim(), code: code.trim(), password, device: deviceName() });
  return startSession(url, res);
}

/**
 * Meldet ab und entfernt alle abgeglichenen Daten von diesem Gerät (sie liegen auf dem Server).
 * Vorher wird ein letzter Abgleich versucht; den Hinweis auf Nicht-Gesendetes zeigt die Oberfläche vorher.
 */
export async function logout(): Promise<void> {
  await syncNow().catch(() => undefined);
  const conn = await loadConn();
  // Push-Abmeldung ist nur ein Aufräumen: sie darf das Abmelden nie aufhalten.
  await Promise.race([removePushSubscription().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 6000))]);
  if (conn.token) await request(conn, 'POST', '/api/logout').catch(() => undefined);
  await secure.remove(PROTO_TOKEN_KEY);
  await wipeLocalData();
  useSyncStatus.getState().set({ state: 'off', message: '' });
}

export async function isLoggedIn(): Promise<boolean> {
  const conn = await loadConn();
  return !!conn.url && !!conn.token;
}

/** Fragt den Server nach dem Konto (Rolle, Name) und merkt es sich. Offline bleibt der gemerkte Stand. */
export async function refreshAccount(): Promise<Account | null> {
  const conn = await loadConn();
  if (!conn.url || !conn.token) return null;
  try {
    const res = await request<{ user: Account }>(conn, 'GET', '/api/me');
    await saveAccount(res.user);
    return res.user;
  } catch (e) {
    if (e instanceof ProtoError && e.status === 401) useSyncStatus.getState().set({ state: 'auth', message: e.message });
    return loadAccount();
  }
}

export async function changePassword(current: string, next: string): Promise<void> {
  const conn = await loadConn();
  await request(conn, 'POST', '/api/account/password', { current, next });
}

export interface DeviceInfo {
  id: string;
  device: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  current: boolean;
}

export async function listDevices(): Promise<DeviceInfo[]> {
  return request<DeviceInfo[]>(await loadConn(), 'GET', '/api/account/sessions');
}

export async function revokeDevice(id: string): Promise<void> {
  await request(await loadConn(), 'DELETE', `/api/account/sessions/${encodeURIComponent(id)}`);
}

export async function revokeOtherDevices(): Promise<void> {
  await request(await loadConn(), 'POST', '/api/account/sessions/revoke-others');
}
