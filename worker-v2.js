import baseWorker from './worker-base.js';
import { SDR_DIRECTORY_SEED, SDR_DIRECTORY_SEED_VERSION, rankSeedReceivers } from './sdr-directory-seed.js';

const DIRECTORY_URL = 'https://www.receiverbook.de/map?type=kiwisdr';
const DIRECTORY_MEMORY_TTL_MS = 10 * 60 * 1000;
const DIRECTORY_FETCH_TIMEOUT_MS = 4500;
const NEW_TSTAMP_SPACE = 1n << 62n;
const LOWER_TSTAMP_MASK = NEW_TSTAMP_SPACE - 1n;

const LEGACY_RECEIVERS = {
  florida: 'http://22315.proxy.kiwisdr.com',
  'north-carolina': 'http://22904.proxy.kiwisdr.com',
  pennsylvania: 'http://22479.proxy.kiwisdr.com'
};

// Current ReceiverBook publishes the KM4RT Tipton receiver under both its
// public IPv4 endpoint and a DDNS alias. Native Kiwi reaches the public endpoint
// immediately, while Cloudflare egress has been stalling on the DDNS route.
// Resolve both IDs to the current public endpoint before any directory lookup.
// This is transport routing only; the displayed receiver identity/ranking stays
// KM4RT Tipton and remains independent of the user's reception score.
const FAST_RECEIVER_ENDPOINTS = {
  'km4rt.ddns.net:8073': 'http://64.22.14.214:8073',
  '64.22.14.214:8073': 'http://64.22.14.214:8073'
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

function seedDirectory() {
  const byId = new Map();
  for (const seed of SDR_DIRECTORY_SEED) {
    const receiver = normalizeReceiverUrl(seed.url);
    if (receiver && receiver.id === seed.id && !byId.has(receiver.id)) byId.set(receiver.id, receiver);
  }
  return byId;
}

const SEED_DIRECTORY = seedDirectory();

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DIRECTORY_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(DIRECTORY_URL, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'SignalScout/1.0 (+public SDR receiver discovery)'
      },
      signal: controller.signal,
      cf: { cacheTtl: 15 * 60, cacheEverything: true }
    });
    if (!response.ok) throw new Error(`Receiver directory HTTP ${response.status}`);
    directoryMemory = parseReceiverBook(await response.text());
    directoryMemoryAt = now;
    return directoryMemory;
  } finally {
    clearTimeout(timer);
  }
}

async function resolveReceiver(receiverId) {
  const fastUrl = FAST_RECEIVER_ENDPOINTS[String(receiverId || '').toLowerCase()];
  if (fastUrl) return normalizeReceiverUrl(fastUrl);

  const legacyUrl = LEGACY_RECEIVERS[receiverId];
  if (legacyUrl) return normalizeReceiverUrl(legacyUrl);

  const seed = SEED_DIRECTORY.get(receiverId);
  if (seed) return seed;

  const directory = await receiverDirectory();
  return directory.get(receiverId) || null;
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, max-age=0, no-store'
    }
  });
}

async function resilientReceiverRecommendations(request, env, ctx) {
  const proxyDirectoryPromise = receiverDirectory().catch(() => null);
  const response = await baseWorker.fetch(request, env, ctx);
  const proxyDirectory = await proxyDirectoryPromise;

  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('application/json')) return response;

  let payload;
  try {
    payload = await response.clone().json();
  } catch {
    return response;
  }

  const liveReceivers = Array.isArray(payload?.receivers) ? payload.receivers : [];
  const liveDirectoryReady = payload?.source === 'receiverbook'
    && liveReceivers.length > 3
    && proxyDirectory instanceof Map
    && proxyDirectory.size > 3
    && liveReceivers.every((receiver) => proxyDirectory.has(receiver?.id));

  if (liveDirectoryReady) return response;

  const url = new URL(request.url);
  const ranked = rankSeedReceivers({
    frequencyKHz: url.searchParams.get('frequency'),
    userLat: url.searchParams.get('lat'),
    userLon: url.searchParams.get('lon'),
    txLat: url.searchParams.get('txLat'),
    txLon: url.searchParams.get('txLon')
  });
  if (!ranked.length) return response;

  return jsonResponse({
    ...payload,
    receivers: ranked,
    source: 'bundled-seed',
    warning: `Live receiver directory unavailable; using FREQBEACON built-in catalog ${SDR_DIRECTORY_SEED_VERSION}.`,
    generatedAt: new Date().toISOString()
  }, response.status);
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
  const upstreamUrl = `${upstreamScheme}//${receiver.upstreamHost}/${upstreamTimestamp}/${stream}`;

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        Upgrade: 'websocket',
        Origin: `${upstreamScheme}//${receiver.upstreamHost}`,
        'User-Agent': 'SignalScout/1.0'
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
    if (url.pathname === '/api/sdr/receivers') return resilientReceiverRecommendations(request, env, ctx);
    return baseWorker.fetch(request, env, ctx);
  }
};
