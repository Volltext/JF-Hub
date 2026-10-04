/* JF Hub – Service Worker (nur im Web-Build). Das Build-Skript (vite.config.ts) ersetzt die beiden Platzhalter und legt die Datei als /sw.js ab. */
'use strict';

const VERSION = '__BUILD_VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `jfhub-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('jfhub-') && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Fremde Adressen, die API und die Admin-Oberfläche gehen immer direkt ans Netz.
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return;

  if (req.mode === 'navigate') {
    // Online immer die aktuelle Startseite, offline die gemerkte.
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }
  // Dateien tragen einen Hash im Namen: aus dem Zwischenspeicher, sonst holen und merken.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            void caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

// ---------- Push ----------
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'JF Hub', {
      body: data.body || '',
      tag: data.tag,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        await client.focus();
        try {
          await client.navigate(url);
        } catch {
          /* navigate ist nicht überall erlaubt: dann bleibt die App an ihrer Stelle */
        }
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
