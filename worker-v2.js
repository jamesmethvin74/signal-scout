import baseWorker from './worker-base.js';

const DIRECTORY_URL = 'https://www.receiverbook.de/map?type=kiwisdr';
const DIRECTORY_MEMORY_TTL_MS = 10 * 60 * 1000;
const NEW_TSTAMP_SPACE = 1n << 62n;
const LOWER_TSTAMP_MASK = NEW_TSTAMP_SPACE - 1n;

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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/sdr/ws') return proxySdrWebSocket(request);
    return baseWorker.fetch(request, env, ctx);
  }
};
