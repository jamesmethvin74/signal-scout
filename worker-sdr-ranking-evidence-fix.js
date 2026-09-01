import baseWorker from './worker-sdr-samepage-control.js';

const MARKER = 'sdr-ranking-evidence-fix-v1';

function jsResponse(response, source, headerName, headerValue) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/javascript; charset=utf-8');
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set(headerName, headerValue);
  return new Response(source, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function patchRuntime(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;

  return response.text().then((source) => {
    let patched = source;

    // Abandon the v1 usability history because it contains failures recorded
    // while FREQBEACON itself was delaying WebSocket OPEN events. A pre-OPEN
    // timeout is not trustworthy evidence that a public receiver is unhealthy.
    patched = patched.replaceAll(
      "freqbeacon:sdrConnectionUsability:v1",
      "freqbeacon:sdrConnectionUsability:v2"
    );

    // Keep success evidence, but stop recording generic player attempt failures.
    // Confirmed Kiwi busy/offline state remains handled by sdr-health.js.
    patched = patched.replace(
      "  window.addEventListener('freqbeacon:snd-attempt-failed', (event) => {\n    noteConnectionFailure(event.detail?.receiverId, event.detail?.reason);\n  });\n",
      "  // Pre-OPEN player timeouts are not receiver-health evidence.\n"
    );

    const applied = patched !== source
      && patched.includes('freqbeacon:sdrConnectionUsability:v2')
      && !patched.includes("window.addEventListener('freqbeacon:snd-attempt-failed'")
      && patched.includes("window.addEventListener('freqbeacon:snd-audio'");

    return jsResponse(
      response,
      patched,
      'x-freqbeacon-sdr-ranking-evidence',
      applied ? MARKER : 'runtime-patch-miss'
    );
  });
}

function patchRoot(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;

  return response.text().then((html) => {
    html = html.replace(/sdr-receiver-runtime-v3\.js\?v=\d+/g, 'sdr-receiver-runtime-v3.js?v=10');
    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-sdr-ranking-evidence', MARKER);
    return new Response(html, { status: response.status, statusText: response.statusText, headers });
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await baseWorker.fetch(request, env, ctx);

    if (request.method === 'GET' && url.pathname === '/sdr-receiver-runtime-v3.js') return patchRuntime(response);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return patchRoot(response);
    return response;
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(event, env, ctx);
  }
};
