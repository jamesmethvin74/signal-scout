import baseWorker from './worker-sdr-directory-fast.js';

const HEALTH_CAPTURE_MARKER = 'freqbeacon-health-fetch-restore-v1';

function patchRootHtml(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;

  return response.text().then((html) => {
    if (!html.includes(HEALTH_CAPTURE_MARKER)) {
      html = html.replace(
        /<script\s+src="\/?sdr-health\.js\?v=\d+"><\/script>/i,
        `<script>window.__freqbeaconReceiverFetchBeforeHealth=window.fetch;window.__freqbeaconHealthFetchMarker='${HEALTH_CAPTURE_MARKER}';</script>\n  <script src="/sdr-health.js?v=6"></script>\n  <script>if(window.__freqbeaconReceiverFetchBeforeHealth){window.fetch=window.__freqbeaconReceiverFetchBeforeHealth;}window.__freqbeaconHealthFetchRestored=true;</script>`
      );
    }

    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-health-fetch-path', HEALTH_CAPTURE_MARKER);
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
      return patchRootHtml(response);
    }
    return response;
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') {
      return baseWorker.scheduled(event, env, ctx);
    }
  }
};
