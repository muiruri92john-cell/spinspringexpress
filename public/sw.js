// =====================================================
// public/sw.js — Service Worker
// Phase 1: install + minimal caching (offline comes in Phase 2)
// =====================================================

const CACHE_VERSION = 'spins-v1.0.0';
const CACHE_NAME = `spinshell-${CACHE_VERSION}`;

// Assets to pre-cache on install (app shell)
const PRECACHE_URLS = [
  '/offline.html',
  '/favicon.svg',
  '/icon-192x192.png',
  '/icon-512x512.png',
  '/manifest.json'
];

// ── Install: pre-cache app shell ──────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] Installing', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch((err) => console.error('[SW] Precache failed:', err))
  );
});

// ── Activate: clean old caches ─────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating', CACHE_VERSION);
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith('spinshell-') && name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: pass through (Phase 2 adds real caching) ────
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET
  if (request.method !== 'GET') return;

  // Skip non-http(s)
  if (!request.url.startsWith('http')) return;

  // Skip POST-y things (analytics, APIs with auth)
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/sync') ||
      url.pathname.startsWith('/api/machine') ||
      url.pathname.startsWith('/api/live-data')) {
    return;
  }

  // Phase 1: network-only for everything else
  // Phase 2 will add: cache-first for static, network-first for HTML, etc.
  event.respondWith(
    fetch(request).catch(() => {
      // If we can't reach network, only serve offline for navigations
      if (request.mode === 'navigate') {
        return caches.match('/offline.html');
      }
      // Otherwise let it fail (Phase 2 will add caching)
    })
  );
});

// ── Messages from page (for update flow) ───────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ── Push notifications (Phase 4) ───────────────────────
self.addEventListener('push', (event) => {
  console.log('[SW] Push received (Phase 4 will handle)');
  // Placeholder — Phase 4 fills this in
});

self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked');
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
