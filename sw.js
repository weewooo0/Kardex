const CACHE = 'kardex-v80b';
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
        if (res && res.ok) cache.put(e.request, res.clone());
        return res;
      })
    );
    return;
  }

  if (e.request.cache === 'only-if-cached' && e.request.mode !== 'same-origin') return;

  // Network-first with timeout only for top-level navigation ("lie-fi"); Cache-first for static shell assets
  if (e.request.mode === 'navigate') {
    e.respondWith(
      (async () => {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 3500) : null;
        try {
          const res = await fetch(
            e.request,
            controller ? { cache: 'no-cache', signal: controller.signal } : { cache: 'no-cache' }
          );
          if (timer) clearTimeout(timer);
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        } catch {
          if (timer) clearTimeout(timer);
          return caches.match(e.request).then((hit) => hit || caches.match('./index.html'));
        }
      })()
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
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
    )
  );
});
