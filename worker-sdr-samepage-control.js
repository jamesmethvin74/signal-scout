import baseWorker from './worker-sdr-reliability-ranking.js';

const MARKER = 'sdr-samepage-control-disabled-v3';

function patchRoot(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;

  return response.text().then((html) => {
    // The same-page probe proved Tipton can deliver SND, but it also opens its
    // own Kiwi session before the real player. Remove it from production so
    // Listen Live owns the first/only SND session.
    html = html.replace(/\s*<script\s+src="\/?sdr-samepage-control\.js\?v=\d+"><\/script>/ig, '');

    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-sdr-samepage-control', MARKER);
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  });
}

function noStore(response) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set('x-freqbeacon-sdr-samepage-control', MARKER);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await baseWorker.fetch(request, env, ctx);

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return patchRoot(response);
    }
    if (request.method === 'GET' && url.pathname === '/sdr-samepage-control.js') {
      return noStore(response);
    }
    return response;
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(event, env, ctx);
  }
};
