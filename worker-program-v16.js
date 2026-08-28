import baseWorker from './worker-program-v15.js';

function injectScheduledService(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;
  return response.text().then((html) => {
    // Keep one canonical manifest reference in the document. The manifest,
    // service worker, and icon files themselves are served directly as static
    // assets by Cloudflare rather than being wrapped by the Worker.
    html = html.replace(
      /<link\s+rel="manifest"\s+href="[^"]+"\s*\/?>/i,
      '<link rel="manifest" href="/manifest.webmanifest?v=2" />'
    );
    html = html.replace(
      /<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="favicon\.svg"\s*\/?>/i,
      '<link rel="icon" type="image/webp" sizes="192x192" href="/freqbeacon-icon-v3-192.webp" />'
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
    headers.set('x-freqbeacon-pwa-manifest','static-v2');
    return new Response(html,{status:response.status,statusText:response.statusText,headers});
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
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
