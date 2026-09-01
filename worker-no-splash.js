import baseWorker from './worker-sdr-mainthread-relief.js';

const MARKER = 'freqbeacon-no-splash-v2';

function patchRoot(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;

  return response.text().then((html) => {
    // Production recovery: remove the startup splash structurally instead of
    // using a nested-div regex. Also inject a CSS hard-hide as a belt-and-
    // suspenders fallback so the splash can never cover the app shell.
    const splashStart = html.indexOf('<div class="freqbeacon-splash"');
    const appShellStart = splashStart >= 0
      ? html.indexOf('<div class="app-shell">', splashStart)
      : -1;

    let patched = html;
    let removed = false;
    if (splashStart >= 0 && appShellStart > splashStart) {
      patched = html.slice(0, splashStart) + html.slice(appShellStart);
      removed = true;
    }

    const hardHide = '<style id="freqbeacon-no-splash">.freqbeacon-splash{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important}</style>';
    if (patched.includes('</head>') && !patched.includes('id="freqbeacon-no-splash"')) {
      patched = patched.replace('</head>', `${hardHide}</head>`);
    }

    patched = patched.replace(/freqbeacon-brand\.css\?v=\d+/g, 'freqbeacon-brand.css?v=17');

    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-startup-recovery', removed ? MARKER : `${MARKER}-css-only`);
    return new Response(patched, {
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
      return patchRoot(response);
    }
    return response;
  },
  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(event, env, ctx);
  }
};
