import baseWorker from './worker-receiver-json-fast.js';

const DIRECT_MARKER = 'receiver-direct-inmemory-v2-endpoint-health';

function patchRuntime(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;

  return response.text().then((source) => {
    const oldExport = "  window.__freqbeaconReceiverRuntime={version:VERSION,get livePoolCount(){return livePool.receivers.length;},get livePoolUpdatedAt(){return livePool.updatedAt;}};";
    const newExport = `  window.__freqbeaconReceiverRuntime={
    version:'receiver-runtime-v5-direct-inmemory-health',
    get livePoolCount(){return livePool.receivers.length;},
    get livePoolUpdatedAt(){return livePool.updatedAt;},
    recommend(input){
      let url;
      try {
        url = input instanceof URL ? input : new URL(String(input || '/api/sdr/receivers'), window.location.href);
      } catch {
        return { receivers:[], source:'receiver-runtime-direct-error', generatedAt:new Date().toISOString() };
      }

      const context = contextFromUrl(url);
      let receivers = Number.isFinite(context.frequency) ? rankReceivers(context) : [];

      // ReceiverBook can expose more than one endpoint for the same physical
      // KiwiSDR. Keep only the strongest endpoint for a callsign so FREQBEACON
      // does not waste connection attempts on duplicate aliases. Prefer an
      // endpoint that succeeded recently, then a stable hostname over a raw IP.
      if (receivers.length > 1) {
        const health = loadHealth();
        const now = Date.now();
        const recentCutoff = now - 45 * 60 * 1000;
        const callsignFor = (receiver) => {
          const text = String((receiver?.name || '') + ' ' + (receiver?.location || '')).toUpperCase();
          return text.match(/\\b[A-Z]{1,2}\\d[A-Z]{1,4}\\b/)?.[0] || '';
        };
        const hostFor = (receiver) => String(receiver?.id || '').split(':')[0].toLowerCase();
        const rawIp = (host) => /^(?:\\d{1,3}\\.){3}\\d{1,3}$/.test(host);
        const endpointScore = (receiver, originalIndex) => {
          const entry = health[receiver?.id] || {};
          const cooling = Number(entry.cooldownUntil || 0) > now;
          const recentSuccess = Number(entry.lastSuccess || 0) > recentCutoff;
          return (cooling ? -10000 : 0)
            + (recentSuccess ? 5000 : 0)
            + (rawIp(hostFor(receiver)) ? 0 : 500)
            + (receiver?.liveEvidence ? 25 : 0)
            - originalIndex;
        };

        const deduped = [];
        const aliasSlots = new Map();
        receivers.forEach((receiver, index) => {
          const callsign = callsignFor(receiver);
          if (!callsign) {
            deduped.push(receiver);
            return;
          }
          if (!aliasSlots.has(callsign)) {
            aliasSlots.set(callsign, deduped.length);
            deduped.push(receiver);
            return;
          }
          const slot = aliasSlots.get(callsign);
          const existing = deduped[slot];
          if (endpointScore(receiver, index) > endpointScore(existing, slot)) {
            deduped[slot] = {
              ...receiver,
              role: existing.role,
              reason: existing.reason,
              recommended: existing.recommended
            };
          }
        });
        receivers = deduped.map((receiver, index) => ({ ...receiver, recommended:index === 0 }));
      }

      return {
        receivers,
        source:livePool.receivers.length>=4?'receiver-runtime-live-cache':'receiver-runtime-seed',
        generatedAt:new Date().toISOString()
      };
    }
  };`;

    const patched = source.replace(oldExport, newExport);
    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/javascript; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-direct-ranking', patched === source ? 'runtime-patch-miss' : DIRECT_MARKER);
    return new Response(patched, { status: response.status, statusText: response.statusText, headers });
  });
}

function patchPlayer(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;

  return response.text().then((source) => {
    const oldBlock = `      const response = await fetch(recommendationUrl(frequency, container), {
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(\`Receiver directory HTTP \${response.status}\`);
      const payload = await response.json();`;

    const newBlock = `      const directRuntime = window.__freqbeaconReceiverRuntime;
      let payload;
      if (typeof directRuntime?.recommend === 'function') {
        payload = directRuntime.recommend(recommendationUrl(frequency, container));
      } else {
        const response = await fetch(recommendationUrl(frequency, container), {
          headers: { Accept: 'application/json' },
          signal: controller.signal
        });
        if (!response.ok) throw new Error(\`Receiver directory HTTP \${response.status}\`);
        payload = await response.json();
      }`;

    const patched = source.replace(oldBlock, newBlock);
    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/javascript; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-direct-ranking', patched === source ? 'player-patch-miss' : DIRECT_MARKER);
    return new Response(patched, { status: response.status, statusText: response.statusText, headers });
  });
}

function patchRoot(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;
  return response.text().then((html) => {
    html = html.replace(/sdr-receiver-runtime-v3\.js\?v=\d+/g, 'sdr-receiver-runtime-v3.js?v=4');
    html = html.replace(/sdr-player\.js\?v=\d+(?:&sdrdiag=\d+)?/g, 'sdr-player.js?v=6');
    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-direct-ranking', DIRECT_MARKER);
    return new Response(html, { status: response.status, statusText: response.statusText, headers });
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await baseWorker.fetch(request, env, ctx);

    if (request.method === 'GET' && url.pathname === '/sdr-receiver-runtime-v3.js') {
      return patchRuntime(response);
    }
    if (request.method === 'GET' && url.pathname === '/sdr-player.js') {
      return patchPlayer(response);
    }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return patchRoot(response);
    }
    return response;
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') {
      return baseWorker.scheduled(event, env, ctx);
    }
  }
};
