const SW_VERSION = 'freqbeacon-canonical-v2';
const SHELL_CACHE = `${SW_VERSION}-shell`;

// FREQBEACON is a static app shell with live data layered on top. Keep the
// shell local so Android can paint the installed app immediately instead of
// leaving the native PWA loading-progress indicator visible during startup.
// Live APIs, SDR sockets/audio, spectrum/waterfall traffic, and other fetch()
// data are intentionally not intercepted by this cache path.
const APP_SHELL_URLS = [
  '/',
  '/manifest.webmanifest?v=1',
  '/styles.css',
  '/lookup.css?v=1',
  '/arctic-slate.css?v=1',
  '/arctic-slate-controls.css?v=1',
  '/freqbeacon-brand.css?v=5',
  '/freqbeacon-brand.js?v=13',
  '/freqbeacon-startup-v3.avif',
  '/stations.js',
  '/full-data.js?v=1',
  '/ham-bands.js?v=1',
  '/app.js',
  '/band-labels.js?v=2',
  '/ham-ui.js?v=1',
  '/lookup.js?v=1',
  '/sdr-rf-v2.js?v=8',
  '/sdr-health.js?v=3',
  '/sdr-tuning-v3.js?v=2',
  '/sdr-player.js?v=2',
  '/sdr-live-reliability-v2.js?v=1',
  '/sdr-receiver-ui.js?v=3',
  '/card-collapse.js?v=1',
  '/program-guide.js?v=2'
];

const CACHEABLE_DESTINATIONS = new Set([
  'style',
  'script',
  'image',
  'font',
  'manifest'
]);

function offlineResponse() {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#07111f"><title>FREQBEACON — Offline</title><style>html,body{margin:0;min-height:100%;background:#07111f;color:#eef8ff;font-family:system-ui,-apple-system,sans-serif}body{display:grid;place-items:center;padding:28px;box-sizing:border-box}.card{max-width:420px;text-align:center}.name{font-weight:900;letter-spacing:.12em;font-size:24px}.tag{margin-top:8px;color:#63d9ff}.note{margin-top:24px;color:#a8bed0;line-height:1.5}</style></head><body><main class="card"><div class="name">FREQBEACON</div><div class="tag">Explore the airwaves.</div><div class="note">You are offline. Reconnect to refresh schedules and live SDR tools.</div></main></body></html>`, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

async function putSuccessful(cache, key, response) {
  if (!response || !response.ok) return response;
  try {
    await cache.put(key, response.clone());
  } catch {
    // A cache write failure must never break the live app.
  }
  return response;
}

async function warmShell() {
  const cache = await caches.open(SHELL_CACHE);
  await Promise.allSettled(APP_SHELL_URLS.map(async (url) => {
    const request = new Request(url, { cache: 'reload' });
    const response = await fetch(request);
    await putSuccessful(cache, request, response);
  }));
}

async function refreshNavigation(request) {
  const cache = await caches.open(SHELL_CACHE);
  const response = await fetch(request);
  if (response && response.ok) {
    // Keep one canonical shell key so start_url, /, and /index.html all share
    // the freshest Worker-rewritten production HTML.
    await putSuccessful(cache, '/', response);
  }
  return response;
}

async function serveNavigation(event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match('/');

  if (cached) {
    event.waitUntil(refreshNavigation(event.request).catch(() => undefined));
    return cached;
  }

  try {
    return await refreshNavigation(event.request);
  } catch {
    return offlineResponse();
  }
}

async function refreshStatic(request) {
  const cache = await caches.open(SHELL_CACHE);
  const response = await fetch(request);
  return putSuccessful(cache, request, response);
}

async function serveStatic(event) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(event.request);

  if (cached) {
    event.waitUntil(refreshStatic(event.request).catch(() => undefined));
    return cached;
  }

  return refreshStatic(event.request);
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await warmShell();
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith('freqbeacon-canonical-') && name !== SHELL_CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(serveNavigation(event));
    return;
  }

  // Cache only browser-declared static resources. Requests made by the app's
  // live radio/data code use destination="" and continue straight to network.
  if (CACHEABLE_DESTINATIONS.has(request.destination)) {
    event.respondWith(serveStatic(event));
  }
});
