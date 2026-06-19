/* ============================================================
   SERVICE WORKER — Damage Measurement Tool
   ============================================================
   Strategy: Cache-First with network fallback.

   - Small essential files are pre-cached on install.
   - Large files (opencv.js, heic2any) are cached on first
     request, not on install, to keep installation fast.
   - To force all users to get a fresh version after an update,
     increment CACHE_VERSION below (e.g. 'v1' -> 'v2').
   ============================================================ */

const CACHE_VERSION = 'v2';
const CACHE_NAME    = `dmt-cache-${CACHE_VERSION}`;

/* Files to cache immediately on install.
   opencv.js (~10 MB), heic2any (~1 MB), and the ONNX runtime
   files (ort-wasm-simd.wasm ~10 MB, ort-wasm.wasm ~9.5 MB,
   best.onnx ~11.9 MB) are intentionally excluded here: they
   will be cached on first use instead, so installation stays
   fast and does not require ~32 MB of upfront download. */
const PRE_CACHE_URLS = [
  './',
  './app.js',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './templates/inspection_report.docx'
];


/* INSTALL
   Pre-cache the small essential files. */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRE_CACHE_URLS))
      .then(() => self.skipWaiting())
  );
});


/* ACTIVATE
   Delete any caches from previous versions so stale files
   don't accumulate on the user's device. */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});


/* FETCH
   Cache-First: serve from cache if available, otherwise fetch
   from network and cache the response for next time.
   Only applies to GET requests on our own origin. */
self.addEventListener('fetch', (event) => {
  /* Ignore non-GET requests (POST etc.) and cross-origin
     requests (analytics, fonts from other domains, etc.) */
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request)
      .then((cached) => {
        if (cached) return cached;

        /* Not in cache: fetch from network, cache the response,
           and return it. We clone the response because a Response
           body can only be read once — one copy goes to the cache,
           one goes to the browser. */
        return fetch(event.request)
          .then((networkResponse) => {
            /* Only cache valid responses (status 200, basic type).
               Don't cache errors or opaque cross-origin responses. */
            if (
              !networkResponse ||
              networkResponse.status !== 200 ||
              networkResponse.type !== 'basic'
            ) {
              return networkResponse;
            }

            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(event.request, responseToCache));

            return networkResponse;
          });
      })
  );
});
