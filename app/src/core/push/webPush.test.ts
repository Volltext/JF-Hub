import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/core/db/db';

const calls: { method: string; path: string; body?: unknown }[] = [];
vi.mock('@/core/env', () => ({ IS_WEB: true }));
vi.mock('@/features/protokolle/http', () => ({
  loadConn: async () => ({ url: 'https://hub.example', token: 'cookie' }),
  request: async (_c: unknown, method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    return path === '/api/push/key' ? { publicKey: 'BAUDAUDAUDA' } : { ok: true };
  },
}));

const KEY_BYTES = 'BAUDAUDAUDA';

function installBrowser(opts: { permission?: NotificationPermission; secure?: boolean; ua?: string } = {}) {
  const sub = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
    options: { applicationServerKey: null as ArrayBuffer | null },
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn(async () => true),
  };
  let current: typeof sub | null = null;
  const subscribe = vi.fn(async () => (current = sub));
  const reg = { pushManager: { getSubscription: async () => current, subscribe } };
  const notification = {
    permission: opts.permission ?? 'default',
    requestPermission: vi.fn(async () => {
      notification.permission = 'granted';
      return 'granted' as const;
    }),
  };
  vi.stubGlobal('window', { isSecureContext: opts.secure ?? true, PushManager: {}, Notification: notification, matchMedia: () => ({ matches: false }), innerWidth: 1000 });
  vi.stubGlobal('Notification', notification);
  vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(reg), getRegistration: async () => ({ ...reg, active: {} }) }, userAgent: opts.ua ?? 'Mozilla/5.0 (Linux; Android 14) Chrome', platform: 'Linux', maxTouchPoints: 5 });
  return { sub, subscribe, notification };
}

beforeEach(async () => {
  calls.length = 0;
  await db.kv.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('Web-Push im Browser', () => {
  it('meldet das Gerät am Server an: Erlaubnis, Schlüssel, Abo, Speichern', async () => {
    const b = installBrowser();
    const { enablePush, pushEnabled } = await import('./webPush');
    expect(await pushEnabled()).toBe(false);
    expect(await enablePush()).toBe(true);
    expect(b.notification.requestPermission).toHaveBeenCalled();
    expect(b.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    const args = (b.subscribe.mock.calls[0] as unknown as [{ applicationServerKey: Uint8Array }])[0];
    expect(args.applicationServerKey).toBeInstanceOf(Uint8Array);
    expect(args.applicationServerKey.length).toBe(Math.floor((KEY_BYTES.length * 6) / 8));
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /api/push/key', 'POST /api/push/subscribe']);
    expect((calls[1]!.body as { subscription: { endpoint: string } }).subscription.endpoint).toContain('fcm.googleapis.com');
    expect((await db.kv.get('push.endpoint'))?.value).toContain('fcm.googleapis.com');
    expect(await pushEnabled()).toBe(true);
  });

  it('schickt dem Server die Erinnerungen mit Ziel-Adresse je Art, aber nur für angemeldete Geräte', async () => {
    const b = installBrowser();
    const { enablePush, syncWebReminders } = await import('./webPush');
    const at = new Date('2026-10-05T17:25:00Z');
    await syncWebReminders([{ id: 7, title: 'Dienst gleich', body: 'Montag', at }], 'service');
    expect(calls).toHaveLength(0); // noch nicht angemeldet: nichts gesendet

    await enablePush();
    calls.length = 0;
    await syncWebReminders([{ id: 7, title: 'Dienst gleich', body: 'Montag', at }], 'service');
    await syncWebReminders([], 'task');
    expect(calls[0]).toMatchObject({
      method: 'PUT',
      path: '/api/push/reminders',
      body: { endpoint: b.sub.endpoint, kind: 'service', reminders: [{ key: '7', at: at.getTime(), title: 'Dienst gleich', body: 'Montag', url: '/#/dienste?neu=1' }] },
    });
    expect(calls[1]).toMatchObject({ body: { kind: 'task', reminders: [] } }); // leere Liste löscht die alten Erinnerungen
  });

  it('abmelden entfernt Abo und Server-Eintrag', async () => {
    const b = installBrowser();
    const { enablePush, removePushSubscription } = await import('./webPush');
    await enablePush();
    calls.length = 0;
    await removePushSubscription();
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/push/unsubscribe', body: { endpoint: b.sub.endpoint } });
    expect(b.sub.unsubscribe).toHaveBeenCalled();
    expect(await db.kv.get('push.endpoint')).toBeUndefined();
  });

  it('erklärt, warum Push nicht geht: http, iPhone ohne Installation, blockiert', async () => {
    let m = await import('./webPush');
    installBrowser({ secure: false });
    expect(m.pushUnavailableReason()).toMatch(/https/);
    expect(await m.enablePush()).toBe(false);

    installBrowser({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    expect(m.pushUnavailableReason()).toMatch(/Home-Bildschirm/);

    installBrowser({ permission: 'denied' });
    m = await import('./webPush');
    expect(m.pushUnavailableReason()).toMatch(/blockiert/);

    installBrowser();
    expect(m.pushUnavailableReason()).toBeNull();
  });

  it('hängt nicht, wenn gar kein Service Worker registriert ist (Abmelden muss immer klappen)', async () => {
    installBrowser();
    // Ohne Registrierung wird `ready` nie erfüllt.
    vi.stubGlobal('navigator', { serviceWorker: { ready: new Promise(() => undefined), getRegistration: async () => undefined }, userAgent: 'Mozilla/5.0 (Linux; Android 14)', platform: 'Linux', maxTouchPoints: 5 });
    vi.useFakeTimers();
    try {
      const { currentSubscription, removePushSubscription, enablePush } = await import('./webPush');
      const pending = Promise.all([currentSubscription(), removePushSubscription()]);
      await vi.advanceTimersByTimeAsync(5000);
      expect(await pending).toEqual([null, undefined]);
      const enabling = enablePush();
      const failure = expect(enabling).rejects.toThrow(/Service Worker/);
      await vi.advanceTimersByTimeAsync(5000);
      await failure;
    } finally {
      vi.useRealTimers();
    }
  });
});
