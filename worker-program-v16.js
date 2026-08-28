import baseWorker from './worker-program-v15.js';

const CANONICAL_MANIFEST_PATH = '/manifest.webmanifest';
const CANONICAL_SW_PATH = '/freqbeacon-sw.js';
const MANIFEST_PATHS = new Set(['/manifest.webmanifest', '/freqbeacon.webmanifest', '/manifest.json']);
const SERVICE_WORKER_PATHS = new Set(['/freqbeacon-sw.js', '/sw.js']);

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
      '<link rel="manifest" href="/manifest.webmanifest?v=1" />'
    );
    html = html.replace(
      /<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="favicon\.svg"\s*\/?>/i,
      '<link rel="icon" type="image/png" sizes="192x192" href="/freqbeacon-icon-192.png" />'
    );
    html = html.replace(
      /<link\s+rel="icon"\s+type="image\/png"\s+sizes="32x32"\s+href="favicon-32\.png"\s*\/?>/i,
      ''
    );
    html = html.replace(
      /<link\s+rel="apple-touch-icon"\s+sizes="180x180"\s+href="apple-touch-icon\.png"\s*\/?>/i,
      '<link rel="apple-touch-icon" href="/freqbeacon-icon-192.png" />'
    );
    if (!html.includes('program-guide-scheduled-service.js')) {
      html = html.replace('</body>', '  <script src="program-guide-scheduled-service.js?v=1"></script>\n</body>');
    }
    const headers = new Headers(response.headers);
    headers.set('content-type','text/html; charset=utf-8');
    headers.set('cache-control','no-store, max-age=0');
    headers.set('x-freqbeacon-scheduled-service','v1');
    headers.set('x-freqbeacon-pwa-manifest','canonical-v1');
    return new Response(html,{status:response.status,statusText:response.statusText,headers});
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && MANIFEST_PATHS.has(url.pathname)) {
      return servePwaAsset(
        request,
        env,
        CANONICAL_MANIFEST_PATH,
        'application/manifest+json; charset=utf-8',
        { 'x-freqbeacon-pwa-asset': 'manifest-canonical-v1' }
      );
    }

    if (request.method === 'GET' && SERVICE_WORKER_PATHS.has(url.pathname)) {
      return servePwaAsset(
        request,
        env,
        CANONICAL_SW_PATH,
        'application/javascript; charset=utf-8',
        {
          'service-worker-allowed': '/',
          'x-freqbeacon-pwa-asset': 'service-worker-canonical-v1'
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
