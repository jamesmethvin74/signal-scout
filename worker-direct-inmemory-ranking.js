import baseWorker from './worker-receiver-json-fast.js';

const DIRECT_MARKER = 'receiver-direct-inmemory-v3-fast-failover-health';

function patchRuntime(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;

  return response.text().then((source) => {
    const oldExport = "  window.__freqbeaconReceiverRuntime={version:VERSION,get livePoolCount(){return livePool.receivers.length;},get livePoolUpdatedAt(){return livePool.updatedAt;}};";
    const newExport = `  window.__freqbeaconReceiverRuntime={
    version:'receiver-runtime-v6-direct-inmemory-fast-health',
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

      // ReceiverBook can expose multiple aliases for one physical KiwiSDR.
      // Collapse those aliases before the player connects. Prefer recent
      // success, then a hostname over a raw IP, without changing RF ranking.
      if (receivers.length > 1) {
        const health = loadHealth();
        const now = Date.now();
        const recentCutoff = now - 45 * 60 * 1000;
        const callsignFor = (receiver) => {
          const text = String((receiver?.name || '') + ' ' + (receiver?.location || '')).toUpperCase();
          return text.match(/[A-Z]{1,2}[0-9][A-Z]{1,4}/)?.[0] || '';
        };
        const hostFor = (receiver) => String(receiver?.id || '').split(':')[0].toLowerCase();
        const rawIp = (host) => /^[0-9]{1,3}(?:[.][0-9]{1,3}){3}$/.test(host);
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

    let patched = source.replace(oldBlock, newBlock);

    patched = patched.replace(
      "  function failCurrentReceiver(message) {",
      `  function rememberCurrentReceiverHealth(success, reason = 'error') {
    const receiver = currentReceiver();
    const id = receiver?.id;
    if (!id) return;
    try {
      const key = 'signalScout:sdrHealth:v1';
      const health = JSON.parse(window.localStorage?.getItem(key) || '{}');
      const previous = health[id] || {};
      const timestamp = Date.now();
      if (success) {
        if (Number(previous.lastSuccess || 0) > timestamp - 2000) return;
        health[id] = {
          ...previous,
          failures: 0,
          cooldownUntil: 0,
          lastSuccess: timestamp,
          successes: Math.min(100, Number(previous.successes || 0) + 1)
        };
      } else {
        if (Number(previous.lastFailure || 0) > timestamp - 2000) return;
        const failures = Math.min(5, Number(previous.failures || 0) + 1);
        const baseMinutes = reason === 'busy' ? 2 : (reason === 'offline' ? 30 : (reason === 'timeout' ? 8 : 5));
        const cooldownMinutes = Math.min(30, Math.round(baseMinutes * Math.pow(1.4, Math.max(0, failures - 1))));
        health[id] = {
          ...previous,
          failures,
          lastFailure: timestamp,
          lastFailureReason: reason,
          cooldownUntil: timestamp + cooldownMinutes * 60 * 1000
        };
      }
      window.localStorage?.setItem(key, JSON.stringify(health));
    } catch {}
  }

  function failureReasonFromMessage(message) {
    const text = String(message || '').toLowerCase();
    if (text.includes('full') || text.includes('busy')) return 'busy';
    if (text.includes('offline')) return 'offline';
    if (text.includes('timed out') || text.includes('did not answer')) return 'timeout';
    return 'error';
  }

  function failCurrentReceiver(message) {
    rememberCurrentReceiverHealth(false, failureReasonFromMessage(message));`
    );

    patched = patched.replace(
      "    window.setTimeout(() => connectSdr(next), 450);",
      "    window.setTimeout(() => connectSdr(next), 75);"
    );

    patched = patched.replace(
      `    sdr.connectTimer = window.setTimeout(() => {
      if (!sdr.gotAudio) failCurrentReceiver('Receiver timed out. Trying the next ranked receiver…');
    }, 9000);`,
      `    const receiverWaitMs = receiver?.connectionHealth === 'recent-success' ? 3000 : 2200;
    sdr.connectTimer = window.setTimeout(() => {
      if (!sdr.gotAudio) failCurrentReceiver('Receiver timed out. Trying the next ranked receiver…');
    }, receiverWaitMs);`
    );

    patched = patched.replace(
      "    sdr.manualStop = false;\n    sdr.fallbackTried.clear();",
      "    sdr.manualStop = false;\n    sdr.manualReceiverId = null;\n    sdr.fallbackTried.clear();"
    );

    patched = patched.replace(
      "    if (!sdr.gotAudio) {\n      sdr.gotAudio = true;",
      "    if (!sdr.gotAudio) {\n      rememberCurrentReceiverHealth(true);\n      sdr.gotAudio = true;"
    );

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
    html = html.replace(/sdr-receiver-runtime-v3\.js\?v=\d+/g, 'sdr-receiver-runtime-v3.js?v=5');
    html = html.replace(/sdr-player\.js\?v=\d+(?:&sdrdiag=\d+)?/g, 'sdr-player.js?v=7');
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
