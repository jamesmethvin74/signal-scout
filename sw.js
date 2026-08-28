const SW_VERSION = 'freqbeacon-pwa-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.origin !== self.location.origin) return;

  // FREQBEACON depends on fresh schedule, SDR, and runtime responses. The
  // service worker exists for PWA installability and deliberately passes
  // same-origin GETs straight through instead of caching them.
  event.respondWith(fetch(request));
});
