(() => {
  if (window.__freqbeaconReceiverOptionsV4) return;
  window.__freqbeaconReceiverOptionsV4 = true;

  const trace = (event, detail = {}) => window.__freqbeaconSdrTrace?.(`options-v4-${event}`, detail);
  const upstreamFetch = window.fetch.bind(window);
  const VERSION = 'dynamic-path-options-v4-20260907';
  const DYNAMIC_TIMEOUT_MS = 5200;
  const WEAK_RSSI_DB = -109;
  const SIGNAL_CHECK_MS = 2600;
  const MIN_SIGNAL_SAMPLES = 6;
  const MAX_WEAK_SWITCHES = 4;

  // Emergency-only fallback. Normal listening now uses the live ReceiverBook-backed
  // endpoint so the candidate pool is not limited to this small built-in catalog.
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

  function proximityScore(distance) {
    if (!Number.isFinite(distance)) return 28;
    if (distance <= 50) return 100;
    if (distance <= 150) return 96 - (distance - 50) * 0.08;
    if (distance <= 400) return 88 - (distance - 150) * 0.12;
    if (distance <= 900) return 58 - (distance - 400) * 0.07;
    return Math.max(4, 23 - (distance - 900) * 0.012);
  }

  function stationSignalScore(distance) {
    if (!Number.isFinite(distance)) return 50;
    if (distance <= 75) return 100;
    if (distance <= 300) return 100 - (distance - 75) * 0.05;
    if (distance <= 800) return 88.75 - (distance - 300) * 0.04;
    if (distance <= 1500) return 68.75 - (distance - 800) * 0.035;
    return Math.max(8, 44.25 - (distance - 1500) * 0.01);
  }

  function pathScore(direct, userDistance, txDistance) {
    if (![direct, userDistance, txDistance].every(Number.isFinite) || direct <= 0) return 50;
    const detour = Math.max(0, userDistance + txDistance - direct);
    return clamp(100 - (detour / direct) * 180, 0, 100);
  }

  function solarHour(lon, date = new Date()) {
    return Number.isFinite(lon)
      ? (date.getUTCHours() + date.getUTCMinutes() / 60 + lon / 15 + 24) % 24
      : null;
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

  function receiverRequest(input, init) {
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET') return null;
    try {
      const rawUrl = input instanceof Request ? input.url : input;
      const url = new URL(String(rawUrl), window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== '/api/sdr/receivers') return null;
      return url;
    } catch {
      return null;
    }
  }

  function rerankForListening(receivers, url) {
    if (!Array.isArray(receivers) || receivers.length < 2) return receivers || [];
    const frequency = finite(url.searchParams.get('frequency'));
    const userLat = finite(url.searchParams.get('lat'));
    const userLon = finite(url.searchParams.get('lon'));
    const txLat = finite(url.searchParams.get('txLat'));
    const txLon = finite(url.searchParams.get('txLon'));
    const hasUser = Number.isFinite(userLat) && Number.isFinite(userLon);
    const hasTx = Number.isFinite(txLat) && Number.isFinite(txLon);
    const localBand = Number.isFinite(frequency) && frequency < 2000;

    // MW/LW/local listening should continue to favor a receiver near the user.
    if (localBand || !hasTx) return receivers.map((receiver, index) => ({ ...receiver, recommended: index === 0 }));

    const direct = hasUser ? milesBetween(userLat, userLon, txLat, txLon) : null;
    const scored = receivers.map((receiver, index) => {
      const lat = finite(receiver?.lat);
      const lon = finite(receiver?.lon);
      const userDistance = finite(receiver?.distanceMiles)
        ?? (hasUser ? milesBetween(userLat, userLon, lat, lon) : null);
      const txDistance = finite(receiver?.transmitterDistanceMiles)
        ?? milesBetween(txLat, txLon, lat, lon);
      const station = stationSignalScore(txDistance);
      const path = pathScore(direct, userDistance, txDistance);
      const proximity = proximityScore(userDistance);
      const solar = solarSimilarity(userLon, lon, frequency || 0);
      const role = String(receiver?.role || '').toUpperCase();
      const roleBonus = role === 'STATION CHECK' ? 8 : (role === 'BEST MATCH' ? 2 : (role === 'PROPAGATION ALT' ? 1.5 : 0));
      const healthPenalty = receiver?.connectionHealth === 'cooldown'
        ? 120
        : (receiver?.connectionHealth === 'preflight-failed' ? 90 : 0);
      const score = station * 0.45 + path * 0.30 + proximity * 0.15 + solar * 0.10 + roleBonus - healthPenalty;
      return { receiver: { ...receiver }, index, score, station, path, userDistance, txDistance };
    });

    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    return scored.map((item, index) => ({
      ...item.receiver,
      distanceMiles: Number.isFinite(item.userDistance) ? Math.round(item.userDistance) : item.receiver.distanceMiles,
      transmitterDistanceMiles: Number.isFinite(item.txDistance) ? Math.round(item.txDistance) : item.receiver.transmitterDistanceMiles,
      recommended: index === 0
    }));
  }

  function fallbackReceivers(url) {
    const frequency = finite(url.searchParams.get('frequency'));
    const userLat = finite(url.searchParams.get('lat'));
    const userLon = finite(url.searchParams.get('lon'));
    const txLat = finite(url.searchParams.get('txLat'));
    const txLon = finite(url.searchParams.get('txLon'));
    if (!Number.isFinite(frequency)) return [];

    const hasUser = Number.isFinite(userLat) && Number.isFinite(userLon);
    const hasTx = Number.isFinite(txLat) && Number.isFinite(txLon);
    const localBand = frequency < 2000;
    const direct = hasUser && hasTx ? milesBetween(userLat, userLon, txLat, txLon) : null;
    const eligible = CATALOG
      .filter((receiver) => frequency >= receiver.minKHz && frequency <= receiver.maxKHz)
      .map((receiver, index) => {
        const userDistance = hasUser ? milesBetween(userLat, userLon, receiver.lat, receiver.lon) : null;
        const txDistance = hasTx ? milesBetween(txLat, txLon, receiver.lat, receiver.lon) : null;
        const proximity = proximityScore(userDistance);
        const station = stationSignalScore(txDistance);
        const path = pathScore(direct, userDistance, txDistance);
        const solar = solarSimilarity(userLon, receiver.lon, frequency);
        const score = localBand
          ? proximity
          : (hasTx ? station * 0.45 + path * 0.30 + proximity * 0.15 + solar * 0.10 : proximity * 0.82 + solar * 0.18);
        return { ...receiver, index, userDistance, txDistance, path, score };
      })
      .sort((a, b) => b.score - a.score || a.index - b.index);

    if (!eligible.length) return [];
    const picks = [];
    const seen = new Set();
    const add = (receiver, role, reason) => {
      if (!receiver || seen.has(receiver.id)) return;
      seen.add(receiver.id);
      picks.push({ ...receiver, role, reason });
    };

    const best = eligible[0];
    add(best, localBand ? 'NEAR YOU' : 'BEST MATCH', localBand
      ? 'Closest built-in fallback receiver for this local/regional frequency.'
      : 'Best built-in fallback for hearing this transmitter and following its path toward you.');
    if (hasTx) {
      add([...eligible].sort((a, b) => (a.txDistance ?? Infinity) - (b.txDistance ?? Infinity))[0], 'STATION CHECK', 'Closest built-in fallback to the transmitter.');
    }
    if (hasUser) {
      add([...eligible].sort((a, b) => (a.userDistance ?? Infinity) - (b.userDistance ?? Infinity))[0], 'NEAR YOU', 'Closest built-in fallback to your listening location.');
    }
    for (const receiver of eligible) {
      if (picks.length >= 7) break;
      add(receiver, 'ALTERNATE', 'Another built-in public KiwiSDR covering this frequency.');
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

  function responseWithReceivers(response, payload, receivers, source) {
    const headers = new Headers(response?.headers || {});
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.set('cache-control', 'private, max-age=0, no-store');
    headers.set('x-freqbeacon-sdr-directory', VERSION);
    return new Response(JSON.stringify({ ...payload, receivers, source }), {
      status: 200,
      statusText: response?.statusText || 'OK',
      headers
    });
  }

  function fallbackResponse(url, reason = 'dynamic-timeout') {
    const receivers = fallbackReceivers(url);
    const payload = {
      receivers,
      source: `built-in-fallback:${reason}`,
      warning: 'Live receiver directory was unavailable; using the emergency receiver catalog.',
      generatedAt: new Date().toISOString()
    };
    return responseWithReceivers(null, payload, receivers, payload.source);
  }

  window.fetch = async (input, init) => {
    const url = receiverRequest(input, init);
    if (!url) return upstreamFetch(input, init);
    if (init?.signal?.aborted) throw new DOMException('The user aborted a request.', 'AbortError');

    const timeout = new Promise((resolve) => {
      window.setTimeout(() => resolve(null), DYNAMIC_TIMEOUT_MS);
    });
    const dynamic = upstreamFetch(input, init)
      .then(async (response) => {
        if (!response.ok) return null;
        const payload = await response.clone().json();
        if (!Array.isArray(payload?.receivers) || !payload.receivers.length) return null;
        const receivers = rerankForListening(payload.receivers, url);
        const source = `${payload.source || 'receiverbook'}+listening-path-v4`;
        trace('dynamic-ranked', {
          frequency: url.searchParams.get('frequency'),
          source,
          count: receivers.length,
          top: receivers.slice(0, 4).map((receiver) => ({ name: receiver.name, role: receiver.role, txMiles: receiver.transmitterDistanceMiles }))
        });
        return responseWithReceivers(response, payload, receivers, source);
      })
      .catch((error) => {
        trace('dynamic-error', { message: error?.message || String(error) });
        return null;
      });

    const resolved = await Promise.race([dynamic, timeout]);
    if (resolved) return resolved;
    trace('fallback', { frequency: url.searchParams.get('frequency'), reason: 'dynamic-timeout-or-error' });
    return fallbackResponse(url);
  };

  const quality = {
    receiverName: '',
    samples: [],
    timer: null,
    attempted: new Set(),
    switches: 0,
    manualOverride: false
  };

  function currentFrequency() {
    const text = document.querySelector('[data-sdr-frequency]')?.textContent || '';
    const match = text.match(/([0-9][0-9,.]*)\s*kHz/i);
    if (!match) return null;
    const value = Number(match[1].replace(/,/g, ''));
    return Number.isFinite(value) ? value : null;
  }

  function currentMode() {
    return String(document.querySelector('[data-sdr-mode]')?.value || 'am').toLowerCase();
  }

  function currentReceiverName() {
    return document.querySelector('[data-sdr-receiver-button-name]')?.textContent?.trim() || '';
  }

  function liveStatus() {
    return String(document.querySelector('[data-sdr-status]')?.textContent || '').trim().toLowerCase() === 'live rf';
  }

  function parseRssi() {
    const text = document.querySelector('[data-sdr-rssi]')?.textContent || '';
    const match = text.match(/RSSI\s+(-?[0-9.]+)\s*dB/i);
    const value = Number(match?.[1]);
    return Number.isFinite(value) ? value : null;
  }

  function median(values) {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function clearQualityTimer() {
    window.clearTimeout(quality.timer);
    quality.timer = null;
  }

  function resetQuality({ clearManual = false } = {}) {
    clearQualityTimer();
    quality.receiverName = '';
    quality.samples = [];
    quality.attempted.clear();
    quality.switches = 0;
    if (clearManual) quality.manualOverride = false;
  }

  function showWeakMessage(text) {
    const message = document.querySelector('[data-sdr-message]');
    if (!message) return;
    message.textContent = text;
    message.classList.add('is-error');
  }

  function switchFromWeakReceiver(receiverName, rssi) {
    if (quality.manualOverride || quality.switches >= MAX_WEAK_SWITCHES) {
      showWeakMessage(`Receiver is connected, but the target is very weak here (${rssi.toFixed(1)} dB). Use Receiver Options to try another listening point.`);
      return;
    }

    quality.attempted.add(receiverName);
    const receiverButton = document.querySelector('[data-sdr-receiver-button]');
    receiverButton?.click();
    window.setTimeout(() => {
      const choices = [...document.querySelectorAll('[data-sdr-choice-index]')];
      const next = choices.find((choice) => {
        if (choice.classList.contains('is-selected')) return false;
        const name = choice.querySelector('.sdr-choice-name')?.textContent?.trim() || '';
        return name && !quality.attempted.has(name);
      });
      if (!next) {
        document.querySelector('[data-sdr-chooser-close]')?.click();
        showWeakMessage(`A receiver connected, but none of the ranked receivers is hearing a useful signal at this frequency right now (${rssi.toFixed(1)} dB on the last receiver).`);
        return;
      }
      const nextName = next.querySelector('.sdr-choice-name')?.textContent?.trim() || '';
      if (nextName) quality.attempted.add(nextName);
      quality.switches += 1;
      trace('weak-signal-switch', { from: receiverName, to: nextName, medianRssi: rssi });
      next.click();
    }, 140);
  }

  function evaluateSignal(receiverName) {
    quality.timer = null;
    if (quality.manualOverride || !liveStatus() || currentReceiverName() !== receiverName) return;
    const frequency = currentFrequency();
    const mode = currentMode();
    if (!Number.isFinite(frequency) || frequency < 2000 || !['am', 'sam'].includes(mode)) return;
    if (quality.samples.length < MIN_SIGNAL_SAMPLES) return;

    const rssi = median(quality.samples);
    if (!Number.isFinite(rssi)) return;
    if (rssi > WEAK_RSSI_DB) {
      trace('signal-accepted', { receiver: receiverName, medianRssi: rssi, samples: quality.samples.length });
      return;
    }
    switchFromWeakReceiver(receiverName, rssi);
  }

  function sampleSignal() {
    if (!liveStatus()) return;
    const frequency = currentFrequency();
    const mode = currentMode();
    if (!Number.isFinite(frequency) || frequency < 2000 || !['am', 'sam'].includes(mode)) return;
    const receiverName = currentReceiverName();
    const rssi = parseRssi();
    if (!receiverName || !Number.isFinite(rssi)) return;

    if (quality.receiverName !== receiverName) {
      clearQualityTimer();
      quality.receiverName = receiverName;
      quality.samples = [];
    }
    quality.samples.push(rssi);
    if (quality.samples.length > 80) quality.samples.shift();
    if (!quality.timer && !quality.manualOverride) {
      quality.timer = window.setTimeout(() => evaluateSignal(receiverName), SIGNAL_CHECK_MS);
    }
  }

  function installQualityMonitor() {
    const rssi = document.querySelector('[data-sdr-rssi]');
    if (!rssi || rssi.dataset.usefulSignalMonitor === '1') return false;
    rssi.dataset.usefulSignalMonitor = '1';
    new MutationObserver(sampleSignal).observe(rssi, { childList: true, characterData: true, subtree: true });
    return true;
  }

  // The player's document click handler calls stopImmediatePropagation(), so use
  // pointerdown to reset manual/quality state before each new Listen Live gesture.
  document.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.listen-live-button')) resetQuality({ clearManual: true });
  }, true);

  document.addEventListener('click', (event) => {
    if (event.isTrusted && event.target.closest('[data-sdr-choice-index]')) {
      quality.manualOverride = true;
      clearQualityTimer();
      trace('manual-receiver', { receiver: event.target.closest('.sdr-choice')?.querySelector('.sdr-choice-name')?.textContent?.trim() || '' });
    }
  }, true);

  if (!installQualityMonitor()) {
    const observer = new MutationObserver(() => {
      if (installQualityMonitor()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.__freqbeaconReceiverOptions = { version: VERSION };
})();
