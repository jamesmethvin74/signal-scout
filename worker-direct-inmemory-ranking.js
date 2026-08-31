import baseWorker from './worker-receiver-json-fast.js';

const DIRECT_MARKER = 'receiver-direct-inmemory-recovery-v2';
const HEALTH_MARKER = 'sdr-health-native-watchdog-v1';
const RF_SND_FIRST_MARKER = 'rf-snd-first-v1';

function patchRuntime(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;

  return response.text().then((source) => {
    const oldExport = "  window.__freqbeaconReceiverRuntime={version:VERSION,get livePoolCount(){return livePool.receivers.length;},get livePoolUpdatedAt(){return livePool.updatedAt;}};";
    const newExport = `  window.__freqbeaconReceiverRuntime={
    version:'receiver-runtime-v7-direct-inmemory-recovery',
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
      const receivers = Number.isFinite(context.frequency) ? rankReceivers(context) : [];
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

function patchHealth(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;

  return response.text().then((source) => {
    // Leave the source watchdog at its native 5.5s. The previous 2.2s Worker
    // rewrite could kill a valid Cloudflare -> Kiwi handshake before the
    // player's own 9s connection budget had a chance to succeed.
    const patched = source;
    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/javascript; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-health-timeout', HEALTH_MARKER);
    return new Response(patched, { status: response.status, statusText: response.statusText, headers });
  });
}

function patchRf(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;

  return response.text().then((source) => {
    const oldLine = "      socket.addEventListener('open', () => startWaterfall(meta, socket), { once: true });";
    const newBlock = `      let rfStarted = false;
      const startRfOnce = () => {
        if (rfStarted) return;
        rfStarted = true;
        startWaterfall(meta, socket);
      };
      const inspectSndReady = (data) => {
        try {
          let bytes = null;
          if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
          else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          if (!bytes || bytes.length < 3) return;
          const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
          if (tag === 'SND') {
            startRfOnce();
            return;
          }
          if (tag === 'MSG' && bytes.length > 4) {
            const text = decoder.decode(bytes.subarray(4));
            if (/(?:^|\\s)sample_rate=[0-9.]+(?:\\s|$)/.test(text)) startRfOnce();
          }
        } catch {}
      };
      socket.addEventListener('message', (event) => {
        if (event.data instanceof Blob) {
          event.data.arrayBuffer().then((buffer) => inspectSndReady(buffer)).catch(() => {});
        } else {
          inspectSndReady(event.data);
        }
      });`;

    const patched = source.replace(oldLine, newBlock);
    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/javascript; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-rf-snd-first', patched === source ? 'rf-patch-miss' : RF_SND_FIRST_MARKER);
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
      'window.setTimeout(() => connectSdr(next), 450);',
      'window.setTimeout(() => connectSdr(next), 75);'
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
    html = html.replace(/sdr-receiver-runtime-v3\.js\?v=\d+/g, 'sdr-receiver-runtime-v3.js?v=8');
    html = html.replace(/sdr-player\.js\?v=\d+(?:&sdrdiag=\d+)?/g, 'sdr-player.js?v=8');
    html = html.replace(/sdr-health\.js\?v=\d+/g, 'sdr-health.js?v=9');
    html = html.replace(/sdr-rf-v2\.js\?v=\d+/g, 'sdr-rf-v2.js?v=9');
    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-direct-ranking', DIRECT_MARKER);
    headers.set('x-freqbeacon-rf-snd-first', RF_SND_FIRST_MARKER);
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
    if (request.method === 'GET' && url.pathname === '/sdr-health.js') {
      return patchHealth(response);
    }
    if (request.method === 'GET' && url.pathname === '/sdr-rf-v2.js') {
      return patchRf(response);
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