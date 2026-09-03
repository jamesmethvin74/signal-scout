import baseWorker from './worker-base.js';

const DIRECTORY_URL = 'https://www.receiverbook.de/map?type=kiwisdr';
const DIRECTORY_MEMORY_TTL_MS = 10 * 60 * 1000;
const NEW_TSTAMP_SPACE = 1n << 62n;
const LOWER_TSTAMP_MASK = NEW_TSTAMP_SPACE - 1n;
const PLAYER_STARTUP_MARKER = 'sdr-player-startup-window-v1';
const PLAYER_AUDIO_MARKER = 'sdr-player-audio-chunking-v1';
const DUAL_STREAM_TRACE_MARKER = 'sdr-dual-stream-trace-v1';

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

async function resolveReceiver(receiverId) {
  const legacyUrl = LEGACY_RECEIVERS[receiverId];
  if (legacyUrl) return normalizeReceiverUrl(legacyUrl);
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
    receiver = await resolveReceiver(receiverId);
  } catch (error) {
    return new Response(`Receiver directory unavailable: ${error?.message || 'lookup failed'}`, { status: 502 });
  }
  if (!receiver?.upstreamHost || isBlockedHost(receiver.hostname)) {
    return new Response('Unknown SDR receiver', { status: 400 });
  }

  const upstreamTimestamp = proxySafeTimestamp(timestamp);
  const upstreamScheme = receiver.protocol === 'https:' ? 'https:' : 'http:';
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

async function patchSdrPlayerStartup(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;

  let source = await response.text();
  const oldTimeout = `    sdr.connectTimer = window.setTimeout(() => {\n      if (!sdr.gotAudio) failCurrentReceiver('Receiver timed out. Trying the next ranked receiver…');\n    }, 9000);`;
  const newTimeout = `    sdr.connectTimer = window.setTimeout(() => {\n      if (!sdr.gotAudio) failCurrentReceiver('Receiver timed out. Trying the next ranked receiver…');\n    }, 30000);`;
  const startupApplied = source.includes(oldTimeout);
  if (startupApplied) source = source.replace(oldTimeout, newTimeout);

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

  const audioApplied = scheduleApplied && pcmApplied && disconnectApplied;
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/javascript; charset=utf-8');
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set('x-freqbeacon-sdr-player-startup', startupApplied ? PLAYER_STARTUP_MARKER : 'startup-window-patch-miss');
  headers.set('x-freqbeacon-sdr-player-audio', audioApplied ? PLAYER_AUDIO_MARKER : 'audio-chunking-patch-miss');
  return new Response(source, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function patchTracePage(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();
  const scriptTag = '<script src="sdr-dual-stream-trace.js?v=1"></script>';
  let applied = html.includes(scriptTag);
  if (!applied) {
    const anchor = '<script src="sdr-rf-v2.js';
    const index = html.indexOf(anchor);
    if (index >= 0) {
      html = `${html.slice(0, index)}${scriptTag}\n  ${html.slice(index)}`;
      applied = true;
    }
  }

  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set('x-freqbeacon-sdr-dual-trace', applied ? DUAL_STREAM_TRACE_MARKER : 'dual-stream-trace-patch-miss');
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/sdr/ws') return proxySdrWebSocket(request);
    if (url.pathname === '/sdr-player.js') {
      return patchSdrPlayerStartup(await baseWorker.fetch(request, env, ctx));
    }
    if (
      request.method === 'GET'
      && (url.pathname === '/' || url.pathname === '/index.html')
      && url.searchParams.get('sdrtrace') === '1'
    ) {
      return patchTracePage(await baseWorker.fetch(request, env, ctx));
    }
    return baseWorker.fetch(request, env, ctx);
  }
};
