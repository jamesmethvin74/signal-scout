import baseWorker from './worker-program-v15.js';

async function servePwaAsset(request, env, pathname, contentType, extraHeaders = {}) {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = pathname;
  assetUrl.search = '';
  const asset = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: 'GET' }));
  const headers = new Headers(asset.headers);
  headers.set('content-type', contentType);
  headers.set('cache-control', 'no-store, max-age=0');
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  return new Response(asset.body, {
    status: asset.status,
    statusText: asset.statusText,
    headers
  });
}

function injectScheduledService(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;
  return response.text().then((html) => {
    html = html.replace(
      /<link\s+rel="manifest"\s+href="[^"]+"\s*\/?>/i,
      '<link rel="manifest" href="/freqbeacon.webmanifest?v=2" />'
    );
    if (!html.includes('program-guide-scheduled-service.js')) {
      html = html.replace('</body>', '  <script src="program-guide-scheduled-service.js?v=1"></script>\n</body>');
    }
    const headers = new Headers(response.headers);
    headers.set('content-type','text/html; charset=utf-8');
    headers.set('cache-control','no-store, max-age=0');
    headers.set('x-freqbeacon-scheduled-service','v1');
    headers.set('x-freqbeacon-pwa-manifest','v2');
    return new Response(html,{status:response.status,statusText:response.statusText,headers});
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/freqbeacon.webmanifest') {
      return servePwaAsset(
        request,
        env,
        '/freqbeacon.webmanifest',
        'application/manifest+json; charset=utf-8',
        { 'x-freqbeacon-pwa-asset': 'manifest-v2' }
      );
    }

    if (request.method === 'GET' && url.pathname === '/sw.js') {
      return servePwaAsset(
        request,
        env,
        '/sw.js',
        'application/javascript; charset=utf-8',
        {
          'service-worker-allowed': '/',
          'x-freqbeacon-pwa-asset': 'service-worker-v4'
        }
      );
    }

    const response = await baseWorker.fetch(request, env, ctx);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return injectScheduledService(response);
    }
    return response;
  },
  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(event, env, ctx);
  }
};
