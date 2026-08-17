// FM.LNC GEN — Service Worker
const CACHE = 'fmlnc-runtime';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './fm_dictionary.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== 'GET') return;

  // オンライン時は常に最新版を返し、取得できないときだけキャッシュへ戻る。
  // これにより、更新のたびにCACHE名を変更する必要がない。
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() =>
      caches.match(e.request).then((cached) => {
        if (cached) return cached;
        if (e.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      })
    )
  );
});
