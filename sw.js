// Работа без интернета: все файлы приложения хранятся в кэше телефона.
// При изменении любого файла увеличить VERSION — тогда телефон предложит обновиться.
const VERSION = 'koshelek-v17';
const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'js/app.js', 'js/db.js', 'js/util.js', 'js/catalog.js', 'js/categorize.js', 'js/importers.js', 'js/report.js', 'js/salary.js',
  'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs', 'vendor/xlsx.full.min.js',
  'fonts/manrope-cyrillic.woff2', 'fonts/manrope-latin.woff2',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' — брать свежие файлы с сервера, а не из кэша браузера.
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data === 'skip') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try { return await fetch(req); }
    catch {
      if (req.mode === 'navigate') return caches.match('index.html');
      throw new Error('offline');
    }
  })());
});
