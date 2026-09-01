const SW_VERSION = 'freqbeacon-self-destruct-v6';

// Emergency Android recovery worker.
// Existing FREQBEACON PWA installations may still have an older navigation-
// intercepting service worker registered before the app can run its normal
// cleanup code. This worker deliberately owns no fetches and removes itself.

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const names = await caches.keys();
      await Promise.allSettled(
        names
          .filter((name) => /freqbeacon|signal-scout/i.test(name))
          .map((name) => caches.delete(name))
      );
    } catch {}

    try {
      await self.clients.claim();
    } catch {}

    try {
      await self.registration.unregister();
    } catch {}
  })());
});

// Intentionally no fetch handler. All navigation, assets, SDR WebSockets,
// APIs and audio requests pass directly to the network while this worker
// removes the stale registration.
