/* Door scanner service worker.
 *
 * The shell is precached on install and served cache-first. A venue with no
 * signal is the normal case, not the exception, so the network is only ever
 * an opportunistic refresh.
 *
 * Bump CACHE when any shell file changes; the old cache is dropped on
 * activate so a door device never runs a half-updated mix of files. */

const CACHE = 'nonsense-door-v2';

const SHELL = [
  './',
  './index.html',
  './scanner-app.js',
  './qr-decoder.js',
  './vendor/jsQR.js',
  './app.webmanifest',
  '../ticket-payload.js',
  '../ticket-manifest.js',
  '../scanner-core.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        /* Refresh in the background, but never block the door on it. */
        event.waitUntil(
          fetch(request)
            .then((response) => {
              if (response && response.ok) return caches.open(CACHE).then((cache) => cache.put(request, response));
              return undefined;
            })
            .catch(() => undefined)
        );
        return cached;
      }
      return fetch(request).catch(() => caches.match('./index.html'));
    })
  );
});
