const SW_VERSION = 'freqbeacon-pwa-v3';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// No fetch handler by design. FREQBEACON's live schedules, SDR endpoints,
// WebSockets, and static assets remain on the browser's normal network path.
