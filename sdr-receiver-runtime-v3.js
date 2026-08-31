(() => {
  if (window.__freqbeaconReceiverRuntime?.version === 'receiver-runtime-v5-source') return;

  const VERSION = 'receiver-runtime-v5-source';
  const LOCATION_STORAGE_KEY = 'signalScout:location:v1';
  const LIVE_POOL_KEY = 'freqbeacon:sdrLivePool:v3';
  const LEGACY_LIVE_POOL_KEY = 'freqbeacon:sdrLivePool:v2';
  const LIVE_POOL_FRESH_MS = 6 * 60 * 60 * 1000;
  const LIVE_POOL_STALE_MS = 7 * 24 * 60 * 60 * 1000;
  const LIVE_REFRESH_MIN_MS = 10 * 60 * 1000;
  const LIVE_REFRESH_TIMEOUT_MS = 6500;
  const MAX_PICKS = 7;

  const SEED = [
    { id:'22661.proxy.kiwisdr.com:8073', name:'N0DSS | St. Louis, Missouri', location:'St. Louis, Missouri', lat:38.6270, lon:-90.1994, minKHz:10, maxKHz:30000 },
    { id:'km4rt.ddns.net:8073', name:'KM4RT 0-30 MHz SDR', location:'Tipton County, Tennessee', lat:35.5600, lon:-89.6500, minKHz:10, maxKHz:30000 },
    { id:'21118.proxy.kiwisdr.com:8073', name:'Shortwave Central', location:'Mandeville, Louisiana', lat:30.3583, lon:-90.0656, minKHz:10, maxKHz:30000 },
    { id:'21305.proxy.kiwisdr.com:8073', name:'KJ5CHW 0-30 MHz SDR', location:'San Antonio, Texas', lat:29.4241, lon:-98.4936, minKHz:10, maxKHz:30000 },
    { id:'22204.proxy.kiwisdr.com:8073', name:'K4MIE 0-30 MHz SDR', location:'Huntsville, Alabama', lat:34.7304, lon:-86.5861, minKHz:10, maxKHz:30000 },
    { id:'22581.proxy.kiwisdr.com:8073', name:'KiwiSDR V2 Hartwell GA', location:'Hartwell, Georgia', lat:34.3529, lon:-82.9321, minKHz:10, maxKHz:30000 },
    { id:'p3hosting.dscloud.biz:8073', name:'0-30 MHz SDR | Boone NC', location:'Boone, North Carolina', lat:36.2168, lon:-81.6746, minKHz:100, maxKHz:30000 },
    { id:'22551.proxy.kiwisdr.com:8073', name:'KZ4MR 0-30 MHz SDR', location:'Leesburg, Virginia', lat:39.1157, lon:-77.5636, minKHz:10, maxKHz:30000 },
    { id:'22338.proxy.kiwisdr.com:8073', name:"WF7I's SDR", location:'Natural Bridge, Virginia', lat:37.6285, lon:-79.5439, minKHz:10, maxKHz:30000 },
    { id:'21690.proxy.kiwisdr.com:8073', name:'0-30 MHz SDR | Hilliard Ohio', location:'Hilliard, Ohio', lat:40.0334, lon:-83.1582, minKHz:10, maxKHz:30000 },
    { id:'rgv.twrmon.net:8075', name:'0-30 MHz SDR | Brownsville Texas', location:'Brownsville, Texas', lat:25.9017, lon:-97.4975, minKHz:10, maxKHz:30000 },
    { id:'kiwisdr1.sdrutah.org:8073', name:'Northern Utah KiwiSDR #1', location:'Northern Utah', lat:40.7608, lon:-111.8910, minKHz:10, maxKHz:30000 },
    { id:'kiwisdr2.sdrutah.org:8074', name:'Northern Utah KiwiSDR #2', location:'Northern Utah', lat:40.7608, lon:-111.8910, minKHz:10, maxKHz:30000 },
    { id:'km6cq.hopto.org:8073', name:'KM6CQ Ponderosa SDR', location:'Washoe Valley, Nevada', lat:39.2830, lon:-119.8280, minKHz:100, maxKHz:30000 },
    { id:'22148.proxy.kiwisdr.com:8073', name:'0-30 MHz SDR | Bend Oregon', location:'Bend, Oregon', lat:44.0582, lon:-121.3153, minKHz:10, maxKHz:30000 },
    { id:'mtkiwi.proxy.kiwisdr.com:8073', name:'0-30 MHz SDR | Stevensville MT', location:'Stevensville, Montana', lat:46.5099, lon:-114.0932, minKHz:10, maxKHz:30000 },
    { id:'k7len.proxy.kiwisdr.com:8073', name:'K7LEN 0-30 MHz SDR', location:'Worley, Idaho', lat:47.4007, lon:-116.9207, minKHz:10, maxKHz:30000 },
    { id:'n7drd.proxy.kiwisdr.com:8073', name:'0-30 MHz SDR | Ocean Park WA', location:'Ocean Park, Washington', lat:46.4918, lon:-124.0526, minKHz:10, maxKHz:30000 },
    { id:'palomar-1.proxy.kiwisdr.com:8073', name:'K6VZK KiwiSDR #1', location:'Palomar Mountain, California', lat:33.3220, lon:-116.8640, minKHz:10, maxKHz:30000 }
  ];
  const SEED_IDS = new Set(SEED.map((receiver) => receiver.id.toLowerCase()));

  let activeContext = null;
  let livePool = loadLivePool();
  let liveRefreshPromise = null;
  let lastLiveRefreshAttempt = 0;

  function finite(value) {
    if (value == null || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function loadStoredLocation() {
    try {
      const payload = JSON.parse(window.localStorage?.getItem(LOCATION_STORAGE_KEY) || 'null');
      const lat = finite(payload?.lat);
      const lon = finite(payload?.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    } catch {
      return null;
    }
  }

  function hostFromId(id) {
    const value = String(id || '').trim().toLowerCase();
    if (!value) return '';
    return value.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];
  }

  function isIpv4Host(id) {
    const host = hostFromId(id).replace(/:\d+$/, '');
    return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
  }

  function callSign(value) {
    const match = String(value || '').toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z]{1,4}\b/);
    return match?.[0] || '';
  }

  function normalizedLabel(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\b(?:kiwisdr|sdr|receiver|0\s*[-–]\s*30\s*mhz|v2)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function normalizeReceiver(receiver, liveEvidence = false) {
    const id = String(receiver?.id || receiver?.host || '').trim();
    if (!id) return null;
    const minKHz = finite(receiver?.minKHz) ?? 10;
    const maxKHz = finite(receiver?.maxKHz) ?? 30000;
    if (!(maxKHz > minKHz)) return null;
    return {
      ...receiver,
      id,
      name: String(receiver?.name || 'Public KiwiSDR').trim().slice(0, 180),
      location: String(receiver?.location || 'Location not listed').trim().slice(0, 180),
      lat: finite(receiver?.lat),
      lon: finite(receiver?.lon),
      minKHz,
      maxKHz,
      liveEvidence: Boolean(receiver?.liveEvidence || liveEvidence),
      bundledSeed: Boolean(receiver?.bundledSeed || SEED_IDS.has(id.toLowerCase()))
    };
  }

  function aliasKey(receiver) {
    const sign = callSign(`${receiver?.name || ''} ${receiver?.location || ''}`);
    if (sign) return `call:${sign}`;
    const name = normalizedLabel(receiver?.name);
    const location = normalizedLabel(receiver?.location);
    if (name && location) return `label:${name}|${location}`;
    return `id:${String(receiver?.id || '').toLowerCase()}`;
  }

  function endpointPreference(receiver) {
    let score = 0;
    if (receiver?.liveEvidence) score += 10;
    if (!isIpv4Host(receiver?.id)) score += 8;
    if (/^https:/i.test(String(receiver?.url || ''))) score += 2;
    const health = window.__freqbeaconReceiverHealth?.state?.(receiver?.id);
    if (health?.recentSuccess) score += 12;
    if (health?.cooling) score -= 20;
    return score;
  }

  function dedupeReceivers(receivers) {
    const byId = new Map();
    for (const raw of receivers || []) {
      const receiver = normalizeReceiver(raw, raw?.liveEvidence);
      if (!receiver) continue;
      const key = receiver.id.toLowerCase();
      const previous = byId.get(key);
      if (!previous || endpointPreference(receiver) > endpointPreference(previous)) byId.set(key, receiver);
    }

    const byAlias = new Map();
    for (const receiver of byId.values()) {
      const key = aliasKey(receiver);
      const previous = byAlias.get(key);
      if (!previous) {
        byAlias.set(key, receiver);
        continue;
      }
      const sameCall = key.startsWith('call:');
      const closeCoordinates = [previous.lat, previous.lon, receiver.lat, receiver.lon].every(Number.isFinite)
        && Math.abs(previous.lat - receiver.lat) < 0.08
        && Math.abs(previous.lon - receiver.lon) < 0.08;
      const sameLabels = normalizedLabel(previous.name) === normalizedLabel(receiver.name)
        && normalizedLabel(previous.location) === normalizedLabel(receiver.location);
      if (!sameCall && !sameLabels && !closeCoordinates) {
        byAlias.set(`id:${receiver.id.toLowerCase()}`, receiver);
        continue;
      }
      if (endpointPreference(receiver) > endpointPreference(previous)) byAlias.set(key, receiver);
    }
    return [...byAlias.values()];
  }

  function loadPoolFromKey(key) {
    try {
      const payload = JSON.parse(window.localStorage?.getItem(key) || 'null');
      if (!payload || !Array.isArray(payload.receivers)) return null;
      return {
        updatedAt: Number(payload.updatedAt || 0),
        receivers: dedupeReceivers(payload.receivers.map((receiver) => ({ ...receiver, liveEvidence: true })))
      };
    } catch {
      return null;
    }
  }

  function loadLivePool() {
    return loadPoolFromKey(LIVE_POOL_KEY)
      || loadPoolFromKey(LEGACY_LIVE_POOL_KEY)
      || { updatedAt: 0, receivers: [] };
  }

  function saveLivePool(receivers) {
    livePool = { updatedAt: Date.now(), receivers: dedupeReceivers(receivers) };
    try {
      window.localStorage?.setItem(LIVE_POOL_KEY, JSON.stringify(livePool));
    } catch {}
  }

  function livePoolState(now = Date.now()) {
    const age = now - Number(livePool.updatedAt || 0);
    const enough = livePool.receivers.length >= 4;
    return {
      age,
      fresh: enough && age < LIVE_POOL_FRESH_MS,
      usable: enough && age < LIVE_POOL_STALE_MS,
      expired: enough && age >= LIVE_POOL_STALE_MS
    };
  }

  function currentPool() {
    const state = livePoolState();
    const seed = SEED.map((receiver) => normalizeReceiver(receiver, false)).filter(Boolean);
    return state.usable ? dedupeReceivers([...livePool.receivers, ...seed]) : dedupeReceivers(seed);
  }

  function milesBetween(lat1, lon1, lat2, lon2) {
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
    const r = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * r / 2) ** 2
      + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
    return 2 * 3958.8 * Math.asin(Math.sqrt(a));
  }

  function solarSimilarity(userLon, receiverLon, frequencyKHz, date = new Date()) {
    if (!Number.isFinite(userLon) || !Number.isFinite(receiverLon)) return 50;
    const utc = date.getUTCHours() + date.getUTCMinutes() / 60;
    const hour = (lon) => (utc + lon / 15 + 24) % 24;
    const userHour = hour(userLon);
    const receiverHour = hour(receiverLon);
    const userNight = userHour >= 19 || userHour < 6;
    const receiverNight = receiverHour >= 19 || receiverHour < 6;
    let score = userNight === receiverNight ? 92 : 48;
    const mhz = frequencyKHz / 1000;
    if (mhz < 8 && userNight && receiverNight) score += 8;
    if (mhz > 16 && !userNight && !receiverNight) score += 6;
    return clamp(score, 0, 100);
  }

  function proximityScore(distance) {
    if (!Number.isFinite(distance)) return 28;
    if (distance <= 50) return 100;
    if (distance <= 150) return 96 - (distance - 50) * 0.08;
    if (distance <= 400) return 88 - (distance - 150) * 0.12;
    if (distance <= 900) return 58 - (distance - 400) * 0.07;
    return Math.max(4, 23 - (distance - 900) * 0.012);
  }

  function hamViewActive() {
    return document.getElementById('signalGrid')?.dataset.hamView === 'true';
  }

  function hamBucket(distance) {
    if (distance <= 400) return 0;
    if (distance <= 900) return 1;
    if (distance <= 1800) return 2;
    if (distance <= 3000) return 3;
    return 4;
  }

  function normalizeContext(input) {
    const stored = loadStoredLocation();
    if (input instanceof URL || typeof input === 'string' || input?.url) {
      let url;
      try {
        url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url, window.location.href);
      } catch {
        return { frequency:null, userLat:stored?.lat ?? null, userLon:stored?.lon ?? null, txLat:null, txLon:null, ham:hamViewActive() };
      }
      const frequency = finite(url.searchParams.get('frequency'));
      let txLat = finite(url.searchParams.get('txLat'));
      let txLon = finite(url.searchParams.get('txLon'));
      if ((!Number.isFinite(txLat) || !Number.isFinite(txLon)) && activeContext && Number.isFinite(frequency)
        && Math.abs(activeContext.frequency - frequency) < 0.11) {
        txLat = activeContext.txLat;
        txLon = activeContext.txLon;
      }
      return {
        frequency,
        userLat: finite(url.searchParams.get('lat')) ?? stored?.lat ?? null,
        userLon: finite(url.searchParams.get('lon')) ?? stored?.lon ?? null,
        txLat,
        txLon,
        ham: url.searchParams.get('ham') === '1' || hamViewActive()
      };
    }

    return {
      frequency: finite(input?.frequency),
      userLat: finite(input?.userLat) ?? stored?.lat ?? null,
      userLon: finite(input?.userLon) ?? stored?.lon ?? null,
      txLat: finite(input?.txLat),
      txLon: finite(input?.txLon),
      ham: Boolean(input?.ham ?? hamViewActive())
    };
  }

  function scorePool(pool, context) {
    const { frequency, userLat, userLon, txLat, txLon, ham } = context;
    const hasUser = Number.isFinite(userLat) && Number.isFinite(userLon);
    const hasTx = Number.isFinite(txLat) && Number.isFinite(txLon);
    const direct = hasUser && hasTx ? milesBetween(userLat, userLon, txLat, txLon) : null;
    const local = frequency < 2000;
    const timestamp = Date.now();

    let eligible = pool
      .filter((receiver) => frequency >= receiver.minKHz && frequency <= receiver.maxKHz)
      .map((receiver) => {
        const userDistance = hasUser ? milesBetween(userLat, userLon, receiver.lat, receiver.lon) : null;
        const txDistance = hasTx ? milesBetween(txLat, txLon, receiver.lat, receiver.lon) : null;
        const proximity = proximityScore(userDistance);
        let pathSimilarity = 50;
        if (Number.isFinite(direct) && Number.isFinite(userDistance) && Number.isFinite(txDistance)) {
          pathSimilarity = clamp(100 - Math.abs(txDistance - direct) / Math.max(12, direct * 0.012), 0, 100);
          const detour = Math.max(0, userDistance + txDistance - direct);
          pathSimilarity = clamp(pathSimilarity - detour / Math.max(20, direct * 0.025), 0, 100);
        }
        const solar = solarSimilarity(userLon, receiver.lon, frequency);
        let score = local
          ? (hasUser ? proximity * 0.92 + (receiver.liveEvidence ? 8 : 6) : 45)
          : hasUser && hasTx
            ? proximity * 0.50 + pathSimilarity * 0.38 + solar * 0.12
            : hasUser
              ? proximity * 0.82 + solar * 0.18
              : hasTx && Number.isFinite(txDistance)
                ? clamp(100 - txDistance / 30, 5, 95)
                : 50;
        if (receiver.liveEvidence) score += 3;
        const health = window.__freqbeaconReceiverHealth?.state?.(receiver.id, timestamp) || {};
        if (health.recentSuccess) score += 4;
        return {
          ...receiver,
          userDistance,
          txDistance,
          pathSimilarity,
          solar,
          score,
          cooling: Boolean(health.cooling),
          recentSuccess: Boolean(health.recentSuccess),
          failures: Number(health.failures || 0)
        };
      });

    if (ham) {
      eligible.sort((a, b) => {
        const ad = a.userDistance ?? Infinity;
        const bd = b.userDistance ?? Infinity;
        const aEffective = ad + (a.cooling ? 450 + a.failures * 120 : 0) - (a.recentSuccess ? 90 : 0);
        const bEffective = bd + (b.cooling ? 450 + b.failures * 120 : 0) - (b.recentSuccess ? 90 : 0);
        return hamBucket(ad) - hamBucket(bd) || aEffective - bEffective || b.score - a.score;
      });
      return eligible;
    }

    const healthy = eligible.filter((receiver) => !receiver.cooling);
    if (healthy.length) eligible = healthy;
    eligible.sort((a, b) => b.score - a.score
      || Number(b.recentSuccess) - Number(a.recentSuccess)
      || (a.userDistance ?? Infinity) - (b.userDistance ?? Infinity));
    return eligible;
  }

  function rankReceivers(input) {
    const context = normalizeContext(input);
    if (!Number.isFinite(context.frequency) || context.frequency < 10 || context.frequency > 30000) return [];
    const eligible = scorePool(currentPool(), context);
    if (!eligible.length) return [];

    const local = context.frequency < 2000;
    const hasUser = Number.isFinite(context.userLat) && Number.isFinite(context.userLon);
    const hasTx = Number.isFinite(context.txLat) && Number.isFinite(context.txLon);
    const picks = [];
    const picked = new Set();
    const add = (receiver, role, reason) => {
      if (!receiver || picked.has(receiver.id) || picks.length >= MAX_PICKS) return;
      picked.add(receiver.id);
      picks.push({ ...receiver, role, reason });
    };

    const best = eligible[0];
    if (context.ham) {
      add(best, 'NEAR YOU', Number.isFinite(best.userDistance)
        ? `Best nearby observation point for amateur activity · ${Math.round(best.userDistance)} mi from you.`
        : 'Best nearby observation point for amateur activity.');
    } else if (local) {
      add(best, 'NEAR YOU', Number.isFinite(best.userDistance)
        ? `Closest useful currently available receiver · ${Math.round(best.userDistance)} mi from you.`
        : 'Closest useful currently available receiver.');
    } else {
      add(best,
        Number.isFinite(best.userDistance) && best.userDistance <= 250 ? 'NEAR YOU' : 'BEST MATCH',
        best.recentSuccess
          ? 'Best RF match among currently available receivers; this SDR also connected successfully recently.'
          : 'Best currently available balance of your location, transmitter path, frequency, and day/night conditions.');
    }

    if (hasUser) {
      add([...eligible].sort((a, b) => (a.userDistance ?? Infinity) - (b.userDistance ?? Infinity))[0],
        'NEAR YOU', 'Useful comparison point because its RF environment is geographically closest to yours.');
    }
    if (!local && hasTx && !context.ham) {
      add([...eligible].sort((a, b) => (a.txDistance ?? Infinity) - (b.txDistance ?? Infinity))[0],
        'STATION CHECK', 'Closer to the transmitter; useful for checking whether the broadcast appears active.');
    }
    if (!local && hasUser && hasTx && !context.ham) {
      add([...eligible]
        .filter((receiver) => receiver.id !== best.id)
        .sort((a, b) => (b.pathSimilarity * 0.72 + b.solar * 0.28) - (a.pathSimilarity * 0.72 + a.solar * 0.28))[0],
      'PROPAGATION ALT', 'Alternate receiver with a similar transmitter path and useful HF propagation geometry.');
    }

    // Always keep one deployment-bundled receiver in the ranked set when one
    // is available. These IDs can be resolved directly by worker-v2 without a
    // fresh ReceiverBook lookup, so the connection manager has a deterministic
    // early recovery path if the live catalog is stale or a public SDR vanished.
    add(eligible.find((receiver) => receiver.bundledSeed && receiver.id !== best.id),
      'RELIABLE FALLBACK', 'Deployment-bundled public receiver available as a fast recovery path if the live directory entry fails.');

    for (const receiver of eligible) add(receiver, 'ALTERNATE', 'Another currently available public KiwiSDR covering this frequency.');

    return picks.map((receiver, index) => ({
      id: receiver.id,
      name: receiver.name,
      location: receiver.location,
      lat: receiver.lat,
      lon: receiver.lon,
      minKHz: receiver.minKHz,
      maxKHz: receiver.maxKHz,
      coverageKnown: true,
      version: receiver.version || '',
      distanceMiles: Number.isFinite(receiver.userDistance) ? Math.round(receiver.userDistance) : null,
      transmitterDistanceMiles: Number.isFinite(receiver.txDistance) ? Math.round(receiver.txDistance) : null,
      role: receiver.role,
      reason: receiver.reason,
      recommended: index === 0,
      connectionHealth: receiver.recentSuccess ? 'recent-success' : (receiver.cooling ? 'cooldown' : 'unknown'),
      liveEvidence: Boolean(receiver.liveEvidence),
      bundledSeed: Boolean(receiver.bundledSeed)
    }));
  }

  function setActiveContext(input) {
    const context = normalizeContext(input);
    if (Number.isFinite(context.frequency)) activeContext = context;
    return activeContext;
  }

  function buildLiveUrl(context) {
    const url = new URL('/api/sdr/receivers', window.location.origin);
    url.searchParams.set('frequency', Number(context.frequency).toFixed(1));
    if (Number.isFinite(context.userLat) && Number.isFinite(context.userLon)) {
      url.searchParams.set('lat', context.userLat.toFixed(5));
      url.searchParams.set('lon', context.userLon.toFixed(5));
    }
    if (Number.isFinite(context.txLat) && Number.isFinite(context.txLon)) {
      url.searchParams.set('txLat', context.txLat.toFixed(5));
      url.searchParams.set('txLon', context.txLon.toFixed(5));
    }
    return url;
  }

  function refresh(input, { force = false } = {}) {
    const context = normalizeContext(input);
    if (!Number.isFinite(context.frequency)) return Promise.resolve(false);
    const timestamp = Date.now();
    if (!force && timestamp - lastLiveRefreshAttempt < LIVE_REFRESH_MIN_MS) {
      return liveRefreshPromise || Promise.resolve(false);
    }
    if (liveRefreshPromise) return liveRefreshPromise;

    lastLiveRefreshAttempt = timestamp;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), LIVE_REFRESH_TIMEOUT_MS);
    liveRefreshPromise = fetch(buildLiveUrl(context), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store'
    }).then(async (response) => {
      if (!response.ok) return false;
      const payload = await response.json();
      if (!Array.isArray(payload?.receivers) || payload.receivers.length < 4) return false;
      const live = payload.receivers.map((receiver) => normalizeReceiver(receiver, true)).filter(Boolean);
      saveLivePool(dedupeReceivers([...live, ...livePool.receivers]));
      return true;
    }).catch(() => false).finally(() => {
      window.clearTimeout(timer);
      liveRefreshPromise = null;
    });
    return liveRefreshPromise;
  }

  const api = {
    version: VERSION,
    recommend(input) {
      const context = normalizeContext(input);
      const receivers = rankReceivers(context);
      const state = livePoolState();
      return {
        receivers,
        source: state.usable
          ? (state.fresh ? 'receiver-runtime-live-cache' : 'receiver-runtime-stale-cache')
          : 'receiver-runtime-seed',
        warning: state.expired ? 'Cached ReceiverBook data is older than seven days; using the bundled seed catalog while refreshing in the background.' : null,
        generatedAt: new Date().toISOString(),
        catalogAgeMs: Number.isFinite(state.age) ? Math.max(0, state.age) : null
      };
    },
    rankReceivers,
    refresh,
    setActiveContext,
    dedupeReceivers,
    normalizeContext,
    get livePoolCount() { return livePool.receivers.length; },
    get livePoolUpdatedAt() { return livePool.updatedAt; },
    get seedCount() { return SEED.length; }
  };

  window.__freqbeaconReceiverRuntimeV3 = true;
  window.__freqbeaconReceiverRuntime = api;

  const stored = loadStoredLocation();
  window.setTimeout(() => {
    refresh({ frequency:5990, userLat:stored?.lat ?? null, userLon:stored?.lon ?? null, txLat:null, txLon:null, ham:false })
      .catch(() => {});
  }, 0);
})();