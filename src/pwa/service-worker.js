/* global self, caches */
const cachePrefix = 'tooku-shell-';
const cacheName = `${cachePrefix}__TOOKU_CACHE_VERSION__`;
const shellUrl = '/';
const precacheUrls = __TOOKU_PRECACHE__; // eslint-disable-line no-undef

// Only immutable build assets and public brand images may enter the app-shell cache.
// API, music, artwork, lyrics, sessions and account data are deliberately excluded.
const cacheableStaticPath = (pathname) => pathname.startsWith('/assets/') || pathname === '/tooku.svg' || pathname === '/navidrome.svg';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll([new Request(shellUrl, { cache: 'reload' }), ...precacheUrls])));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(cachePrefix) && key !== cacheName).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting();
  if (event.data === 'CLEAR_TOOKU_CACHES') event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(cachePrefix)).map((key) => caches.delete(key)))));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(async (response) => {
      if (response.ok) { const cache = await caches.open(cacheName); await cache.put(shellUrl, response.clone()); }
      return response;
    }).catch(async () => (await caches.open(cacheName)).match(shellUrl).then((response) => response ?? Response.error())));
    return;
  }
  if (!cacheableStaticPath(url.pathname)) return;
  event.respondWith(caches.open(cacheName).then(async (cache) => {
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
    return response;
  }));
});
