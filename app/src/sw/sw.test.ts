import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

/**
 * Der Service Worker läuft in keinem Test-Browser; hier wird sein Quelltext in einer nachgebauten Umgebung ausgeführt
 * (self, caches, fetch), um die Regeln zu prüfen: was vorgeladen wird, was am Netz vorbeigeht, wie Push und Antippen wirken.
 */
type Handler = (event: Record<string, unknown>) => void;

function load(opts: { online?: boolean } = {}) {
  const online = opts.online ?? true;
  const handlers: Record<string, Handler> = {};
  const store = new Map<string, Map<string, unknown>>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  const focused: number[] = [];
  let windows: { focus(): Promise<void>; navigate(url: string): Promise<void> }[] = [];

  const cacheFor = (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name)!;
    return {
      addAll: async (urls: string[]) => urls.forEach((u) => m.set(u, `precached:${u}`)),
      put: async (req: { url: string }, res: unknown) => void m.set(new URL(req.url).pathname, res),
    };
  };
  const caches = {
    open: async (name: string) => cacheFor(name),
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    match: async (req: string | { url: string }) => {
      const key = typeof req === 'string' ? req : new URL(req.url).pathname;
      for (const m of store.values()) if (m.has(key)) return m.get(key);
      return undefined;
    },
  };
  const fetchMock = vi.fn(async (req: { url: string }) => {
    if (!online) throw new TypeError('offline');
    return { ok: true, clone: () => ({ cloned: req.url }), body: `net:${new URL(req.url).pathname}` };
  });
  const self = {
    location: { origin: 'https://hub.example' },
    addEventListener: (type: string, fn: Handler) => void (handlers[type] = fn),
    skipWaiting: vi.fn(async () => undefined),
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: async () => windows,
      openWindow: async (url: string) => void opened.push(url),
    },
    registration: { showNotification: async (title: string, options: Record<string, unknown>) => void shown.push({ title, options }) },
  };

  const src = readFileSync(new URL('./sw.template.js', import.meta.url), 'utf8')
    .replace('__BUILD_VERSION__', 'test')
    .replace('__PRECACHE__', JSON.stringify(['/', '/index.html', '/assets/app-abc.js']));
  new Function('self', 'caches', 'fetch', 'URL', src)(self, caches, fetchMock, URL);

  const fire = async (type: string, event: Record<string, unknown>) => {
    let pending: Promise<unknown> | undefined;
    handlers[type]!({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p), respondWith: (p: Promise<unknown>) => (pending = Promise.resolve(p)) });
    return pending ? await pending : undefined;
  };
  return {
    self,
    store,
    shown,
    opened,
    navigated,
    focused,
    fetchMock,
    fire,
    setWindows: (n: number) => {
      windows = Array.from({ length: n }, (_, i) => ({ focus: async () => void focused.push(i), navigate: async (u: string) => void navigated.push(u) }));
    },
    request: (path: string, over: Record<string, unknown> = {}) => ({ method: 'GET', mode: 'cors', url: `https://hub.example${path}`, ...over }),
    handlers,
  };
}

describe('Service Worker', () => {
  it('lädt beim Installieren die App-Dateien vor und übernimmt sofort', async () => {
    const sw = load();
    await sw.fire('install', {});
    expect([...sw.store.get('jfhub-test')!.keys()]).toEqual(['/', '/index.html', '/assets/app-abc.js']);
    expect(sw.self.skipWaiting).toHaveBeenCalled();
  });

  it('räumt beim Aktivieren alte Zwischenspeicher weg und fremde nicht an', async () => {
    const sw = load();
    sw.store.set('jfhub-alt', new Map());
    sw.store.set('anderes', new Map());
    sw.store.set('jfhub-test', new Map());
    await sw.fire('activate', {});
    expect([...sw.store.keys()].sort()).toEqual(['anderes', 'jfhub-test']);
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });

  it('lässt API, Admin-Oberfläche, Fremdadressen und Schreibzugriffe am Zwischenspeicher vorbei', async () => {
    const sw = load();
    for (const req of [
      sw.request('/api/sync'),
      sw.request('/admin/'),
      { ...sw.request('/x'), url: 'https://anders.example/x' },
      sw.request('/api/sync', { method: 'POST' }),
    ]) {
      const respond = vi.fn();
      sw.handlers.fetch!({ request: req, respondWith: respond });
      expect(respond).not.toHaveBeenCalled();
    }
  });

  it('Seitenaufruf: online frisch vom Server, offline die gemerkte Startseite', async () => {
    const online = load();
    await online.fire('install', {});
    expect(await online.fire('fetch', { request: online.request('/', { mode: 'navigate' }) })).toMatchObject({ body: 'net:/' });

    const offline = load({ online: false });
    await offline.fire('install', {});
    expect(await offline.fire('fetch', { request: offline.request('/', { mode: 'navigate' }) })).toBe('precached:/index.html');
  });

  it('Dateien: aus dem Zwischenspeicher, sonst holen und merken', async () => {
    const sw = load();
    await sw.fire('install', {});
    expect(await sw.fire('fetch', { request: sw.request('/assets/app-abc.js') })).toBe('precached:/assets/app-abc.js');
    expect(sw.fetchMock).not.toHaveBeenCalled();
    await sw.fire('fetch', { request: sw.request('/assets/neu-1.js') });
    expect(sw.fetchMock).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(sw.store.get('jfhub-test')!.has('/assets/neu-1.js')).toBe(true);
  });

  it('Push zeigt eine Benachrichtigung mit Ziel-Adresse', async () => {
    const sw = load();
    await sw.fire('push', { data: { json: () => ({ title: 'Dienst gleich', body: 'Montag, 17:30 Uhr', url: '/#/dienste?neu=1', tag: 'service:1' }) } });
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0]).toMatchObject({ title: 'Dienst gleich', options: { body: 'Montag, 17:30 Uhr', tag: 'service:1', data: { url: '/#/dienste?neu=1' } } });
  });

  it('Push ohne verwertbare Daten zeigt trotzdem etwas Sinnvolles', async () => {
    const sw = load();
    await sw.fire('push', { data: { json: () => { throw new Error('kein JSON'); }, text: () => 'Hallo' } });
    expect(sw.shown[0]).toMatchObject({ title: 'JF Hub', options: { body: 'Hallo' } });
  });

  it('Antippen: öffnet die offene App an der Stelle, sonst ein neues Fenster', async () => {
    const sw = load();
    const close = vi.fn();
    sw.setWindows(1);
    await sw.fire('notificationclick', { notification: { close, data: { url: '/#/aufgaben' } } });
    expect(close).toHaveBeenCalled();
    expect(sw.focused).toEqual([0]);
    expect(sw.navigated).toEqual(['/#/aufgaben']);
    expect(sw.opened).toEqual([]);

    sw.setWindows(0);
    await sw.fire('notificationclick', { notification: { close, data: { url: '/#/dienste?neu=1' } } });
    expect(sw.opened).toEqual(['/#/dienste?neu=1']);
  });
});
