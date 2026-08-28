import baseWorker from './worker-program-v15.js';

function injectScheduledService(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;
  return response.text().then((html) => {
    html = html.replace(
      /<link\s+rel="manifest"\s+href="[^"]+"\s*\/?>/i,
      '<link rel="manifest" href="/freqbeacon.webmanifest?v=1" />'
    );
    if (!html.includes('program-guide-scheduled-service.js')) {
      html = html.replace('</body>', '  <script src="program-guide-scheduled-service.js?v=1"></script>\n</body>');
    }
    const headers = new Headers(response.headers);
    headers.set('content-type','text/html; charset=utf-8');
    headers.set('cache-control','no-store, max-age=0');
    headers.set('x-freqbeacon-scheduled-service','v1');
    headers.set('x-freqbeacon-pwa-manifest','v1');
    return new Response(html,{status:response.status,statusText:response.statusText,headers});
  });
}

export default {
  async fetch(request, env, ctx) {
    const response = await baseWorker.fetch(request, env, ctx);
    const url = new URL(request.url);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return injectScheduledService(response);
    }
    return response;
  },
  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(event, env, ctx);
  }
};
