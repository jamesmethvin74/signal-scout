import baseWorker from './worker-sdr-mainthread-relief.js';

const MARKER = 'freqbeacon-no-splash-v1';

function patchRoot(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;

  return response.text().then((html) => {
    // Production recovery: remove the startup splash entirely so the app shell
    // is always visible even if branding/startup JavaScript stalls on Android.
    html = html.replace(/\s*<div class="freqbeacon-splash"[\s\S]*?<\/div>\s*<div class="app-shell">/, '\n  <div class="app-shell">');
    html = html.replace(/freqbeacon-brand\.css\?v=\d+/g, 'freqbeacon-brand.css?v=16');

    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-startup-recovery', MARKER);
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await baseWorker.fetch(request, env, ctx);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return patchRoot(response);
    }
    return response;
  },
  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(event, env, ctx);
  }
};
