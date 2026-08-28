const SW_VERSION = 'freqbeacon-pwa-v2';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Chrome Android no longer requires a service-worker fetch handler for menu
// installation. FREQBEACON intentionally does not intercept network requests:
// live schedules, SDR endpoints, WebSockets, and static assets stay on their
// normal network path, and the browser's page-loading indicator is not held by
// a service-worker pass-through request.
