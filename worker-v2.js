import baseWorker from './worker-base.js';

const DIRECTORY_URL = 'https://www.receiverbook.de/map?type=kiwisdr';
const DIRECTORY_MEMORY_TTL_MS = 10 * 60 * 1000;
const SHARED_DIRECTORY_CACHE_PATHS = [
  '/__cache/sdr-directory-v4-fresh',
  '/__cache/sdr-directory-v4-last-good'
];
const NEW_TSTAMP_SPACE = 1n << 62n;
const LOWER_TSTAMP_MASK = NEW_TSTAMP_SPACE - 1n;
const PLAYER_AUDIO_MARKER = 'sdr-player-audio-chunking-v1';
const PLAYER_VISUALIZER_MARKER = 'sdr-player-disable-hidden-legacy-spectrum-v1';
const PLAYER_CARRIER_MARKER = 'sdr-player-carrier-aware-failover-v1';

const LEGACY_RECEIVERS = {
  florida: 'http://22315.proxy.kiwisdr.com',
  'north-carolina': 'http://22904.proxy.kiwisdr.com',
  pennsylvania: 'http://22479.proxy.kiwisdr.com'
};

let directoryMemory = null;
let directoryMemoryAt = 0;

function isBlockedHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '0.0.0.0' || host === '::' || host === '::1') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const private172 = host.match(/^172\.(\d+)\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true;
  if (/^(?:fc|fd|fe80):/i.test(host)) return true;
  return false;
}

function normalizeReceiverUrl(rawUrl) {
  if (!rawUrl) return null;
  let parsed;
  try {
    parsed = new URL(String(rawUrl).trim());
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || isBlockedHost(parsed.hostname)) return null;
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  return {
    id: `${parsed.hostname.toLowerCase()}:${port}`,
    upstreamHost: parsed.host,
    hostname: parsed.hostname.toLowerCase(),
    protocol: parsed.protocol
  };
}

function parseReceiverBook(html) {
  const match = String(html || '').match(/var\s+receivers\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) throw new Error('Receiver directory format was not recognized');
  const sites = JSON.parse(match[1]);
  if (!Array.isArray(sites)) throw new Error('Receiver directory did not contain a receiver list');

  const byId = new Map();
  for (const site of sites) {
    const children = Array.isArray(site?.receivers) && site.receivers.length ? site.receivers : [site];
    for (const child of children) {
      const typeText = [child?.type, child?.version, child?.software].filter(Boolean).join(' ');
      if (typeText && /(?:openwebrx|websdr)/i.test(typeText) && !/kiwi/i.test(typeText)) continue;
      const receiver = normalizeReceiverUrl(child?.url || site?.url);
      if (receiver && !byId.has(receiver.id)) byId.set(receiver.id, receiver);
    }
  }
  return byId;
}

async function receiverDirectory() {
  const now = Date.now();
  if (directoryMemory && now - directoryMemoryAt < DIRECTORY_MEMORY_TTL_MS) return directoryMemory;

  const response = await fetch(DIRECTORY_URL, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': 'SignalScout/1.0 (+public SDR receiver discovery)'
    },
    cf: { cacheTtl: 15 * 60, cacheEverything: true }
  });
  if (!response.ok) throw new Error(`Receiver directory HTTP ${response.status}`);
  directoryMemory = parseReceiverBook(await response.text());
  directoryMemoryAt = now;
  return directoryMemory;
}

function normalizedCachedReceiver(receiver) {
  if (!receiver || typeof receiver !== 'object') return null;
  const rawUrl = receiver.url
    || (receiver.upstreamHost ? `${receiver.protocol === 'https:' ? 'https:' : 'http:'}//${receiver.upstreamHost}` : '')
    || (receiver.host ? `${receiver.protocol === 'https:' ? 'https:' : 'http:'}//${receiver.host}` : '');
  return normalizeReceiverUrl(rawUrl);
}

async function resolveReceiverFromSharedCache(request, receiverId) {
  const cache = caches.default;
  for (const path of SHARED_DIRECTORY_CACHE_PATHS) {
    try {
      const key = new Request(new URL(path, request.url).toString(), { method: 'GET' });
      const cached = await cache.match(key);
      if (!cached) continue;
      const payload = await cached.json();
      if (!Array.isArray(payload?.receivers)) continue;
      const match = payload.receivers.find((receiver) => receiver?.id === receiverId || receiver?.host === receiverId);
      const normalized = normalizedCachedReceiver(match);
      if (normalized?.id === receiverId) return normalized;
    } catch {
      // The shared cache is advisory. Fall through to live ReceiverBook lookup.
    }
  }
  return null;
}

async function resolveReceiver(request, receiverId) {
  const legacyUrl = LEGACY_RECEIVERS[receiverId];
  if (legacyUrl) return normalizeReceiverUrl(legacyUrl);

  const shared = await resolveReceiverFromSharedCache(request, receiverId);
  if (shared) return shared;

  const directory = await receiverDirectory();
  return directory.get(receiverId) || null;
}

function proxySafeTimestamp(timestamp) {
  const lower = BigInt(timestamp) & LOWER_TSTAMP_MASK;
  return (NEW_TSTAMP_SPACE | lower).toString();
}

async function proxySdrWebSocket(request) {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  const url = new URL(request.url);
  const receiverId = url.searchParams.get('receiver') || '';
  const stream = url.searchParams.get('stream') || 'SND';
  const timestamp = url.searchParams.get('ts') || '';
  if (!receiverId || receiverId.length > 180 || !['SND', 'W/F'].includes(stream) || !/^\d{1,10}$/.test(timestamp)) {
    return new Response('Invalid SDR request', { status: 400 });
  }

  let receiver;
  try {
    receiver = await resolveReceiver(request, receiverId);
  } catch (error) {
    return new Response(`Receiver directory unavailable: ${error?.message || 'lookup failed'}`, { status: 502 });
  }
  if (!receiver?.upstreamHost || isBlockedHost(receiver.hostname)) {
    return new Response('Unknown SDR receiver', { status: 400 });
  }

  // KiwiSDR links SND and W/F by timestamp. Current Kiwi firmware reserves bit
  // 62 as NEW_TSTAMP_SPACE: when set, paired streams may arrive from different
  // source IPs. This matters behind Cloudflare because two outbound WebSockets
  // are not guaranteed to use the same egress IP.
  const upstreamTimestamp = proxySafeTimestamp(timestamp);
  const upstreamScheme = receiver.protocol === 'https:' ? 'https:' : 'http:';
  // Current Kiwi 1.9xx treats the native browser UI WebSocket separately from
  // the external/kiwirecorder form. Use the native UI route so receivers with
  // external API channels disabled can still serve normal interactive SND/W/F.
  const upstreamUrl = `${upstreamScheme}//${receiver.upstreamHost}/ws/kiwi/${upstreamTimestamp}/${stream}`;

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        Upgrade: 'websocket',
        Origin: `${upstreamScheme}//${receiver.upstreamHost}`,
        'User-Agent': 'FREQBEACON/1.0 interactive KiwiSDR client'
      }
    });
    if (!upstreamResponse.webSocket) {
      return new Response(`Receiver refused WebSocket (${upstreamResponse.status})`, { status: 502 });
    }
    return upstreamResponse;
  } catch (error) {
    return new Response(`Receiver unavailable: ${error?.message || 'connection failed'}`, { status: 502 });
  }
}

async function probeSdrReceiver(request) {
  const url = new URL(request.url);
  const receiverId = url.searchParams.get('receiver') || '';
  const stream = url.searchParams.get('stream') || 'SND';
  const result = {
    probe: 'direct-worker-upstream-websocket-v1',
    receiverId,
    stream,
    resolved: false,
    upstreamHost: null,
    upstreamProtocol: null,
    upstreamStatus: null,
    webSocketAccepted: false,
    elapsedMs: null,
    error: null
  };
  const respond = () => new Response(JSON.stringify(result, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0'
    }
  });

  if (!receiverId || receiverId.length > 180 || !['SND', 'W/F'].includes(stream)) {
    result.error = 'invalid probe request';
    return respond();
  }

  let receiver;
  try {
    receiver = await resolveReceiver(request, receiverId);
  } catch (error) {
    result.error = `directory: ${error?.message || 'lookup failed'}`;
    return respond();
  }
  if (!receiver?.upstreamHost || isBlockedHost(receiver.hostname)) {
    result.error = 'receiver did not resolve to a permitted upstream host';
    return respond();
  }

  result.resolved = true;
  result.upstreamHost = receiver.upstreamHost;
  result.upstreamProtocol = receiver.protocol;

  const timestamp = String(Math.floor(Date.now() / 1000) % 10000000000);
  const upstreamTimestamp = proxySafeTimestamp(timestamp);
  const upstreamScheme = receiver.protocol === 'https:' ? 'https:' : 'http:';
  const upstreamUrl = `${upstreamScheme}//${receiver.upstreamHost}/ws/kiwi/${upstreamTimestamp}/${stream}`;
  const started = Date.now();
  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        Upgrade: 'websocket',
        Origin: `${upstreamScheme}//${receiver.upstreamHost}`,
        'User-Agent': 'FREQBEACON/1.0 interactive KiwiSDR client'
      }
    });
    result.elapsedMs = Date.now() - started;
    result.upstreamStatus = upstreamResponse.status;
    result.webSocketAccepted = Boolean(upstreamResponse.webSocket);
    if (!upstreamResponse.webSocket) {
      result.error = `upstream refused WebSocket (${upstreamResponse.status})`;
    } else {
      try { upstreamResponse.webSocket.close(1000, 'FREQBEACON diagnostic probe complete'); } catch {}
    }
  } catch (error) {
    result.elapsedMs = Date.now() - started;
    result.error = `upstream fetch: ${error?.message || 'connection failed'}`;
  }
  return respond();
}

async function patchSdrPlayerRuntime(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;

  let source = await response.text();
  const oldSchedule = `  function scheduleAudio(samples) {\n    const context = sdr.audioContext;\n    if (!context || context.state === 'closed' || !samples?.length) return;\n    const sampleRate = Number.isFinite(sdr.sampleRate) && sdr.sampleRate > 1000 ? sdr.sampleRate : 12000;\n    const buffer = context.createBuffer(1, samples.length, sampleRate);\n    buffer.copyToChannel(samples, 0);\n    const source = context.createBufferSource();\n    source.buffer = buffer;\n    source.connect(sdr.analyser);\n    const now = context.currentTime;\n    if (sdr.nextPlayTime < now + 0.035 || sdr.nextPlayTime > now + 0.55) sdr.nextPlayTime = now + 0.055;\n    source.start(sdr.nextPlayTime);\n    sdr.nextPlayTime += samples.length / sampleRate;\n  }`;
  const newSchedule = `  const AUDIO_BATCH_FRAMES = 8;\n  const AUDIO_TARGET_LEAD_SECONDS = 0.18;\n\n  function scheduleAudio(samples) {\n    const context = sdr.audioContext;\n    if (!context || context.state === 'closed' || !samples?.length) return;\n    const sampleRate = Number.isFinite(sdr.sampleRate) && sdr.sampleRate > 1000 ? sdr.sampleRate : 12000;\n    const buffer = context.createBuffer(1, samples.length, sampleRate);\n    buffer.copyToChannel(samples, 0);\n    const source = context.createBufferSource();\n    source.buffer = buffer;\n    source.connect(sdr.analyser);\n    source.addEventListener('ended', () => {\n      try { source.disconnect(); } catch {}\n    }, { once: true });\n    const now = context.currentTime;\n    if (sdr.nextPlayTime < now + 0.05 || sdr.nextPlayTime > now + 1.5) sdr.nextPlayTime = now + AUDIO_TARGET_LEAD_SECONDS;\n    source.start(sdr.nextPlayTime);\n    sdr.nextPlayTime += samples.length / sampleRate;\n  }\n\n  function queueAudio(samples) {\n    if (!samples?.length) return;\n    if (!Array.isArray(sdr.audioFrameQueue)) sdr.audioFrameQueue = [];\n    sdr.audioFrameQueue.push(samples);\n    if (sdr.audioFrameQueue.length < AUDIO_BATCH_FRAMES) return;\n\n    let totalSamples = 0;\n    for (const frame of sdr.audioFrameQueue) totalSamples += frame.length;\n    const merged = new Float32Array(totalSamples);\n    let offset = 0;\n    for (const frame of sdr.audioFrameQueue) {\n      merged.set(frame, offset);\n      offset += frame.length;\n    }\n    sdr.audioFrameQueue.length = 0;\n    scheduleAudio(merged);\n  }`;
  const scheduleApplied = source.includes(oldSchedule);
  if (scheduleApplied) source = source.replace(oldSchedule, newSchedule);

  const oldPcmCall = `    scheduleAudio(decodePcm(audioBytes, littleEndian));`;
  const newPcmCall = `    queueAudio(decodePcm(audioBytes, littleEndian));`;
  const pcmApplied = source.includes(oldPcmCall);
  if (pcmApplied) source = source.replace(oldPcmCall, newPcmCall);

  const oldDisconnect = `    const socket = sdr.socket;\n    sdr.socket = null;\n    if (socket) {`;
  const newDisconnect = `    const socket = sdr.socket;\n    sdr.socket = null;\n    sdr.audioFrameQueue = [];\n    if (sdr.audioContext && sdr.audioContext.state !== 'closed') sdr.nextPlayTime = sdr.audioContext.currentTime;\n    if (socket) {`;
  const disconnectApplied = source.includes(oldDisconnect);
  if (disconnectApplied) source = source.replace(oldDisconnect, newDisconnect);

  const oldVisualizerStart = `  function startSpectrumAnimation() {\n    if (sdr.animationFrame) cancelAnimationFrame(sdr.animationFrame);\n    const canvas = playerEl('[data-sdr-canvas]');`;
  const newVisualizerStart = `  function startSpectrumAnimation() {\n    if (sdr.animationFrame) cancelAnimationFrame(sdr.animationFrame);\n    if (document.querySelector('[data-sdr-rf-v2-canvas]')) {\n      sdr.animationFrame = null;\n      return;\n    }\n    const canvas = playerEl('[data-sdr-canvas]');`;
  const oldDrawStart = `    const draw = () => {\n      if (!sdr.analyser || !sdr.audioContext || sdr.audioContext.state === 'closed') return;\n      const rect = canvas.getBoundingClientRect();`;
  const newDrawStart = `    const draw = () => {\n      if (!sdr.analyser || !sdr.audioContext || sdr.audioContext.state === 'closed') return;\n      if (document.querySelector('[data-sdr-rf-v2-canvas]')) {\n        sdr.animationFrame = null;\n        return;\n      }\n      const rect = canvas.getBoundingClientRect();`;
  const visualizerApplied = source.includes(oldVisualizerStart) && source.includes(oldDrawStart);
  if (visualizerApplied) {
    source = source.replace(oldVisualizerStart, newVisualizerStart);
    source = source.replace(oldDrawStart, newDrawStart);
  }

  const oldFailCurrent = `  function failCurrentReceiver(message) {\n    if (sdr.manualStop) return;\n    disconnectSocket();\n    setMessage(message, true);\n    const next = nextFallbackReceiver();\n    if (next == null) {\n      setStatus('Unavailable', false);\n      setMessage('The ranked public receivers did not answer. Tap Retry or choose another receiver.', true);\n      playerEl('[data-sdr-toggle]').textContent = 'Retry';\n      drawIdleSpectrum('NO RECEIVER');\n      return;\n    }\n    sdr.fallbackTried.add(next);\n    window.setTimeout(() => connectSdr(next), 450);\n  }`;
  const newFailCurrent = `  function failCurrentReceiver(\n    message,\n    finalMessage = 'The ranked public receivers did not answer. Tap Retry or choose another receiver.',\n    finalStatus = 'Unavailable'\n  ) {\n    if (sdr.manualStop) return;\n    disconnectSocket();\n    setMessage(message, true);\n    const next = nextFallbackReceiver();\n    if (next == null) {\n      setStatus(finalStatus, false);\n      setMessage(finalMessage, true);\n      playerEl('[data-sdr-toggle]').textContent = 'Retry';\n      drawIdleSpectrum(finalStatus === 'No signal' ? 'NO SIGNAL' : 'NO RECEIVER');\n      return;\n    }\n    sdr.fallbackTried.add(next);\n    window.setTimeout(() => connectSdr(next), 450);\n  }`;
  const failCurrentApplied = source.includes(oldFailCurrent);
  if (failCurrentApplied) source = source.replace(oldFailCurrent, newFailCurrent);

  const oldChooseReceiver = `  function chooseReceiver(index) {\n    if (!sdr.receivers[index]) return;\n    sdr.receiverIndex = index;`;
  const newChooseReceiver = `  function chooseReceiver(index) {\n    if (!sdr.receivers[index]) return;\n    sdr.carrierAuto = false;\n    sdr.carrierMisses = 0;\n    sdr.receiverIndex = index;`;
  const chooseReceiverApplied = source.includes(oldChooseReceiver);
  if (chooseReceiverApplied) source = source.replace(oldChooseReceiver, newChooseReceiver);

  const oldStartPlayer = `    sdr.mode = PASSBANDS[mode] ? mode : 'am';\n    sdr.manualStop = false;\n    sdr.fallbackTried.clear();`;
  const newStartPlayer = `    sdr.mode = PASSBANDS[mode] ? mode : 'am';\n    sdr.manualStop = false;\n    sdr.carrierAuto = true;\n    sdr.carrierMisses = 0;\n    sdr.carrierReceiverId = '';\n    sdr.fallbackTried.clear();`;
  const startPlayerApplied = source.includes(oldStartPlayer);
  if (startPlayerApplied) source = source.replace(oldStartPlayer, newStartPlayer);

  const oldConnectStart = `    sdr.receiverIndex = sdr.receivers[receiverIndex] ? receiverIndex : 0;\n    sdr.fallbackTried.add(sdr.receiverIndex);`;
  const newConnectStart = `    sdr.receiverIndex = sdr.receivers[receiverIndex] ? receiverIndex : 0;\n    sdr.carrierMisses = 0;\n    sdr.carrierReceiverId = currentReceiver()?.id || '';\n    sdr.fallbackTried.add(sdr.receiverIndex);`;
  const connectStartApplied = source.includes(oldConnectStart);
  if (connectStartApplied) source = source.replace(oldConnectStart, newConnectStart);

  const oldFirstAudio = `      setStatus('Live RF', true);\n      setMessage('Actual receiver audio · spectrum and waterfall are generated from the live audio stream.');`;
  const newFirstAudio = `      if (sdr.carrierAuto && ['am', 'sam'].includes(sdr.mode)) {\n        setStatus('Checking RF', false);\n        setMessage('Receiver audio connected. Checking for a carrier at the exact tuned frequency…');\n      } else {\n        setStatus('Live RF', true);\n        setMessage('Actual receiver audio · spectrum and waterfall are generated from the live audio stream.');\n      }`;
  const firstAudioApplied = source.includes(oldFirstAudio);
  if (firstAudioApplied) source = source.replace(oldFirstAudio, newFirstAudio);

  const carrierHandlerAnchor = `  function websocketUrl(receiverIndex) {`;
  const carrierHandler = `  function carrierAutoAllowed(detail) {\n    if (!sdr.carrierAuto || sdr.manualStop || !sdr.gotAudio) return false;\n    if (!['am', 'sam'].includes(sdr.mode)) return false;\n    const stationText = String(document.querySelector('[data-sdr-station]')?.textContent || '').trim().toLowerCase();\n    if (stationText === 'manual tuning') return false;\n    const receiver = currentReceiver();\n    if (detail?.receiverId && receiver?.id && detail.receiverId !== receiver.id) return false;\n    const target = Number(detail?.targetKHz);\n    if (Number.isFinite(target) && Number.isFinite(sdr.frequency) && Math.abs(target - sdr.frequency) > 0.4) return false;\n    return true;\n  }\n\n  function handleRfCarrier(event) {\n    const detail = event?.detail || {};\n    if (!carrierAutoAllowed(detail)) return;\n    const receiverId = currentReceiver()?.id || '';\n    if (sdr.carrierReceiverId !== receiverId) {\n      sdr.carrierReceiverId = receiverId;\n      sdr.carrierMisses = 0;\n    }\n    if (detail.carrierPresent === true) {\n      sdr.carrierMisses = 0;\n      setStatus('Live RF', true);\n      return;\n    }\n    if (detail.carrierPresent !== false) return;\n    sdr.carrierMisses = detail.unavailable ? 2 : Number(sdr.carrierMisses || 0) + 1;\n    if (sdr.carrierMisses < 2) return;\n    sdr.carrierMisses = 0;\n    const prominence = Number(detail.prominenceDb);\n    const suffix = Number.isFinite(prominence) ? ' (center carrier ' + prominence.toFixed(1) + ' dB above the local floor)' : '';\n    failCurrentReceiver(\n      'No usable carrier at ' + formatFrequency(sdr.frequency) + ' on this receiver' + suffix + '. Trying the next ranked receiver…',\n      'No usable carrier was heard at the tuned frequency on the available ranked receivers. The broadcast may be off air or below the remote receivers’ noise floor.',\n      'No signal'\n    );\n  }\n\n  window.addEventListener('freqbeacon:rf-carrier', handleRfCarrier);\n\n  function websocketUrl(receiverIndex) {`;
  const carrierHandlerApplied = source.includes(carrierHandlerAnchor) && !source.includes("window.addEventListener('freqbeacon:rf-carrier'");
  if (carrierHandlerApplied) source = source.replace(carrierHandlerAnchor, carrierHandler);

  const oldLiveClose = `    socket.onclose = () => {\n      if (!sdr.manualStop && !sdr.gotAudio) failCurrentReceiver('Receiver did not answer. Trying the next ranked receiver…');\n      else if (!sdr.manualStop && sdr.gotAudio) {\n        disconnectSocket();\n        setStatus('Disconnected', false);\n        setMessage('The public receiver disconnected. Tap Play to reconnect.', true);\n        playerEl('[data-sdr-toggle]').textContent = 'Play';\n      }\n    };`;
  const newLiveClose = `    socket.onclose = () => {\n      if (!sdr.manualStop && !sdr.gotAudio) failCurrentReceiver('Receiver did not answer. Trying the next ranked receiver…');\n      else if (!sdr.manualStop && sdr.gotAudio) {\n        failCurrentReceiver('The public receiver disconnected. Trying the next ranked receiver…');\n      }\n    };`;
  const liveCloseApplied = source.includes(oldLiveClose);
  if (liveCloseApplied) source = source.replace(oldLiveClose, newLiveClose);

  const audioApplied = scheduleApplied && pcmApplied && disconnectApplied;
  const carrierApplied = failCurrentApplied
    && chooseReceiverApplied
    && startPlayerApplied
    && connectStartApplied
    && firstAudioApplied
    && carrierHandlerApplied
    && liveCloseApplied;
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/javascript; charset=utf-8');
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set('x-freqbeacon-sdr-player-audio', audioApplied ? PLAYER_AUDIO_MARKER : 'audio-chunking-patch-miss');
  headers.set('x-freqbeacon-sdr-player-visualizer', visualizerApplied ? PLAYER_VISUALIZER_MARKER : 'legacy-spectrum-patch-miss');
  headers.set('x-freqbeacon-sdr-player-control', carrierApplied ? PLAYER_CARRIER_MARKER : 'carrier-aware-patch-miss');
  return new Response(source, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/sdr/probe') return probeSdrReceiver(request);
    if (url.pathname === '/api/sdr/ws') return proxySdrWebSocket(request);
    if (url.pathname === '/sdr-player.js') {
      return patchSdrPlayerRuntime(await baseWorker.fetch(request, env, ctx));
    }
    return baseWorker.fetch(request, env, ctx);
  }
};