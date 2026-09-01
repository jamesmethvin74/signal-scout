import baseWorker from './worker-sdr-copy-report-v6.js';

const MARKER = 'sdr-km4rt-canonical-alias-v1';

function patchPlayer(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;

  return response.text().then((source) => {
    const oldWebsocketUrl = `  function websocketUrl(receiverIndex) {
    const receiver = sdr.receivers[receiverIndex] || sdr.receivers[0] || LEGACY_RECEIVERS[0];
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const timestamp = (Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 10000)) >>> 0;
    return \`${scheme}//${window.location.host}/api/sdr/ws?receiver=\${encodeURIComponent(receiver.id)}&stream=SND&ts=\${timestamp}\`;
  }`;

    const newWebsocketUrl = `  function canonicalReceiverId(value) {
    const id = String(value || '').trim();
    if (id.toLowerCase() === '64.22.14.214:8073') return 'km4rt.ddns.net:8073';
    return id;
  }

  function normalizeReceiverList(receivers) {
    const normalized = [];
    const seen = new Set();
    for (const receiver of Array.isArray(receivers) ? receivers : []) {
      const canonicalId = canonicalReceiverId(receiver?.id);
      if (!canonicalId) continue;
      const key = canonicalId.toLowerCase();
      if (seen.has(key)) {
        const existing = normalized.find((item) => String(item.id || '').toLowerCase() === key);
        if (existing && receiver?.recommended && !existing.recommended) existing.recommended = true;
        continue;
      }
      seen.add(key);
      normalized.push({ ...receiver, id: canonicalId, sourceReceiverId: receiver?.id || canonicalId });
    }
    return normalized;
  }

  function websocketUrl(receiverIndex) {
    const receiver = sdr.receivers[receiverIndex] || sdr.receivers[0] || LEGACY_RECEIVERS[0];
    const connectionId = canonicalReceiverId(receiver?.id);
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const timestamp = (Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 10000)) >>> 0;
    return \`${scheme}//${window.location.host}/api/sdr/ws?receiver=\${encodeURIComponent(connectionId)}&stream=SND&ts=\${timestamp}\`;
  }`;

    let patched = source.replace(oldWebsocketUrl, newWebsocketUrl);
    patched = patched.replace(
      '      sdr.receivers = payload.receivers;',
      '      sdr.receivers = normalizeReceiverList(payload.receivers);'
    );

    const applied = patched !== source
      && patched.includes("64.22.14.214:8073') return 'km4rt.ddns.net:8073'")
      && patched.includes('sdr.receivers = normalizeReceiverList(payload.receivers);');

    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/javascript; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-km4rt-alias', applied ? MARKER : 'patch-miss');
    return new Response(patched, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  });
}

function patchRoot(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;
  return response.text().then((html) => {
    html = html.replace(/sdr-player\.js\?v=\d+/g, 'sdr-player.js?v=11');
    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-km4rt-alias', MARKER);
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
    if (request.method === 'GET' && url.pathname === '/sdr-player.js') return patchPlayer(response);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return patchRoot(response);
    return response;
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(event, env, ctx);
  }
};
