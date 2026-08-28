const SW_VERSION = 'freqbeacon-pwa-v4';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Older Android Chrome/WebAPK installability checks still expect a service
// worker with a fetch handler. Intercept navigation only; all SDR, WebSocket,
// API, audio, spectrum, waterfall, and static-asset requests stay untouched.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(fetch(request));
});
