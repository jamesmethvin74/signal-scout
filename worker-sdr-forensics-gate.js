import baseWorker from './worker-sdr-mainthread-relief.js';

const MARKER = 'sdr-player-forensics-v4-gate';
const TRACE_SCRIPT = '/sdr-forensics-v4.js?v=2';

function injectForensics(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;

  return response.text().then((html) => {
    if (!html.includes(TRACE_SCRIPT)) {
      const tag = `<script src="${TRACE_SCRIPT}"></script>`;
      html = html.includes('</head>')
        ? html.replace('</head>', `  ${tag}\n</head>`)
        : `${tag}\n${html}`;
    }

    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-sdr-forensics', MARKER);
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

    if (
      request.method === 'GET'
      && url.searchParams.get('sdrtest') === '2'
      && (url.pathname === '/' || url.pathname === '/index.html')
    ) {
      return injectForensics(response);
    }

    return response;
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') {
      return baseWorker.scheduled(event, env, ctx);
    }
  }
};
