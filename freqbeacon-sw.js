const SW_VERSION = 'freqbeacon-passthrough-v5';

// Stability-first service worker.
//
// Keep a registration so FREQBEACON remains installable as a PWA, but do not
// intercept navigation or static assets. Every request goes directly to the
// live Cloudflare Worker/assets path. This prevents an installed Android app
// from being trapped behind a stale, invalid, or slow cached application shell.
// SDR WebSockets, audio, RF spectrum/waterfall, APIs and all other requests are
// likewise untouched.

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => /freqbeacon|signal-scout/i.test(name))
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

// Intentionally no fetch handler. Requests pass through to the network.
