import { useEffect, useSyncExternalStore } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { loadConn, request } from '@/features/protokolle/http';
import { APP_VERSION, compareVersions } from './release';

/**
 * Update-Hinweis der Android-App: Sie fragt ihren Server nach seiner Version (`/api/status`, ohne Anmeldung) und meldet, wenn er
 * neuer ist als die installierte APK. Server und App kommen aus demselben Release, eine neuere Server-Version heißt also: Es gibt
 * eine passende neue APK. Die PWA braucht das nicht, sie kommt immer frisch vom Server.
 */

const CACHE_KEY = 'jfh.serverVersion';
const DISMISS_KEY = 'jfh.update.dismissed';
/** So oft wird höchstens nachgefragt (die Startseite wird oft geöffnet). */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

interface Cached {
  version: string;
  at: number;
}

const listeners = new Set<() => void>();
let state: { server: string | null; dismissed: string | null } = { server: null, dismissed: null };
let loaded = false;
let checking: Promise<void> | null = null;

function storage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function store(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* privates Fenster: dann eben ohne Merker */
  }
}

function set(next: Partial<typeof state>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}

function load(): void {
  if (loaded) return;
  loaded = true;
  state = { server: storage<Cached>(CACHE_KEY)?.version ?? null, dismissed: storage<string>(DISMISS_KEY) };
}

/** Fragt den Server nach seiner Version, höchstens alle sechs Stunden (mit `force` sofort). Ohne Netz bleibt der letzte Stand. */
export function checkServerVersion(force = false): Promise<void> {
  load();
  const cached = storage<Cached>(CACHE_KEY);
  if (!force && cached && Date.now() - cached.at < CHECK_EVERY_MS) return Promise.resolve();
  checking ??= (async () => {
    try {
      const conn = await loadConn();
      if (!conn.url) return;
      const { version } = await request<{ version?: unknown }>(conn, 'GET', '/api/status', undefined, false, { timeoutMs: 15_000 });
      if (typeof version !== 'string') return;
      store(CACHE_KEY, { version, at: Date.now() } satisfies Cached);
      set({ server: version });
    } catch {
      /* kein Netz oder kein Server: beim nächsten Mal */
    } finally {
      checking = null;
    }
  })();
  return checking;
}

export interface AppUpdate {
  /** Version des Servers, soweit bekannt. */
  server: string | null;
  /** Neuere Version als die installierte (nur in der Android-App). */
  available: string | null;
  /** Der Hinweis auf „Heute“ wurde für diese Version weggeklickt. */
  dismissed: boolean;
  dismiss: () => void;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => {
  load();
  return state;
};

export function useAppUpdate(): AppUpdate {
  const native = Capacitor.isNativePlatform();
  const s = useSyncExternalStore(subscribe, snapshot, snapshot);

  useEffect(() => {
    if (!native) return;
    void checkServerVersion();
    // Beim Zurückkehren in die App erneut (gedrosselt) nachfragen: Ein Update des Servers soll nicht erst nach Tagen auffallen.
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => isActive && void checkServerVersion());
    return () => void sub.then((h) => h.remove());
  }, [native]);

  const newer = native && s.server && (compareVersions(s.server, APP_VERSION) ?? 0) > 0 ? s.server : null;
  return {
    server: s.server,
    available: newer,
    dismissed: !!newer && s.dismissed === newer,
    dismiss: () => {
      if (!newer) return;
      store(DISMISS_KEY, newer);
      set({ dismissed: newer });
    },
  };
}
