// =====================================================
// public/sw.js — SpinSpring Express Service Worker
// Phase 2: Full offline caching with per-resource strategies
// =====================================================

const SW_VERSION = 'v2.0.0';
const PRECACHE = `spins-precache-${SW_VERSION}`;
const RUNTIME_HTML = `spins-html-${SW_VERSION}`;
const RUNTIME_API = `spins-api-${SW_VERSION}`;
const RUNTIME_STATIC = `spins-static-${SW_VERSION}`;
const ALL_CACHES = [PRECACHE, RUNTIME_HTML, RUNTIME_API, RUNTIME_STATIC];

// ── Assets to precache at install ──────────────────────
const PRECACHE_URLS = [
  '/offline.html',
  '/manifest.json',
  '/favicon.svg',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/css/spinspring.css',
  '/js/spinspring.js',
  '/js/pwa.js',
  'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// ── Cache size limits ──────────────────────────────────
const MAX_RUNTIME_HTML = 30;
const MAX_RUNTIME_API = 20;
const MAX_RUNTIME_STATIC = 60;

// ─────────────────────────────────────────────────────
// INSTALL — precache app shell
// ─────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing', SW_VERSION);
  event.waitUntil(
    caches.open(PRECACHE)
      .then((cache) => {
        // addAll fails if any single item fails — use individual adds with tolerance
        return Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch((err) =>
              console.warn('[SW] Precache failed for', url, err.message)
            )
          )
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ─────────────────────────────────────────────────────
// ACTIVATE — clean old caches
// ─────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating', SW_VERSION);
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith('spins-') && !ALL_CACHES.includes(name))
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ─────────────────────────────────────────────────────
// FETCH — route requests to the right strategy
// ─────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET
  if (request.method !== 'GET') return;

  // Skip non-http(s)
  if (!url.protocol.startsWith('http')) return;

  // Skip Chrome DevTools requests
  if (url.pathname.startsWith('/__') || url.hostname === 'localhost' && url.port === '9222') return;

  // ─── NEVER CACHE: private/dynamic endpoints ───────
  if (
    url.pathname.startsWith('/api/sync') ||
    url.pathname.startsWith('/api/machine') ||
    url.pathname.startsWith('/api/live-data') ||
    url.pathname.startsWith('/api/customer-orders') ||
    url.pathname.startsWith('/logout') ||
    url.pathname.startsWith('/attendant-logout') ||
    url.pathname.startsWith('/customer-logout') ||
    url.pathname.startsWith('/login') ||
    url.pathname.startsWith('/register') ||
    url.pathname.startsWith('/owner/') && request.headers.get('accept')?.includes('json')
  ) {
    return; // let browser handle it (no SW interception)
  }

  // ─── STALE-WHILE-REVALIDATE: public APIs ──────────
  if (url.pathname.startsWith('/api/pricing') ||
      url.pathname.startsWith('/api/public/') ||
      url.pathname.startsWith('/api/quote/')) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_API, MAX_RUNTIME_API));
    return;
  }

  // ─── CACHE-FIRST: static assets ────────────────────
  if (
    url.pathname.startsWith('/css/') ||
    url.pathname.startsWith('/js/') ||
    url.pathname.startsWith('/images/') ||
    url.pathname.startsWith('/fonts/') ||
    /\.(css|js|png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf|eot|ico)$/i.test(url.pathname) ||
    url.hostname === 'cdn.jsdelivr.net' ||
    url.hostname === 'cdnjs.cloudflare.com'
  ) {
    event.respondWith(cacheFirst(request, RUNTIME_STATIC, MAX_RUNTIME_STATIC));
    return;
  }

  // ─── NETWORK-FIRST: HTML pages ─────────────────────
  if (request.mode === 'navigate' ||
      (request.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(networkFirstHTML(request));
    return;
  }

  // Default: try network, fall back to cache
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// ─────────────────────────────────────────────────────
// STRATEGIES
// ─────────────────────────────────────────────────────

/**
 * Cache-first: serve cache if present, fetch+update in background.
 * Best for static assets that rarely change.
 */
async function cacheFirst(request, cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  if (cached) {
    // Update in background (don't await)
    fetch(request).then((response) => {
      if (response && response.status === 200) {
        cache.put(request, response.clone());
        trimCache(cacheName, maxItems);
      }
    }).catch(() => {});
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response && response.status === 200 && response.type !== 'opaque') {
      cache.put(request, response.clone());
      trimCache(cacheName, maxItems);
    }
    return response;
  } catch (err) {
    // Nothing cached, no network
    return new Response('Asset unavailable offline', { status: 503 });
  }
}

/**
 * Network-first for HTML: fresh when online, cached when offline.
 * Falls back to /offline.html for navigations.
 */
async function networkFirstHTML(request) {
  const cache = await caches.open(RUNTIME_HTML);

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      cache.put(request, response.clone());
      trimCache(RUNTIME_HTML, MAX_RUNTIME_HTML);
    }
    return response;
  } catch (err) {
    // Offline — try cache
    const cached = await cache.match(request);
    if (cached) return cached;

    // Try precache
    const pre = await caches.open(PRECACHE);
    const offline = await pre.match('/offline.html');
    if (offline) return offline;

    return new Response('Offline', { status: 503 });
  }
}

/**
 * Stale-while-revalidate: serve cached, refresh in background.
 * Best for public API data.
 */
async function staleWhileRevalidate(request, cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response && response.status === 200) {
      cache.put(request, response.clone());
      trimCache(cacheName, maxItems);
    }
    return response;
  }).catch(() => null);

  return cached || (await fetchPromise) || new Response('{}', {
    status: 503,
    headers: { 'Content-Type': 'application/json' }
  });
}

/**
 * Trim cache to N most recent entries (FIFO).
 */
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    const toDelete = keys.slice(0, keys.length - maxItems);
    await Promise.all(toDelete.map((k) => cache.delete(k)));
  }
}

// ─────────────────────────────────────────────────────
// MESSAGES from page (update flow)
// ─────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((names) =>
        Promise.all(names.map((n) => caches.delete(n)))
      )
    );
  }
});

// ─────────────────────────────────────────────────────
// PUSH (Phase 4 placeholder)
// ─────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  console.log('[SW] Push received (Phase 4 handles this)');
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
