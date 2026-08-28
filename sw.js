const SW_VERSION = 'freqbeacon-canonical-v1';

function offlineResponse() {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#07111f"><title>FREQBEACON — Offline</title><style>html,body{margin:0;min-height:100%;background:#07111f;color:#eef8ff;font-family:system-ui,-apple-system,sans-serif}body{display:grid;place-items:center;padding:28px;box-sizing:border-box}.card{max-width:420px;text-align:center}.name{font-weight:900;letter-spacing:.12em;font-size:24px}.tag{margin-top:8px;color:#63d9ff}.note{margin-top:24px;color:#a8bed0;line-height:1.5}</style></head><body><main class="card"><div class="name">FREQBEACON</div><div class="tag">Explore the airwaves.</div><div class="note">You are offline. Reconnect to refresh schedules and live SDR tools.</div></main></body></html>`, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Only navigations are intercepted. SDR, WebSockets, APIs, audio, spectrum,
// waterfall, tuning, and static assets remain on the normal network path.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.mode !== 'navigate') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request).catch(() => offlineResponse())
  );
});
