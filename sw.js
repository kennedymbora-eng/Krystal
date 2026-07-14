/* ElectroPro Manager — Service Worker v1.4
   Key fix over v1.3: Firebase SDK scripts are now cached during
   install so the app works fully offline after first load.
   Previously they were excluded from caching, causing
   "firebase is not defined" errors when offline. */

const CACHE = 'electropro-v5';

// App shell — the two HTML entry points
const SHELL = ['./', './index.html'];

// Firebase SDK scripts from Google CDN — cached during install
// so they're available offline after the first visit.
const FIREBASE_SCRIPTS = [
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all([
        // Cache app shell
        ...SHELL.map(url =>
          fetch(url, { cache: 'reload' })
            .then(res => { if (res.ok) cache.put(url, res.clone()); })
            .catch(() => {})
        ),
        // Cache Firebase SDK scripts
        // These are versioned CDN URLs so they never change content —
        // safe to cache indefinitely.
        ...FIREBASE_SCRIPTS.map(url =>
          fetch(url)
            .then(res => { if (res.ok) cache.put(url, res.clone()); })
            .catch(() => {}) // silently skip if no internet on install
        ),
      ])
    )
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (!req.url.startsWith('http')) return;

  // Google Sheets sync — network only, no cache
  if (req.url.includes('script.google.com')) {
    e.respondWith(
      fetch(req).catch(() =>
        new Response('{"ok":false,"items":[]}', {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Firebase SDK scripts — cache-first (they're versioned, never change)
  if (req.url.includes('gstatic.com/firebasejs') ||
      (req.url.includes('firebase') && req.url.includes('compat'))) {
    e.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          if (res.ok) {
            caches.open(CACHE).then(c => c.put(req, res.clone()));
          }
          return res;
        });
      })
    );
    return;
  }

  // Firebase Auth/Firestore API calls — network only, never cache
  if (req.url.includes('firebaseapp.com') ||
      req.url.includes('googleapis.com') ||
      req.url.includes('firestore.googleapis.com') ||
      req.url.includes('identitytoolkit')) {
    e.respondWith(fetch(req).catch(() =>
      new Response('', { status: 503, statusText: 'Offline' })
    ));
    return;
  }

  // Page navigations — network first, fall back to cached shell
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => {
            c.put('./index.html', copy);
            c.put('./', res.clone());
          });
        }
        return res;
      }).catch(() =>
        caches.match('./index.html').then(c => c || caches.match('./'))
      )
    );
    return;
  }

  // Everything else — cache first, refresh in background
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req).then(cached => {
        const live = fetch(req)
          .then(res => { if (res.ok) cache.put(req, res.clone()); return res; })
          .catch(() => cached);
        return cached || live;
      })
    )
  );
});
