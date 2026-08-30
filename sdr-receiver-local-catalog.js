(() => {
  const VERSION = 'client-catalog-v1-20260829';
  const nativeFetch = window.fetch.bind(window);

  // Client-side safety catalog. This mirrors sdr-directory-seed.js so opening
  // Receiver options never depends on a network round trip or ReceiverBook.
  const CATALOG = [
    { id:'22661.proxy.kiwisdr.com:8073', name:'N0DSS | St. Louis, Missouri', location:'St. Louis, Missouri', lat:38.6270, lon:-90.1994, minKHz:10, maxKHz:30000 },
    { id:'km4rt.ddns.net:8073', name:'KM4RT 0-30 MHz SDR', location:'Tipton County, Tennessee', lat:35.5600, lon:-89.6500, minKHz:10, maxKHz:30000 },
    { id:'21118.proxy.kiwisdr.com:8073', name:'Shortwave Central', location:'Mandeville, Louisiana', lat:30.3583, lon:-90.0656, minKHz:10, maxKHz:30000 },
    { id:'21305.proxy.kiwisdr.com:8073', name:'KJ5CHW 0-30 MHz SDR', location:'San Antonio, Texas', lat:29.4241, lon:-98.4936, minKHz:10, maxKHz:30000 },
    { id:'22204.proxy.kiwisdr.com:8073', name:'K4MIE 0-30 MHz SDR', location:'Huntsville, Alabama', lat:34.7304, lon:-86.5861, minKHz:10, maxKHz:30000 },
    { id:'22581.proxy.kiwisdr.com:8073', name:'KiwiSDR V2 Hartwell GA', location:'Hartwell, Georgia', lat:34.3529, lon:-82.9321, minKHz:10, maxKHz:30000 },
    { id:'p3hosting.dscloud.biz:8073', name:'0-30 MHz SDR | Boone NC', location:'Boone, North Carolina', lat:36.2168, lon:-81.6746, minKHz:10, maxKHz:30000 },
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

  function finite(value) {
    if (value == null || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function milesBetween(lat1, lon1, lat2, lon2) {
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return null;
    const r = Math.PI / 180;
    const a = Math.sin((lat2 - lat1) * r / 2) ** 2
      + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin((lon2 - lon1) * r / 2) ** 2;
    return 2 * 3958.8 * Math.asin(Math.sqrt(a));
  }

  function solarHour(lon, date = new Date()) {
    return Number.isFinite(lon)
      ? (date.getUTCHours() + date.getUTCMinutes() / 60 + lon / 15 + 24) % 24
      : null;
  }

  function proximityScore(distance) {
    if (!Number.isFinite(distance)) return 28;
    if (distance <= 50) return 100;
    if (distance <= 150) return 96 - (distance - 50) * 0.08;
    if (distance <= 400) return 88 - (distance - 150) * 0.12;
    if (distance <= 900) return 58 - (distance - 400) * 0.07;
    return Math.max(4, 23 - (distance - 900) * 0.012);
  }

  function solarSimilarity(userLon, receiverLon, frequencyKHz) {
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

  function rankReceivers(url) {
    const f = finite(url.searchParams.get('frequency'));
    const userLat = finite(url.searchParams.get('lat'));
    const userLon = finite(url.searchParams.get('lon'));
    const txLat = finite(url.searchParams.get('txLat'));
    const txLon = finite(url.searchParams.get('txLon'));
    if (!Number.isFinite(f)) return [];

    const hasUser = Number.isFinite(userLat) && Number.isFinite(userLon);
    const hasTx = Number.isFinite(txLat) && Number.isFinite(txLon);
    const local = f < 2000;
    const direct = hasUser && hasTx ? milesBetween(userLat, userLon, txLat, txLon) : null;

    const eligible = CATALOG
      .filter((receiver) => f >= receiver.minKHz && f <= receiver.maxKHz)
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
        const solar = solarSimilarity(userLon, receiver.lon, f);
        let score;
        if (local) score = hasUser ? proximity * 0.92 + 8 : 45;
        else if (hasUser && hasTx) score = proximity * 0.50 + pathSimilarity * 0.38 + solar * 0.12;
        else if (hasUser) score = proximity * 0.82 + solar * 0.18;
        else if (hasTx && Number.isFinite(txDistance)) score = clamp(100 - txDistance / 30, 5, 95);
        else score = 50;
        return { ...receiver, userDistance, txDistance, pathSimilarity, solar, score };
      })
      .sort((a, b) => b.score - a.score || (a.userDistance ?? Infinity) - (b.userDistance ?? Infinity));

    if (!eligible.length) return [];

    const picks = [];
    const picked = new Set();
    const add = (receiver, role, reason) => {
      if (!receiver || picked.has(receiver.id)) return;
      picked.add(receiver.id);
      picks.push({ ...receiver, role, reason });
    };

    const best = eligible[0];
    if (local) {
      const distance = Number.isFinite(best.userDistance) ? `${Math.round(best.userDistance)} mi from you` : 'best available receiver';
      add(best, 'NEAR YOU', `Closest useful built-in receiver for this local/regional frequency · ${distance}.`);
    } else {
      const near = Number.isFinite(best.userDistance) && best.userDistance <= 250;
      add(
        best,
        near ? 'NEAR YOU' : 'BEST MATCH',
        near
          ? 'Closest strong built-in match to your listening location while keeping a useful HF path.'
          : 'Best built-in balance of your location, transmitter path, frequency, and current day/night conditions.'
      );
    }

    if (hasUser) {
      add(
        [...eligible].sort((a, b) => (a.userDistance ?? Infinity) - (b.userDistance ?? Infinity))[0],
        'NEAR YOU',
        'Useful comparison point because its RF environment is geographically closest to yours.'
      );
    }

    if (!local && hasTx) {
      add(
        [...eligible].sort((a, b) => (a.txDistance ?? Infinity) - (b.txDistance ?? Infinity))[0],
        'STATION CHECK',
        'Closer to the transmitter; useful for checking whether the broadcast appears to be reaching the airwaves.'
      );
    }

    if (!local && hasUser && hasTx) {
      add(
        [...eligible]
          .filter((receiver) => receiver.id !== best.id)
          .sort((a, b) => (b.pathSimilarity * 0.72 + b.solar * 0.28) - (a.pathSimilarity * 0.72 + a.solar * 0.28))[0],
        'PROPAGATION ALT',
        'Alternate built-in receiver with a similar transmitter path and useful HF propagation geometry.'
      );
    }

    for (const receiver of eligible) {
      if (picks.length >= 7) break;
      add(receiver, 'ALTERNATE', 'Another built-in public KiwiSDR that covers this frequency.');
    }

    return picks.map((receiver, index) => ({
      id: receiver.id,
      name: receiver.name,
      location: receiver.location,
      lat: receiver.lat,
      lon: receiver.lon,
      minKHz: receiver.minKHz,
      maxKHz: receiver.maxKHz,
      coverageKnown: true,
      version: '',
      distanceMiles: Number.isFinite(receiver.userDistance) ? Math.round(receiver.userDistance) : null,
      transmitterDistanceMiles: Number.isFinite(receiver.txDistance) ? Math.round(receiver.txDistance) : null,
      role: receiver.role,
      reason: receiver.reason,
      recommended: index === 0
    }));
  }

  function receiverRequest(input, init) {
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET') return null;
    const rawUrl = input instanceof Request ? input.url : input;
    try {
      const url = new URL(String(rawUrl), window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== '/api/sdr/receivers') return null;
      return url;
    } catch {
      return null;
    }
  }

  window.fetch = (input, init) => {
    const url = receiverRequest(input, init);
    if (!url) return nativeFetch(input, init);

    if (init?.signal?.aborted) {
      return Promise.reject(new DOMException('The user aborted a request.', 'AbortError'));
    }

    const receivers = rankReceivers(url);
    const payload = receivers.length
      ? {
          receivers,
          source: 'client-bundled-immediate',
          generatedAt: new Date().toISOString()
        }
      : {
          error: 'No built-in SDR covers this frequency',
          receivers: [],
          source: 'client-bundled-immediate',
          generatedAt: new Date().toISOString()
        };

    return Promise.resolve(new Response(JSON.stringify(payload), {
      status: receivers.length ? 200 : 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, max-age=0, no-store',
        'x-freqbeacon-sdr-directory': VERSION
      }
    }));
  };

  window.__freqbeaconReceiverCatalog = {
    version: VERSION,
    count: CATALOG.length
  };
})();
