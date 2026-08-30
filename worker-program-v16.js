import baseWorker from './worker-program-v15.js';

const SDR_ROOT_CAUSE_ASSETS = new Set(['/sdr-player.js', '/sdr-health.js', '/lookup.js']);

function patchedJsResponse(response, source, marker) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/javascript; charset=utf-8');
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set('x-freqbeacon-sdr-root-cause-fix', marker);
  return new Response(source, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function patchSdrPlayer(source) {
  let patched = source.replace(
    "    const strong = button.querySelector('strong');\n    const meta = button.querySelector('span');\n    const badge = button.querySelector('b');",
    `    let strong = button.querySelector('strong');
    let meta = button.querySelector('span span') || button.querySelector('.lookup-receiver-smart-main span');
    let badge = button.querySelector('b');
    if (!strong || !meta || !badge) {
      button.innerHTML = '<div class="lookup-receiver-smart-main"><strong></strong><span></span></div><b></b>';
      strong = button.querySelector('strong');
      meta = button.querySelector('.lookup-receiver-smart-main span');
      badge = button.querySelector('b');
    }`
  );

  // The first render used to select the OUTER wrapper span as `meta`. Setting
  // meta.textContent then deleted the nested <strong>, so the next receiver
  // update crashed at sdr-player.js:430 before chooser/WebSocket handoff.
  return patched;
}

function patchSdrHealth(source) {
  return source.replace(
    "    if (!url || url.origin !== window.location.origin || url.pathname !== '/api/sdr/receivers') return response;\n\n    try {",
    `    if (!url || url.origin !== window.location.origin || url.pathname !== '/api/sdr/receivers') return response;

    // receiver-runtime-v3 already applies cooldown/recent-success health while
    // ranking its local/live cache. Do not clone and re-parse that synthetic
    // Response here. On Android that duplicate Response clone stalled the body
    // handoff for tens of seconds even though ranking itself completed in ~5 ms.
    const runtimeDirectory = response.headers.get('x-freqbeacon-sdr-directory') || '';
    if (runtimeDirectory.startsWith('receiver-runtime-v3')) return response;

    try {`
  );
}

function patchLookup(source) {
  let patched = source.replace(
    `          <a class=\"listen-live-button\" \${liveAnchorAttributes(liveUrl)}>
            <span class=\"live-dot\" aria-hidden=\"true\"></span>
            Listen live
          </a>`,
    `          <button type=\"button\" class=\"listen-live-button\">
            <span class=\"live-dot\" aria-hidden=\"true\"></span>
            Listen live
          </button>`
  );

  patched = patched.replace(
    `    const live = document.createElement('a');
    live.className = 'listen-live-button card-listen-live';
    live.href = liveUrl;
    if (!isAndroid) {
      live.target = '_blank';
      live.rel = 'noopener noreferrer';
    }`,
    `    const live = document.createElement('button');
    live.type = 'button';
    live.className = 'listen-live-button card-listen-live';`
  );

  // Listen Live is an in-app SDR action now. Leaving the old Android
  // intent:// Kiwi link on the control allowed Chrome to start a navigation
  // progress bar while the in-app player was also handling the same tap.
  return patched;
}

function patchSdrRootCauseAsset(response, pathname) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;
  return response.text().then((source) => {
    if (pathname === '/sdr-player.js') return patchedJsResponse(response, patchSdrPlayer(source), 'player-selector-v1');
    if (pathname === '/sdr-health.js') return patchedJsResponse(response, patchSdrHealth(source), 'health-bypass-v1');
    if (pathname === '/lookup.js') return patchedJsResponse(response, patchLookup(source), 'listen-button-v1');
    return response;
  });
}

function injectScheduledService(response, url) {
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
    html = html.replace(/lookup\.js\?v=\d+/g, 'lookup.js?v=2');
    html = html.replace(/sdr-health\.js\?v=\d+/g, 'sdr-health.js?v=4');
    html = html.replace(/sdr-player\.js\?v=\d+/g, 'sdr-player.js?v=4');

    // Receiver selection has one owner. Remove the superseded local-catalog,
    // synchronous chooser, and v8/options wrapper chain so they cannot replace
    // fetch/selection state after the health and reliability runtimes load.
    html = html.replace(/\s*<script\s+src="\/?sdr-receiver-options-sync\.js\?v=\d+"><\/script>\s*/g, '\n');
    html = html.replace(/\s*<script\s+src="\/?sdr-receiver-local-catalog\.js\?v=\d+"><\/script>\s*/g, '\n');
    html = html.replace(/\s*<script\s+src="\/?sdr-receiver-ui-v8\.js\?v=\d+"><\/script>\s*/g, '\n');
    html = html.replace(/\s*<script\s+src="\/?sdr-receiver-ui\.js\?v=\d+"><\/script>\s*/g, '\n');

    // Load before sdr-health.js. Health and reliability then wrap this one
    // receiver source normally, preserving cooldown and geography behavior.
    if (!html.includes('sdr-receiver-runtime-v3.js')) {
      html = html.replace(
        '</head>',
        '  <script src="/sdr-receiver-runtime-v3.js?v=1"></script>\n</head>'
      );
    }

    // Do not monkey-patch fetch/Response with the forensic tracer on normal
    // production launches. It remains opt-in via /?sdrtest=1.
    html = html.replace(/\s*<script src="\/sdr-runtime-trace(?:-safe)?\.js\?v=\d+"><\/script>\s*/g, '\n');
    if (url.searchParams.get('sdrtest') === '1' && !html.includes('sdr-runtime-trace-safe.js')) {
      html = html.replace(
        '</head>',
        '  <script src="/sdr-runtime-trace-safe.js?v=3"></script>\n</head>'
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
    headers.set('x-freqbeacon-receiver-ui','receiver-runtime-v3');
    headers.set('x-freqbeacon-receiver-catalog','live-cache-health-v3');
    headers.set('x-freqbeacon-sdr-root-cause-fix','v1');
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
    if (request.method === 'GET' && SDR_ROOT_CAUSE_ASSETS.has(url.pathname)) {
      return patchSdrRootCauseAsset(response, url.pathname);
    }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return injectScheduledService(response, url);
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
