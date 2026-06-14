/* ElectroPro Manager — Service Worker v1.2
   Update flow: new SW installs and waits. The app shows an
   "Update Available" banner; tapping Reload sends SKIP_WAITING,
   which activates the new SW and the page reloads itself.

   Offline strategy:
   - On install, cache the app shell (index.html and ./).
     Each resource is cached individually so one failure doesn't
     break the whole install.
   - For navigation requests (opening/reloading the app), try the
     network first; if offline, serve the cached index.html.
   - For everything else, cache-first with background refresh. */

const CACHE = 'electropro-v3';
const SHELL = ['./', './index.html'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all(SHELL.map(url =>
        fetch(url, { cache: 'reload' })
          .then(res => { if (res.ok) return cache.put(url, res.clone()); })
          .catch(() => {}) // never let one missing asset block install
      ))
    )
    // No self.skipWaiting() here on purpose — lets the app control
    // when an update is applied via the Reload button. On a first
    // ever install (no existing controller) the browser activates
    // this worker immediately regardless.
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (!req.url.startsWith('http')) return;

  // Google Sheets sync: network-first, fallback to empty JSON when offline
  if (req.url.includes('script.google.com')) {
    e.respondWith(
      fetch(req).catch(() =>
        new Response('{"ok":false,"items":[]}', { headers: { 'Content-Type': 'application/json' } })
      )
    );
    return;
  }

  // Page navigations (opening / reloading the app): network first,
  // fall back to cached app shell when offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() =>
        caches.match('./index.html').then(c => c || caches.match('./'))
      )
    );
    return;
  }

  // Everything else: cache-first, refresh in background
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req).then(cached => {
        const live = fetch(req).then(res => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || live;
      })
    )
  );
});
