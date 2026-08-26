const DIRECTORY_URL = 'https://www.receiverbook.de/map?type=kiwisdr';
const DIRECTORY_CACHE_TTL_SECONDS = 15 * 60;
const DIRECTORY_MEMORY_TTL_MS = 10 * 60 * 1000;
const MAX_DIRECTORY_RECEIVERS = 1400;

const LEGACY_RECEIVERS = [
  {
    id: 'florida',
    name: 'Florida KiwiSDR',
    location: 'Palm Harbor, Florida',
    host: '22315.proxy.kiwisdr.com',
    lat: 28.0781,
    lon: -82.7637,
    minKHz: 10,
    maxKHz: 30000,
    source: 'legacy'
  },
  {
    id: 'north-carolina',
    name: 'North Carolina KiwiSDR',
    location: 'Apex, North Carolina',
    host: '22904.proxy.kiwisdr.com',
    lat: 35.7327,
    lon: -78.8503,
    minKHz: 10,
    maxKHz: 30000,
    source: 'legacy'
  },
  {
    id: 'pennsylvania',
    name: 'Pennsylvania KiwiSDR',
    location: 'Ridley Park, Pennsylvania',
    host: '22479.proxy.kiwisdr.com',
    lat: 39.8812,
    lon: -75.3238,
    minKHz: 10,
    maxKHz: 30000,
    source: 'legacy'
  }
];

let directoryMemory = null;
let directoryMemoryAt = 0;

function jsonResponse(value, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'public, max-age=120');
  return new Response(JSON.stringify(value), { ...init, headers });
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function milesBetween(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
  const radiusMiles = 3958.8;
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * radiusMiles * Math.asin(Math.sqrt(a));
}

function solarHour(longitude, date = new Date()) {
  if (!Number.isFinite(longitude)) return null;
  return (date.getUTCHours() + date.getUTCMinutes() / 60 + longitude / 15 + 24) % 24;
}

function coverageFromText(text) {
  const source = String(text || '').replace(/,/g, '.');
  const range = source.match(/(\d+(?:\.\d+)?)\s*(k?hz|mhz)?\s*[-–—]\s*(\d+(?:\.\d+)?)\s*(k?hz|mhz)/i);
  if (!range) return { minKHz: 10, maxKHz: 30000, coverageKnown: false };

  const toKHz = (value, unit, fallbackUnit) => {
    const normalizedUnit = String(unit || fallbackUnit || '').toLowerCase();
    return Number(value) * (normalizedUnit.includes('mhz') ? 1000 : 1);
  };
  const fallbackUnit = range[4];
  const minKHz = toKHz(range[1], range[2], fallbackUnit);
  const maxKHz = toKHz(range[3], range[4], fallbackUnit);
  if (!Number.isFinite(minKHz) || !Number.isFinite(maxKHz) || minKHz >= maxKHz) {
    return { minKHz: 10, maxKHz: 30000, coverageKnown: false };
  }
  return {
    minKHz: Math.max(0, Math.round(minKHz * 10) / 10),
    maxKHz: Math.round(maxKHz * 10) / 10,
    coverageKnown: true
  };
}

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

function normalizedReceiverUrl(rawUrl) {
  if (!rawUrl) return null;
  let parsed;
  try {
    parsed = new URL(String(rawUrl).trim());
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || isBlockedHost(parsed.hostname)) return null;
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  const host = `${parsed.hostname.toLowerCase()}:${port}`;
  return {
    url: `${parsed.protocol}//${parsed.host}`,
    host,
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

  const byHost = new Map();
  for (const site of sites) {
    const coordinates = site?.location?.coordinates;
    const lon = finiteNumber(Array.isArray(coordinates) ? coordinates[0] : site?.lon);
    const lat = finiteNumber(Array.isArray(coordinates) ? coordinates[1] : site?.lat);
    const siteLabel = String(site?.label || '').trim();
    const children = Array.isArray(site?.receivers) && site.receivers.length ? site.receivers : [site];

    for (const child of children) {
      if (byHost.size >= MAX_DIRECTORY_RECEIVERS) break;
      const typeText = [child?.type, child?.version, child?.software].filter(Boolean).join(' ');
      if (typeText && !/kiwi/i.test(typeText)) continue;
      const normalized = normalizedReceiverUrl(child?.url || site?.url);
      if (!normalized) continue;

      const name = String(child?.label || siteLabel || normalized.upstreamHost).replace(/<[^>]+>/g, '').trim();
      const location = siteLabel || name;
      const coverage = coverageFromText(`${name} ${location}`);
      const receiver = {
        id: normalized.host,
        name,
        location,
        host: normalized.host,
        upstreamHost: normalized.upstreamHost,
        hostname: normalized.hostname,
        protocol: normalized.protocol,
        url: normalized.url,
        lat,
        lon,
        minKHz: coverage.minKHz,
        maxKHz: coverage.maxKHz,
        coverageKnown: coverage.coverageKnown,
        version: String(child?.version || '').trim(),
        source: 'receiverbook'
      };
      if (!byHost.has(receiver.host)) byHost.set(receiver.host, receiver);
    }
  }

  return [...byHost.values()];
}

function mergeLegacy(receivers) {
  const result = [...receivers];
  const known = new Set(receivers.map((receiver) => receiver.host));
  for (const legacy of LEGACY_RECEIVERS) {
    const normalized = normalizedReceiverUrl(`http://${legacy.host}`);
    if (!normalized || known.has(normalized.host)) continue;
    result.push({
      ...legacy,
      host: normalized.host,
      upstreamHost: normalized.upstreamHost,
      hostname: normalized.hostname,
      protocol: 'http:',
      url: normalized.url,
      coverageKnown: true
    });
  }
  return result;
}

async function fetchReceiverDirectory(request, ctx) {
  const now = Date.now();
  if (directoryMemory && now - directoryMemoryAt < DIRECTORY_MEMORY_TTL_MS) return directoryMemory;

  const cache = caches.default;
  const cacheKey = new Request(new URL('/__cache/sdr-directory-v3', request.url).toString(), { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) {
    try {
      const data = await cached.json();
      if (Array.isArray(data?.receivers) && data.receivers.length) {
        directoryMemory = data;
        directoryMemoryAt = now;
        return data;
      }
    } catch {
      // Ignore corrupt cache and refresh below.
    }
  }

  try {
    const response = await fetch(DIRECTORY_URL, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'SignalScout/1.0 (+public SDR receiver discovery)'
      },
      cf: { cacheTtl: DIRECTORY_CACHE_TTL_SECONDS, cacheEverything: true }
    });
    if (!response.ok) throw new Error(`Directory HTTP ${response.status}`);
    const parsed = parseReceiverBook(await response.text());
    if (!parsed.length) throw new Error('Directory returned no usable KiwiSDRs');
    const data = {
      receivers: mergeLegacy(parsed),
      source: 'receiverbook',
      fetchedAt: new Date().toISOString()
    };
    directoryMemory = data;
    directoryMemoryAt = now;
    const toCache = jsonResponse(data, {
      headers: { 'cache-control': `public, max-age=${DIRECTORY_CACHE_TTL_SECONDS}` }
    });
    ctx?.waitUntil(cache.put(cacheKey, toCache.clone()));
    return data;
  } catch (error) {
    const fallback = {
      receivers: mergeLegacy([]),
      source: 'fallback',
      warning: error?.message || 'Public receiver directory unavailable',
      fetchedAt: new Date().toISOString()
    };
    directoryMemory = fallback;
    directoryMemoryAt = now;
    return fallback;
  }
}

function userProximityScore(distanceMiles) {
  if (!Number.isFinite(distanceMiles)) return 28;
  if (distanceMiles <= 50) return 100;
  if (distanceMiles <= 150) return 96 - (distanceMiles - 50) * 0.08;
  if (distanceMiles <= 400) return 88 - (distanceMiles - 150) * 0.12;
  if (distanceMiles <= 900) return 58 - (distanceMiles - 400) * 0.07;
  return Math.max(4, 23 - (distanceMiles - 900) * 0.012);
}

function solarSimilarityScore(userLon, receiverLon, frequencyKHz) {
  const userHour = solarHour(userLon);
  const receiverHour = solarHour(receiverLon);
  if (!Number.isFinite(userHour) || !Number.isFinite(receiverHour)) return 50;
  const userNight = userHour >= 19 || userHour < 6;
  const receiverNight = receiverHour >= 19 || receiverHour < 6;
  let score = userNight === receiverNight ? 92 : 48;
  const mhz = frequencyKHz / 1000;
  if (mhz < 8 && userNight && receiverNight) score += 8;
  if (mhz > 16 && !userNight && !receiverNight) score += 6;
  return clamp(score, 0, 100);
}

function rankReceivers(receivers, params) {
  const { frequencyKHz, userLat, userLon, txLat, txLon } = params;
  const hasUser = Number.isFinite(userLat) && Number.isFinite(userLon);
  const hasTx = Number.isFinite(txLat) && Number.isFinite(txLon);
  const localBand = frequencyKHz < 3000;
  const directDistance = hasUser && hasTx ? milesBetween(userLat, userLon, txLat, txLon) : null;

  const eligible = receivers
    .filter((receiver) => frequencyKHz >= (receiver.minKHz ?? 10) && frequencyKHz <= (receiver.maxKHz ?? 30000))
    .map((receiver) => {
      const userDistance = hasUser ? milesBetween(userLat, userLon, receiver.lat, receiver.lon) : null;
      const txDistance = hasTx ? milesBetween(txLat, txLon, receiver.lat, receiver.lon) : null;
      const proximity = userProximityScore(userDistance);
      let pathSimilarity = 50;
      let detour = null;
      if (Number.isFinite(directDistance) && Number.isFinite(userDistance) && Number.isFinite(txDistance)) {
        const distanceDifference = Math.abs(txDistance - directDistance);
        pathSimilarity = clamp(100 - distanceDifference / Math.max(12, directDistance * 0.012), 0, 100);
        detour = Math.max(0, userDistance + txDistance - directDistance);
        pathSimilarity = clamp(pathSimilarity - detour / Math.max(20, directDistance * 0.025), 0, 100);
      }
      const solar = solarSimilarityScore(userLon, receiver.lon, frequencyKHz);

      let score;
      if (localBand) {
        score = hasUser ? proximity * 0.92 + (receiver.coverageKnown ? 8 : 4) : 45;
      } else if (hasUser && hasTx) {
        score = proximity * 0.50 + pathSimilarity * 0.38 + solar * 0.12;
      } else if (hasUser) {
        score = proximity * 0.82 + solar * 0.18;
      } else if (hasTx && Number.isFinite(txDistance)) {
        score = clamp(100 - txDistance / 30, 5, 95);
      } else {
        score = receiver.source === 'receiverbook' ? 55 : 40;
      }

      return {
        ...receiver,
        userDistance,
        txDistance,
        directDistance,
        pathSimilarity,
        detour,
        solarSimilarity: solar,
        score
      };
    });

  eligible.sort((a, b) => b.score - a.score || (a.userDistance ?? Infinity) - (b.userDistance ?? Infinity));
  if (!eligible.length) return [];

  const picks = [];
  const picked = new Set();
  const add = (receiver, role, reason) => {
    if (!receiver || picked.has(receiver.id)) return;
    picked.add(receiver.id);
    picks.push({ ...receiver, role, reason });
  };

  const best = eligible[0];
  if (localBand) {
    const distanceText = Number.isFinite(best.userDistance) ? `${Math.round(best.userDistance)} mi from you` : 'best available receiver';
    add(best, 'NEAR YOU', `Closest useful public receiver for this local/regional frequency · ${distanceText}.`);
  } else {
    const isNear = Number.isFinite(best.userDistance) && best.userDistance <= 250;
    add(
      best,
      isNear ? 'NEAR YOU' : 'BEST MATCH',
      isNear
        ? 'Closest strong match to your listening location while keeping a similar HF path.'
        : 'Best balance of your location, transmitter path, frequency, and current day/night conditions.'
    );
  }

  if (hasUser) {
    const nearUser = [...eligible].sort((a, b) => (a.userDistance ?? Infinity) - (b.userDistance ?? Infinity))[0];
    add(nearUser, 'NEAR YOU', 'Useful comparison point because its RF environment is geographically closest to yours.');
  }

  if (!localBand && hasTx) {
    const stationCheck = [...eligible].sort((a, b) => (a.txDistance ?? Infinity) - (b.txDistance ?? Infinity))[0];
    add(stationCheck, 'STATION CHECK', 'Closer to the transmitter; useful for checking whether the broadcast appears to be reaching the airwaves.');
  }

  if (!localBand && hasUser && hasTx) {
    const propagationAlt = [...eligible]
      .filter((receiver) => receiver.id !== best.id)
      .sort((a, b) => {
        const aScore = a.pathSimilarity * 0.72 + a.solarSimilarity * 0.28;
        const bScore = b.pathSimilarity * 0.72 + b.solarSimilarity * 0.28;
        return bScore - aScore;
      })[0];
    add(propagationAlt, 'PROPAGATION ALT', 'Alternate receiver with a similar transmitter path and useful HF propagation geometry.');
  }

  for (const receiver of eligible) {
    if (picks.length >= 7) break;
    add(receiver, 'ALTERNATE', localBand
      ? 'Another public receiver that covers this frequency.'
      : 'Another public receiver with usable coverage for this frequency.');
  }

  return picks.map((receiver, index) => ({
    id: receiver.id,
    name: receiver.name,
    location: receiver.location,
    lat: receiver.lat,
    lon: receiver.lon,
    minKHz: receiver.minKHz,
    maxKHz: receiver.maxKHz,
    coverageKnown: Boolean(receiver.coverageKnown),
    version: receiver.version || '',
    distanceMiles: Number.isFinite(receiver.userDistance) ? Math.round(receiver.userDistance) : null,
    transmitterDistanceMiles: Number.isFinite(receiver.txDistance) ? Math.round(receiver.txDistance) : null,
    role: receiver.role,
    reason: receiver.reason,
    recommended: index === 0
  }));
}

async function receiverRecommendations(request, ctx) {
  const url = new URL(request.url);
  const frequencyKHz = finiteNumber(url.searchParams.get('frequency'));
  if (!Number.isFinite(frequencyKHz) || frequencyKHz < 10 || frequencyKHz > 30000) {
    return jsonResponse({ error: 'frequency must be between 10 and 30000 kHz' }, { status: 400 });
  }

  const data = await fetchReceiverDirectory(request, ctx);
  const ranked = rankReceivers(data.receivers, {
    frequencyKHz,
    userLat: finiteNumber(url.searchParams.get('lat')),
    userLon: finiteNumber(url.searchParams.get('lon')),
    txLat: finiteNumber(url.searchParams.get('txLat')),
    txLon: finiteNumber(url.searchParams.get('txLon'))
  });

  return jsonResponse({
    receivers: ranked,
    source: data.source,
    warning: data.warning || null,
    generatedAt: new Date().toISOString()
  });
}

async function resolveReceiver(request, receiverId, ctx) {
  const data = await fetchReceiverDirectory(request, ctx);
  const byId = data.receivers.find((receiver) => receiver.id === receiverId);
  if (byId) return byId;
  const legacy = LEGACY_RECEIVERS.find((receiver) => receiver.id === receiverId);
  if (!legacy) return null;
  const normalized = normalizedReceiverUrl(`http://${legacy.host}`);
  return normalized ? { ...legacy, ...normalized } : null;
}

async function proxySdrWebSocket(request, ctx) {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  const url = new URL(request.url);
  const receiverId = url.searchParams.get('receiver') || '';
  const stream = url.searchParams.get('stream') || 'SND';
  const timestamp = url.searchParams.get('ts') || '';
  if (!receiverId || receiverId.length > 180 || stream !== 'SND' || !/^\d{1,10}$/.test(timestamp)) {
    return new Response('Invalid SDR request', { status: 400 });
  }

  const receiver = await resolveReceiver(request, receiverId, ctx);
  if (!receiver?.upstreamHost || isBlockedHost(receiver.hostname)) {
    return new Response('Unknown SDR receiver', { status: 400 });
  }

  const upstreamScheme = receiver.protocol === 'https:' ? 'https:' : 'http:';
  const upstreamUrl = `${upstreamScheme}//${receiver.upstreamHost}/${timestamp}/${stream}`;
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
    if (url.pathname === '/api/sdr/receivers') return receiverRecommendations(request, ctx);
    if (url.pathname === '/api/sdr/ws') return proxySdrWebSocket(request, ctx);
    return env.ASSETS.fetch(request);
  }
};
