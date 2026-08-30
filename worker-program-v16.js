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
      '<link rel="manifest" href="/manifest.webmanifest?v=3" />'
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
    html = html.replace(/sdr-player\.js\?v=\d+/g, 'sdr-player.js?v=3');
    html = html.replace(/sdr-receiver-ui\.js\?v=\d+/g, 'sdr-receiver-ui.js?v=6');
    html = html.replace(/\s*<script src="\/sdr-runtime-trace\.js\?v=\d+"><\/script>\s*/g, '\n');
    if (!html.includes('sdr-runtime-trace-safe.js')) {
      html = html.replace(
        '</head>',
        '  <script src="/sdr-runtime-trace-safe.js?v=1"></script>\n</head>'
      );
    }
    if (!html.includes('program-guide-scheduled-service.js')) {
      html = html.replace('</body>', '  <script src="program-guide-scheduled-service.js?v=1"></script>\n</body>');
    }
    const headers = new Headers(response.headers);
    headers.set('content-type','text/html; charset=utf-8');
    headers.set('cache-control','no-store, max-age=0');
    headers.set('x-freqbeacon-scheduled-service','v1');
    headers.set('x-freqbeacon-pwa-manifest','static-v3');
    headers.set('x-freqbeacon-receiver-ui','runtime-trace-v3-safe');
    return new Response(html,{status:response.status,statusText:response.statusText,headers});
  });
}

function injectDiagnosticsReturn(response, pathname) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;
  return response.text().then((html) => {
    if (pathname === '/sdr-runtime-trace.html' && !html.includes('data-freqbeacon-return-home')) {
      const startControl = `
<a href="/?sdrtest=1" data-freqbeacon-return-home="true" onclick="try{localStorage.removeItem('freqbeacon:sdr-runtime-trace:v1')}catch(e){}" style="position:sticky;top:8px;z-index:2147483647;display:block;width:100%;max-width:900px;margin:0 auto 14px;padding:14px 16px;border:1px solid #54c7f3;border-radius:12px;background:#123f5b;color:#fff;font:900 15px/1.2 system-ui,-apple-system,sans-serif;text-align:center;text-decoration:none;box-shadow:0 8px 24px rgba(0,0,0,.32)">▶ CLEAR TRACE &amp; START SDR TEST</a>
`;
      html = html.replace('<body>', `<body>${startControl}`);
    }
    if (!html.includes('diagnostics-home.js')) {
      html = html.replace('</body>', '  <script src="/diagnostics-home.js?v=2"></script>\n</body>');
    }
    const headers = new Headers(response.headers);
    headers.set('content-type','text/html; charset=utf-8');
    headers.set('cache-control','no-store, max-age=0');
    headers.set('x-freqbeacon-diagnostics-return','v2');
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
    if (request.method === 'GET' && (url.pathname === '/sdr-diagnostics.html' || url.pathname === '/sdr-runtime-trace.html')) {
      return injectDiagnosticsReturn(response, url.pathname);
    }
    return response;
  },
  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(event, env, ctx);
  }
};
