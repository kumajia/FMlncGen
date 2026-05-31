// FM.LNC GEN — Service Worker
const CACHE = 'fmlnc-v1';
const ASSETS = [
  './fm-lnc-generator.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
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
  // Gemini API や Google Fonts などの外部リクエストはキャッシュせずネットワークへ
  if (url.origin !== self.location.origin) return;

  // 自分のアセットは cache-first（オフラインでも起動可能に）
  e.respondWith(
    caches.match(e.request).then((cached) => {
      return cached || fetch(e.request).then((res) => {
        // 同一オリジンの成功レスポンスはキャッシュに追加
        if (res && res.status === 200 && e.request.method === 'GET') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
