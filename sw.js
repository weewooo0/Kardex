const CACHE = 'kardex-v87b';
const WHISPER_RUNTIME_CACHE = 'companion-md-whisper-runtime';
const SHELL = [
  './',
  './index.html',
  './app.js',
  './ai.js',
  './theme.js',
  './census.js',
  './labs.js',
  './clinical.js',
  './vault.js',
  './whisper.js',
  './whisper.worker.js',
  './redaction.js',
  './styles.css',
  './manifest.webmanifest',
  './icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'no-cache' }))))
  );
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) =>
      Promise.all(ks.filter((k) => k !== CACHE && k !== WHISPER_RUNTIME_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isWhisperRuntimeCdnUrl(url) {
  return (
    url.hostname === 'cdn.jsdelivr.net' &&
    /\/(@huggingface\/transformers|onnxruntime-web)\b/i.test(url.pathname)
  );
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const reqUrl = new URL(e.request.url);

  // Pure Cache-First for pinned on-demand Transformers.js / ONNX Runtime JS & WASM assets
  if (reqUrl.origin !== self.location.origin) {
    if (!isWhisperRuntimeCdnUrl(reqUrl)) return;
    e.respondWith(
      caches.open(WHISPER_RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(e.request);
        if (cached) return cached;
        const res = await fetch(e.request);
        if (res && res.ok) {
          e.waitUntil(cache.put(e.request, res.clone()).catch(() => {}));
        }
        return res;
      })
    );
    return;
  }

  if (e.request.cache === 'only-if-cached' && e.request.mode !== 'same-origin') return;

  // Stale-While-Revalidate for top-level navigation (instant boot on lie-fi; background refresh updates cache)
  if (e.request.mode === 'navigate') {
    const networkRefresh = fetch(e.request, { cache: 'no-cache' })
      .then(async (res) => {
        if (res && res.ok) {
          const c = await caches.open(CACHE);
          await c.put(e.request, res.clone());
        }
        return res;
      })
      .catch(() => null);
    e.waitUntil(networkRefresh);
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = (await cache.match(e.request)) || (await cache.match('./index.html'));
        if (cached) return cached;
        const netRes = await networkRefresh;
        return netRes || (await caches.match('./index.html'));
      })
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request, { cache: 'no-cache' }).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            e.waitUntil(caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {}));
          }
          return res;
        })
    )
  );
});
