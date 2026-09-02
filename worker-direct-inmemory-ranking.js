import baseWorker from './worker-receiver-json-fast.js';

const DIRECT_MARKER = 'receiver-direct-inmemory-recovery-v2';
const NATIVE_SND_MARKER = 'native-snd-ownership-v1';
const PLAYER_OPEN_TIMEOUT_MS = 10000;
const PLAYER_AUDIO_TIMEOUT_MS = 10000;
const PLAYER_AUDIO_LEAD_SECONDS = 0.65;
const PLAYER_AUDIO_LOW_WATER_SECONDS = 0.10;

function jsResponse(response, source, markerName, markerValue) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/javascript; charset=utf-8');
  headers.set('cache-control', 'no-store, max-age=0');
  if (markerName) headers.set(markerName, markerValue);
  return new Response(source, { status: response.status, statusText: response.statusText, headers });
}

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
    return jsResponse(response, patched, 'x-freqbeacon-direct-ranking', patched === source ? 'runtime-patch-miss' : DIRECT_MARKER);
  });
}

function patchHealth(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;

  return response.text().then((source) => {
    const oldAssignment = '  window.WebSocket = HealthAwareWebSocket;';
    const eventBridge = `  // Native SND ownership: health observes explicit player events instead of\n  // wrapping window.WebSocket. It can no longer affect socket construction.\n  window.addEventListener('freqbeacon:snd-audio', (event) => {\n    const receiverId = event.detail?.receiverId;\n    if (receiverId) markSuccess(receiverId);\n  });\n  window.addEventListener('freqbeacon:snd-state', (event) => {\n    const receiverId = event.detail?.receiverId;\n    const reason = event.detail?.reason;\n    if (receiverId && (reason === 'busy' || reason === 'offline')) markFailure(receiverId, reason);\n  });`;
    const patched = source.replace(oldAssignment, eventBridge);
    return jsResponse(response, patched, 'x-freqbeacon-native-snd', patched === source ? 'health-patch-miss' : NATIVE_SND_MARKER);
  });
}

function patchRf(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;

  return response.text().then((source) => {
    const oldAssignment = '  window.WebSocket = RfSessionWebSocket;';
    const eventBridge = `  // Native SND ownership: RF no longer wraps the audio WebSocket. The player\n  // announces a fully initialized SND session, then RF opens the paired W/F\n  // socket with the same receiver/timestamp.\n  window.addEventListener('freqbeacon:snd-ready', (event) => {\n    const socket = event.detail?.socket;\n    const url = event.detail?.url;\n    const meta = parseSocketMeta(url);\n    if (!socket || meta?.stream !== 'SND') return;\n    if (state.sndSocket === socket && state.socket) return;\n    startWaterfall(meta, socket);\n    socket.addEventListener('close', () => {\n      if (state.sndSocket === socket) {\n        state.generation += 1;\n        state.sndSocket = null;\n        closeWaterfall('RF STOPPED');\n      }\n    }, { once: true });\n  });`;
    const patched = source.replace(oldAssignment, eventBridge);
    return jsResponse(response, patched, 'x-freqbeacon-native-snd', patched === source ? 'rf-patch-miss' : NATIVE_SND_MARKER);
  });
}

function patchTuning(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;

  return response.text().then((source) => {
    const oldAssignment = '  window.WebSocket = TuningWebSocket;';
    const eventBridge = `  // Native SND ownership: tuning observes the player's native socket instead\n  // of wrapping WebSocket construction.\n  window.addEventListener('freqbeacon:snd-created', (event) => {\n    const socket = event.detail?.socket;\n    if (!socket) return;\n    state.sndSocket = socket;\n    state.sessionApplied = false;\n    socket.addEventListener('close', () => {\n      if (state.sndSocket === socket) {\n        state.sndSocket = null;\n        state.sessionApplied = false;\n      }\n    }, { once: true });\n  });\n  window.addEventListener('freqbeacon:snd-ready', (event) => {\n    const socket = event.detail?.socket;\n    if (!socket || state.sndSocket !== socket) return;\n    state.sessionApplied = true;\n    if (Number.isFinite(state.manualKHz)) window.setTimeout(() => performTune(), 0);\n  });`;
    const patched = source.replace(oldAssignment, eventBridge);
    return jsResponse(response, patched, 'x-freqbeacon-native-snd', patched === source ? 'tuning-patch-miss' : NATIVE_SND_MARKER);
  });
}

function patchPlayer(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;

  return response.text().then((source) => {
    const oldRecommendationBlock = `      const response = await fetch(recommendationUrl(frequency, container), {
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(\`Receiver directory HTTP \${response.status}\`);
      const payload = await response.json();`;

    const newRecommendationBlock = `      const directRuntime = window.__freqbeaconReceiverRuntime;
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

    let patched = source.replace(oldRecommendationBlock, newRecommendationBlock);
    patched = patched.replace(
      'window.setTimeout(() => connectSdr(next), 450);',
      'window.setTimeout(() => connectSdr(next), 75);'
    );

    const oldAudioLead = '    sdr.nextPlayTime = context.currentTime + 0.08;';
    const newAudioLead = `    // FREQBEACON mobile playout cushion: the clean diagnostic measured up to
    // 453 ms of Cloudflare-to-browser SND bunching while upstream Kiwi cadence
    // remained smooth. Keep enough Web Audio scheduled ahead to ride through it.
    sdr.nextPlayTime = context.currentTime + ${PLAYER_AUDIO_LEAD_SECONDS};`;
    patched = patched.replace(oldAudioLead, newAudioLead);

    const oldAudioSourceCreate = `    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(sdr.analyser);`;
    const newAudioSourceCreate = `    const source = context.createBufferSource();
    source.buffer = buffer;
    // Track scheduled chunks so a receiver switch can stop queued audio from the
    // old receiver instead of letting the larger jitter cushion bleed across.
    if (!sdr.scheduledSources) sdr.scheduledSources = new Set();
    sdr.scheduledSources.add(source);
    source.addEventListener('ended', () => sdr.scheduledSources?.delete(source), { once: true });
    source.connect(sdr.analyser);`;
    patched = patched.replace(oldAudioSourceCreate, newAudioSourceCreate);

    const oldAudioSchedule = '    if (sdr.nextPlayTime < now + 0.035 || sdr.nextPlayTime > now + 0.55) sdr.nextPlayTime = now + 0.055;';
    const newAudioSchedule = `    // Rebuffer only after a genuine underrun. Never collapse a healthy queued
    // cushion merely because burst delivery temporarily pushes it past 550 ms.
    if (sdr.nextPlayTime < now + ${PLAYER_AUDIO_LOW_WATER_SECONDS}) sdr.nextPlayTime = now + ${PLAYER_AUDIO_LEAD_SECONDS};`;
    patched = patched.replace(oldAudioSchedule, newAudioSchedule);

    const oldSocketOpen = `      socket = new WebSocket(websocketUrl(sdr.receiverIndex));
      socket.binaryType = 'arraybuffer';`;
    const newSocketOpen = `      const socketUrl = websocketUrl(sdr.receiverIndex);
      // The clean transport probe and the normal-app diagnostic both proved the
      // current page WebSocket constructor opens Kiwi SND reliably. The older
      // captured-constructor escape hatch can stall before OPEN on Android.
      socket = new WebSocket(socketUrl);
      socket.binaryType = 'arraybuffer';
      sdr.socketUrl = socketUrl;
      sdr.socketReceiverId = receiver?.id || null;
      sdr.sndReadySignaled = false;
      window.dispatchEvent(new CustomEvent('freqbeacon:snd-created', {
        detail: { socket, url: socketUrl, receiverId: sdr.socketReceiverId }
      }));`;
    patched = patched.replace(oldSocketOpen, newSocketOpen);

    const oldSocketOnOpen = `    socket.onopen = () => {
      sendSocket('SET auth t=kiwi p=#');
      sdr.keepaliveTimer = window.setInterval(() => sendSocket('SET keepalive'), 5000);
    };`;
    const newSocketOnOpen = `    socket.onopen = () => {
      // OPEN is real progress. Give this opened Kiwi session its own bounded
      // window to finish auth/config instead of inheriting time already spent
      // on the mobile WebSocket upgrade.
      window.clearTimeout(sdr.connectTimer);
      sdr.connectTimer = window.setTimeout(() => {
        if (!sdr.gotAudio) failCurrentReceiver('Receiver opened but audio did not start. Trying the next ranked receiver…');
      }, ${PLAYER_AUDIO_TIMEOUT_MS});
      sendSocket('SET auth t=kiwi p=#');
      sdr.keepaliveTimer = window.setInterval(() => sendSocket('SET keepalive'), 5000);
    };`;
    patched = patched.replace(oldSocketOnOpen, newSocketOnOpen);

    const oldSampleRate = `      if (sampleRate) {
        sdr.sampleRate = Number(sampleRate) || sdr.sampleRate;
        configureSdr();
      }`;
    const newSampleRate = `      if (sampleRate) {
        sdr.sampleRate = Number(sampleRate) || sdr.sampleRate;
        configureSdr();
        // sample_rate is another positive handshake milestone. Refresh the
        // bounded audio-start window before clearing Kiwi's AR_OK gate.
        window.clearTimeout(sdr.connectTimer);
        sdr.connectTimer = window.setTimeout(() => {
          if (!sdr.gotAudio) failCurrentReceiver('Receiver configured but audio did not start. Trying the next ranked receiver…');
        }, ${PLAYER_AUDIO_TIMEOUT_MS});
        // Kiwi requires AR_OK as part of CMD_SND_ALL before audio frames start.
        // Send it from the real player session immediately after sample_rate.
        const arInputRate = Math.max(1, Math.round(Number(sdr.sampleRate) || 12000));
        const arOutputRate = Math.max(1, Math.round(Number(sdr.audioContext?.sampleRate) || 48000));
        sendSocket(\`SET AR OK in=\${arInputRate} out=\${arOutputRate}\`);
      }`;
    patched = patched.replace(oldSampleRate, newSampleRate);

    const oldSndGate = `    if (tag !== 'SND' || bytes.byteLength < 10) return;
    const body = bytes.subarray(3);`;
    const newSndGate = `    if (tag !== 'SND' || bytes.byteLength < 10) return;
    if (!sdr.sndReadySignaled) {
      sdr.sndReadySignaled = true;
      window.dispatchEvent(new CustomEvent('freqbeacon:snd-ready', {
        detail: { socket: sdr.socket, url: sdr.socketUrl, receiverId: sdr.socketReceiverId }
      }));
    }
    const body = bytes.subarray(3);`;
    patched = patched.replace(oldSndGate, newSndGate);

    patched = patched.replace(
      `      if (/(?:^|\\s)too_busy=1(?:\\s|$)/.test(text)) failCurrentReceiver('Receiver is full. Trying the next ranked receiver…');`,
      `      if (/(?:^|\\s)too_busy=1(?:\\s|$)/.test(text)) {\n        window.dispatchEvent(new CustomEvent('freqbeacon:snd-state', { detail: { receiverId: sdr.socketReceiverId, reason: 'busy' } }));\n        failCurrentReceiver('Receiver is full. Trying the next ranked receiver…');\n      }`
    );
    patched = patched.replace(
      `      if (/(?:^|\\s)down=1(?:\\s|$)/.test(text)) failCurrentReceiver('Receiver is offline. Trying the next ranked receiver…');`,
      `      if (/(?:^|\\s)down=1(?:\\s|$)/.test(text)) {\n        window.dispatchEvent(new CustomEvent('freqbeacon:snd-state', { detail: { receiverId: sdr.socketReceiverId, reason: 'offline' } }));\n        failCurrentReceiver('Receiver is offline. Trying the next ranked receiver…');\n      }`
    );

    const oldGotAudio = `    if (!sdr.gotAudio) {
      sdr.gotAudio = true;
      sdr.connected = true;`;
    const newGotAudio = `    if (!sdr.gotAudio) {
      sdr.gotAudio = true;
      window.dispatchEvent(new CustomEvent('freqbeacon:snd-audio', {
        detail: { socket: sdr.socket, url: sdr.socketUrl, receiverId: sdr.socketReceiverId }
      }));
      sdr.connected = true;`;
    patched = patched.replace(oldGotAudio, newGotAudio);

    const oldDisconnectReset = `    sdr.connected = false;
    sdr.configured = false;
    sdr.gotAudio = false;`;
    const newDisconnectReset = `    if (sdr.scheduledSources) {
      for (const scheduledSource of sdr.scheduledSources) {
        try { scheduledSource.stop(); } catch {}
      }
      sdr.scheduledSources.clear();
    }
    sdr.nextPlayTime = sdr.audioContext?.currentTime || 0;
    sdr.connected = false;
    sdr.configured = false;
    sdr.gotAudio = false;
    sdr.socketUrl = null;
    sdr.socketReceiverId = null;
    sdr.sndReadySignaled = false;`;
    patched = patched.replace(oldDisconnectReset, newDisconnectReset);

    const oldConnectTimeout = `    sdr.connectTimer = window.setTimeout(() => {
      if (!sdr.gotAudio) failCurrentReceiver('Receiver timed out. Trying the next ranked receiver…');
    }, 9000);`;
    const newConnectTimeout = `    // Initial deadline covers only the WebSocket OPEN phase. Once OPEN or
    // sample_rate arrives, those handlers refresh the deadline because the
    // receiver is demonstrably progressing.
    sdr.connectTimer = window.setTimeout(() => {
      if (!sdr.gotAudio) failCurrentReceiver('Receiver did not open in time. Trying the next ranked receiver…');
    }, ${PLAYER_OPEN_TIMEOUT_MS});`;
    patched = patched.replace(oldConnectTimeout, newConnectTimeout);

    const patchesApplied = [
      oldAudioLead,
      oldAudioSourceCreate,
      oldAudioSchedule,
      oldSocketOpen,
      oldSocketOnOpen,
      oldSampleRate,
      oldSndGate,
      oldGotAudio,
      oldDisconnectReset,
      oldConnectTimeout
    ].every((needle) => source.includes(needle));

    return jsResponse(response, patched, 'x-freqbeacon-native-snd', patchesApplied ? NATIVE_SND_MARKER : 'player-patch-miss');
  });
}

function patchRoot(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;
  return response.text().then((html) => {
    html = html.replace(/sdr-receiver-runtime-v3\.js\?v=\d+/g, 'sdr-receiver-runtime-v3.js?v=8');
    html = html.replace(/sdr-player\.js\?v=\d+(?:&sdrdiag=\d+)?/g, 'sdr-player.js?v=10');
    html = html.replace(/sdr-health\.js\?v=\d+/g, 'sdr-health.js?v=10');
    html = html.replace(/sdr-rf-v2\.js\?v=\d+/g, 'sdr-rf-v2.js?v=10');
    html = html.replace(/sdr-tuning\.js\?v=\d+/g, 'sdr-tuning.js?v=2');
    if (!html.includes('sdr-lifecycle-diagnostics.js')) {
      html = html.replace(
        '<script src="sdr-live-reliability.js?v=1"></script>',
        '<script src="sdr-lifecycle-diagnostics.js?v=1"></script>\n  <script src="sdr-live-reliability.js?v=1"></script>'
      );
    }
    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-direct-ranking', DIRECT_MARKER);
    headers.set('x-freqbeacon-native-snd', NATIVE_SND_MARKER);
    headers.set('x-freqbeacon-sdr-lifecycle', 'sdr-lifecycle-diagnostics-v1');
    return new Response(html, { status: response.status, statusText: response.statusText, headers });
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await baseWorker.fetch(request, env, ctx);

    if (request.method === 'GET' && url.pathname === '/sdr-receiver-runtime-v3.js') return patchRuntime(response);
    if (request.method === 'GET' && url.pathname === '/sdr-health.js') return patchHealth(response);
    if (request.method === 'GET' && url.pathname === '/sdr-rf-v2.js') return patchRf(response);
    if (request.method === 'GET' && url.pathname === '/sdr-tuning.js') return patchTuning(response);
    if (request.method === 'GET' && url.pathname === '/sdr-player.js') return patchPlayer(response);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return patchRoot(response);
    return response;
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') {
      return baseWorker.scheduled(event, env, ctx);
    }
  }
};
