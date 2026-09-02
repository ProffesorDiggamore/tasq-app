/**
 * Tasq service worker.
 *
 * Two jobs: keep the app shell openable when the shop internet drops, and
 * receive Web Push. It deliberately does not try to cache board data — a stale
 * task list is worse than an honest "you're offline", because someone would act
 * on work that is already done.
 *
 * Bump CACHE when the offline page or the precache list changes; hashed Next
 * assets never need it.
 */
const CACHE = 'tasq-v2';
const OFFLINE_URL = '/offline';
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png'];
/**
 * Runtime cap. Hashed chunks are immutable but not eternal: every deploy
 * mints new URLs, and without a cap the cache grows one build at a time
 * forever. `caches.keys()`/`cache.keys()` list entries in insertion order,
 * so evicting from the front is a FIFO cache — the oldest chunk is the one
 * no current page references.
 */
const RUNTIME_MAX_ENTRIES = 60;

/** Keep the runtime cache bounded: drop the oldest entries past the cap. */
async function trimCache() {
  const cache = await caches.open(CACHE);
  const keys = await cache.keys();
  const excess = keys.length - RUNTIME_MAX_ENTRIES;
  if (excess <= 0) return;
  // Precache entries were inserted first, so a plain FIFO would evict the
  // offline page and icons the moment runtime chunks fill the cap — exactly
  // the assets the cache exists to protect. Never evict those. The cap counts
  // TOTAL entries: the old logic also required the evictable count alone to
  // pass the cap, which let the cache drift to RUNTIME_MAX_ENTRIES plus every
  // precache entry before trimming kicked in.
  const precache = new Set(PRECACHE.map((url) => new URL(url, self.location.origin).href));
  const evictable = keys.filter((key) => !precache.has(key.href));
  for (const key of evictable.slice(0, Math.min(excess, evictable.length))) {
    await cache.delete(key);
  }
}

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
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Hashed build assets and icons never change under a given URL.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).then(trimCache);
            return response;
          }),
      ),
    );
    return;
  }

  // Pages always try the network first — the board must never show stale work.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL).then((hit) => hit ?? new Response('Offline', { status: 503 })),
      ),
    );
  }
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Tasq', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Tasq';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      // Tag collapses repeats of the same subject instead of stacking them.
      tag: payload.tag || undefined,
      renotify: Boolean(payload.tag),
      data: { url: payload.url || '/' },
      requireInteraction: Boolean(payload.urgent),
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Reuse an open board rather than piling up windows.
      for (const client of clients) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
