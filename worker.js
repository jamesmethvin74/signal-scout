import baseWorker from './worker-v2.js';

const SDR_RUNTIME_ASSETS = new Set(['/sdr-rf-v2.js', '/sdr-health.js']);

function noStoreHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store, max-age=0');
  return headers;
}

function patchSdrOriginChecks(source) {
  return source.replaceAll(
    'url.origin !== window.location.origin',
    'url.host !== window.location.host'
  );
}

export default {
  async fetch(request, env, ctx) {
    const response = await baseWorker.fetch(request, env, ctx);
    if (request.method !== 'GET') return response;

    const url = new URL(request.url);
    const contentType = String(response.headers.get('content-type') || '');

    // Serve corrected SDR runtime code directly. WebSocket URLs use ws:/wss:
    // while the page uses http:/https:, so comparing URL.origin rejects a
    // same-host SDR socket even though it belongs to Signal Scout. Compare the
    // host + endpoint path instead and keep the original WebSocket URL intact.
    if (SDR_RUNTIME_ASSETS.has(url.pathname) && /javascript|text\/plain/.test(contentType)) {
      const source = await response.text();
      const patched = patchSdrOriginChecks(source);
      const headers = noStoreHeaders(response);
      headers.set('content-type', 'application/javascript; charset=utf-8');
      headers.set('x-signal-scout-sdr-runtime', 'origin-host-fix-v1');
      return new Response(patched, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    // Force browsers to request the corrected runtime asset URLs after this
    // deployment rather than reusing earlier broken or superseded copies.
    if ((url.pathname === '/' || url.pathname === '/index.html') && contentType.includes('text/html')) {
      let html = await response.text();
      html = html
        .replace('sdr-rf-v2.js?v=5', 'sdr-rf-v2.js?v=6')
        .replace('sdr-health.js?v=2', 'sdr-health.js?v=3')
        .replace('sdr-tuning.js?v=1', 'sdr-tuning-v2.js?v=1');
      const headers = noStoreHeaders(response);
      headers.set('content-type', 'text/html; charset=utf-8');
      headers.set('x-signal-scout-sdr-runtime', 'origin-host-fix-v1');
      return new Response(html, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    return response;
  }
};

// Deployment marker: route the SDR runtime assets through the Worker so the origin fix is actually served.
// Deployment marker: publish interactive spectrum drag/tap tuning controls.
// Deployment marker: publish moving active-frequency cursor without re-centering the RF view on every tune.
