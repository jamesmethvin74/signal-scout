const SW_VERSION = 'freqbeacon-safe-shell-v4';
const SHELL_CACHE = `${SW_VERSION}-cache`;
const SHELL_KEY = '/__freqbeacon_valid_shell_v4__';

const STATIC_URLS = [
  '/manifest.json',
  '/styles.css',
  '/lookup.css?v=1',
  '/arctic-slate.css?v=1',
  '/arctic-slate-controls.css?v=1',
  '/freqbeacon-brand.css?v=5',
  '/freqbeacon-brand.js?v=15',
  '/freqbeacon-startup-v3.avif',
  '/freqbeacon-icon-v3-192.webp',
  '/stations.js',
  '/full-data.js?v=1',
  '/ham-bands.js?v=1',
  '/app.js?v=2',
  '/band-labels.js?v=3',
  '/ham-ui.js?v=1',
  '/lookup.js?v=1',
  '/card-collapse.js?v=2'
];

const CACHEABLE_DESTINATIONS = new Set(['style', 'script', 'image', 'font', 'manifest']);

async function fetchValidatedShell() {
  const response = await fetch(`/?freqbeacon-shell=${Date.now()}`, { cache: 'no-store' });
  if (!response || !response.ok) throw new Error('Shell fetch failed');

  const html = await response.text();
  const valid = html.includes('class="app-shell"')
    && html.includes('FREQBEACON')
    && html.includes('freqbeacon-brand.js?v=15')
    && html.includes('app.js?v=2');
  if (!valid) throw new Error('Shell validation failed');

  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(html, {
    status: 200,
    statusText: 'OK',
    headers
  });
}

async function refreshShell(cache) {
  const shell = await fetchValidatedShell();
  await cache.put(SHELL_KEY, shell.clone());
  return shell;
}

async function warmStatic(cache) {
  await Promise.allSettled(STATIC_URLS.map(async (url) => {
    const request = new Request(url, { cache: 'reload' });
    const response = await fetch(request);
    if (response && response.ok) await cache.put(request, response.clone());
  }));
}

async function serveNavigation(event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(SHELL_KEY);
  if (cached) {
    event.waitUntil(refreshShell(cache).catch(() => undefined));
    return cached;
  }
  return refreshShell(cache);
}

async function serveStatic(event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(event.request);
  if (cached) {
    event.waitUntil((async () => {
      try {
        const response = await fetch(event.request);
        if (response && response.ok) await cache.put(event.request, response.clone());
      } catch {}
    })());
    return cached;
  }

  const response = await fetch(event.request);
  if (response && response.ok) {
    event.waitUntil(cache.put(event.request, response.clone()).catch(() => undefined));
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await refreshShell(cache);
    await warmStatic(cache);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => /freqbeacon|signal-scout/i.test(name) && name !== SHELL_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html')) {
    event.respondWith(serveNavigation(event));
    return;
  }

  if (CACHEABLE_DESTINATIONS.has(request.destination)) {
    event.respondWith(serveStatic(event));
  }
});