import baseWorker from './worker-base.js';

const DIRECTORY_URL = 'https://www.receiverbook.de/map?type=kiwisdr';
const DIRECTORY_MEMORY_TTL_MS = 10 * 60 * 1000;
const NEW_TSTAMP_SPACE = 1n << 62n;
const LOWER_TSTAMP_MASK = NEW_TSTAMP_SPACE - 1n;
const PLAYER_STARTUP_MARKER = 'sdr-player-startup-window-v1';
const PLAYER_DIAGNOSTIC_MARKER = 'sdr-normal-player-events-v1';
const RF_DIAGNOSTIC_MARKER = 'sdr-normal-rf-events-v1';
const NORMAL_DIAGNOSTIC_SCRIPT = 'sdr-normal-session-diagnostics.js?v=1';

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

async function patchSdrPlayerStartup(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;

  let source = await response.text();
  const oldBlock = `    sdr.connectTimer = window.setTimeout(() => {\n      if (!sdr.gotAudio) failCurrentReceiver('Receiver timed out. Trying the next ranked receiver…');\n    }, 9000);`;
  const newBlock = `    sdr.connectTimer = window.setTimeout(() => {\n      if (!sdr.gotAudio) failCurrentReceiver('Receiver timed out. Trying the next ranked receiver…');\n    }, 30000);`;
  const startupApplied = source.includes(oldBlock);
  if (startupApplied) source = source.replace(oldBlock, newBlock);

  const socketAnchor = `    sdr.socket = socket;\n\n    socket.onopen = () => {`;
  const socketReplacement = `    sdr.socket = socket;\n    try {\n      window.dispatchEvent(new CustomEvent('freqbeacon:snd-created', {\n        detail: { socket, url: socket.url || websocketUrl(sdr.receiverIndex), receiverId: currentReceiver()?.id || '' }\n      }));\n    } catch {}\n\n    socket.onopen = () => {`;
  const socketEventApplied = source.includes(socketAnchor);
  if (socketEventApplied) source = source.replace(socketAnchor, socketReplacement);

  const readyAnchor = `    sendSocket('SET de_emp=0');\n  }`;
  const readyReplacement = `    sendSocket('SET de_emp=0');\n    try {\n      window.dispatchEvent(new CustomEvent('freqbeacon:snd-ready', {\n        detail: { socket: sdr.socket, receiverId: currentReceiver()?.id || '', sampleRate: sdr.sampleRate }\n      }));\n    } catch {}\n  }`;
  const readyEventApplied = source.includes(readyAnchor);
  if (readyEventApplied) source = source.replace(readyAnchor, readyReplacement);

  const audioAnchor = `      sdr.gotAudio = true;\n      sdr.connected = true;`;
  const audioReplacement = `      sdr.gotAudio = true;\n      sdr.connected = true;\n      try {\n        window.dispatchEvent(new CustomEvent('freqbeacon:snd-audio', {\n          detail: {\n            socket: sdr.socket,\n            receiverId: currentReceiver()?.id || '',\n            audioContextState: sdr.audioContext?.state || null,\n            audioContextCurrentTime: sdr.audioContext?.currentTime ?? null,\n            sampleRate: sdr.sampleRate,\n            nextPlayTime: sdr.nextPlayTime\n          }\n        }));\n      } catch {}`;
  const audioEventApplied = source.includes(audioAnchor);
  if (audioEventApplied) source = source.replace(audioAnchor, audioReplacement);

  const diagnosticApplied = socketEventApplied && readyEventApplied && audioEventApplied;
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/javascript; charset=utf-8');
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set('x-freqbeacon-sdr-player-startup', startupApplied ? PLAYER_STARTUP_MARKER : 'startup-window-patch-miss');
  headers.set('x-freqbeacon-sdr-normal-diagnostics', diagnosticApplied ? PLAYER_DIAGNOSTIC_MARKER : 'normal-player-diagnostic-patch-miss');
  return new Response(source, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function patchRfDiagnostics(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;
  let source = await response.text();

  const anchor = `  function setStage(stage, title, detail = '', error = false) {\n    state.lastStage = stage;\n    state.lastError = error ? detail || title : '';`;
  const replacement = `  function setStage(stage, title, detail = '', error = false) {\n    state.lastStage = stage;\n    state.lastError = error ? detail || title : '';\n    try {\n      window.dispatchEvent(new CustomEvent('freqbeacon:rf-stage', {\n        detail: {\n          stage, title, detail, error,\n          receiverId: state.receiverId, timestamp: state.timestamp,\n          frameCount: state.frameCount, binaryCount: state.binaryCount, msgCount: state.msgCount,\n          unsupportedFrames: state.unsupportedFrames, lastFrameBytes: state.lastFrameBytes,\n          wfSetupSeen: state.wfSetupSeen, configured: state.configured, hasFrame: state.hasFrame\n        }\n      }));\n    } catch {}`;
  const applied = source.includes(anchor);
  if (applied) source = source.replace(anchor, replacement);

  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/javascript; charset=utf-8');
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set('x-freqbeacon-rf-normal-diagnostics', applied ? RF_DIAGNOSTIC_MARKER : 'normal-rf-diagnostic-patch-miss');
  return new Response(source, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function injectNormalDiagnostics(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;
  let html = await response.text();
  const tag = `<script src="${NORMAL_DIAGNOSTIC_SCRIPT}"></script>`;
  if (!html.includes('sdr-normal-session-diagnostics.js')) html = html.replace('</body>', `${tag}\n</body>`);
  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set('x-freqbeacon-sdr-normal-diagnostics', 'normal-session-diagnostics-v1');
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
    if (url.pathname === '/sdr-rf-v2.js') {
      return patchRfDiagnostics(await baseWorker.fetch(request, env, ctx));
    }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return injectNormalDiagnostics(await baseWorker.fetch(request, env, ctx));
    }
    return baseWorker.fetch(request, env, ctx);
  }
};
