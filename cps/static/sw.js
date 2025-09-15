/* Basic Service Worker for Calibre-Web
 * Note: Service workers require a secure context (HTTPS) or localhost.
 */
const CACHE_NAME = 'calibre-web-v2';
const OFFLINE_URL = '/static/offline.html';
const CORE_ASSETS = [
  '/',
  OFFLINE_URL,
  '/static/css/style.css',
  '/static/css/upload.css',
  '/static/css/caliBlur.css',
  '/static/css/caliBlur_override.css',
  '/static/js/main.js',
  '/static/site.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)).catch(() => Promise.resolve())
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // Only cache GET requests
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Handle navigation requests (documents) with network-first, offline fallback
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        return res;
      }).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        const offline = await cache.match(OFFLINE_URL);
        return offline || Response.error();
      })
    );
    return;
  }
  // Static assets: cache-first, then network
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      try {
        if (url.origin === location.origin && url.pathname.startsWith('/static/')) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        }
      } catch (e) {}
      return res;
    }))
  );
});
