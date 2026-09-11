import baseWorker from './worker-program-v15.js';

export default {
  async fetch(request, env, ctx) {
    const response = await baseWorker.fetch(request, env, ctx);
    if (request.method !== 'GET') return response;

    const url = new URL(request.url);
    const contentType = String(response.headers.get('content-type') || '');
    if ((url.pathname !== '/' && url.pathname !== '/index.html') || !contentType.includes('text/html')) {
      return response;
    }

    let html = await response.text();
    if (!html.includes('freqbeacon-category-options.css')) {
      html = html.replace(
        '</head>',
        '  <link rel="stylesheet" href="freqbeacon-category-options.css?v=1" />\n</head>'
      );
    }
    if (!html.includes('freqbeacon-category-options.js')) {
      html = html.replace(
        '</body>',
        '  <script src="freqbeacon-category-options.js?v=1"></script>\n</body>'
      );
    }

    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-guided-options', 'v1');
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  },
  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(event, env, ctx);
  }
};
