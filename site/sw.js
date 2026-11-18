// Service worker: lets the guest camera open with no signal. Only caches this site's own
// files; never touches API calls or Google Drive requests.
const VERSION = 'ps-v5';
const SHELL = [
  './', 'index.html', 'cam.html', 'album.html', 'tv.html', 'config.js', 'manifest.webmanifest',
  'assets/css/app.css', 'assets/img/icon.svg',
  'assets/js/util.js', 'assets/js/api.js', 'assets/js/cam.js', 'assets/js/film.js', 'assets/js/film-worker.js', 'assets/js/queue.js',
  'assets/js/album.js', 'assets/js/tv.js', 'assets/js/home.js', 'assets/js/guestbook.js', 'assets/js/crypto.js', 'assets/vendor/qrcode.mjs',
  'assets/vendor/fonts/bricolage-grotesque-latin-700-normal.woff2', 'assets/vendor/fonts/bricolage-grotesque-latin-800-normal.woff2',
  'assets/vendor/fonts/atkinson-hyperlegible-latin-400-normal.woff2', 'assets/vendor/fonts/atkinson-hyperlegible-latin-700-normal.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // API + Drive go straight to network
  if (req.mode === 'navigate' || url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) {
    // network first so updates arrive; fall back to cache offline
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' })));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
