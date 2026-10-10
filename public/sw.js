// Offline support for a fully client-side tool site.
//
// No precache manifest: every build's _astro/* filenames are content-hashed
// and unknowable ahead of time, so this caches as the user actually visits
// pages rather than trying to guess a file list (see the cache-first and
// network-first handlers below). That also means the first visit to any
// page is what seeds its offline copy — there is no warm-up step.
//
// Never touches worker/counter.js's API paths (/pv, /feedback, /u, /ev,
// /health.json): those are telemetry and usage-counter writes, which must
// always reach the network and must never be served from a cache.
const VERSION = 'v1';
const RUNTIME_CACHE = `toolkist-runtime-${VERSION}`;

const API_PATHS = new Set(['/pv', '/feedback', '/u', '/ev', '/health.json']);

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('toolkist-') && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (API_PATHS.has(url.pathname)) return;

  // Immutable, content-hashed build output: safe to serve from cache
  // instantly, with a background refetch to keep the cache current for the
  // next visit. A hash change means a new URL, never a changed response at
  // the same URL, so staleness here is not a correctness risk.
  if (url.pathname.startsWith('/_astro/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Pages: network-first, so a tool's injected usage-count script and any
  // content update are seen whenever the network is actually up. Falls back
  // to the last cached copy only when offline.
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Everything else same-origin (CSS, fonts, non-hashed scripts): cache as a
  // fallback without the staleness tradeoff cache-first would have on
  // mutable URLs — network wins when reachable, cache covers offline.
  event.respondWith(networkFirst(request));
});

async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    refetchInBackground(cache, request);
    return cached;
  }
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

function refetchInBackground(cache, request) {
  fetch(request)
    .then((response) => { if (response.ok) cache.put(request, response.clone()); })
    .catch(() => { /* offline — the cached copy already served */ });
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error('offline and not cached');
  }
}
