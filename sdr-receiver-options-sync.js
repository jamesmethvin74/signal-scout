(() => {
  if (window.__freqbeaconReceiverOptionsSyncV1) return;
  window.__freqbeaconReceiverOptionsSyncV1 = true;

  const VERSION = 'receiver-options-sync-v1';
  const LOCATION_STORAGE_KEY = 'signalScout:location:v1';
  const upstreamFetch = window.fetch.bind(window);

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

  let activeContext = null;
  let instantReceivers = [];

  function finite(value) {
    if (value == null || String(value).trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
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

  function loadStoredLocation() {
    try {
      const payload = JSON.parse(window.localStorage?.getItem(LOCATION_STORAGE_KEY) || 'null');
      const lat = Number(payload?.lat);
      const lon = Number(payload?.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    } catch {
      return null;
    }
  }

  function frequencyFromCard(card) {
    const freqEl = card?.querySelector('.frequency');
    if (!freqEl) return null;
    const unit = freqEl.querySelector('span')?.textContent?.trim().toLowerCase() || '';
    const clone = freqEl.cloneNode(true);
    clone.querySelector('span')?.remove();
    const value = Number(clone.textContent.replace(/,/g, '').trim());
    if (!Number.isFinite(value) || value <= 0) return null;
    return unit.includes('mhz') ? value * 1000 : value;
  }

  function stationCoordinates(frequency, stationName) {
    const stations = window.SIGNAL_SCOUT_STATIONS || [];
    const normalizedName = String(stationName || '').trim().toLowerCase();
    const candidates = stations.filter((station) => Math.abs(Number(station.frequency) - Number(frequency)) < 0.11);
    const exact = candidates.find((station) => String(station.name || '').trim().toLowerCase() === normalizedName);
    const station = exact || candidates[0];
    const lat = Number(station?.lat);
    const lon = Number(station?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;
    return { lat, lon };
  }

  function rankReceivers({ frequency, userLat, userLon, txLat, txLon }) {
    const local = frequency < 2000;
    const hasUser = Number.isFinite(userLat) && Number.isFinite(userLon);
    const hasTx = Number.isFinite(txLat) && Number.isFinite(txLon);
    const direct = hasUser && hasTx ? milesBetween(userLat, userLon, txLat, txLon) : null;

    const eligible = CATALOG
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
        let score;
        if (local) score = hasUser ? proximity * 0.92 + 8 : 45;
        else if (hasUser && hasTx) score = proximity * 0.50 + pathSimilarity * 0.38 + solar * 0.12;
        else if (hasUser) score = proximity * 0.82 + solar * 0.18;
        else if (hasTx && Number.isFinite(txDistance)) score = clamp(100 - txDistance / 30, 5, 95);
        else score = 50;
        return { ...receiver, userDistance, txDistance, pathSimilarity, solar, score };
      })
      .sort((a, b) => b.score - a.score || (a.userDistance ?? Infinity) - (b.userDistance ?? Infinity));

    const picks = [];
    const picked = new Set();
    const add = (receiver, role, reason) => {
      if (!receiver || picked.has(receiver.id)) return;
      picked.add(receiver.id);
      picks.push({ ...receiver, role, reason });
    };

    const best = eligible[0];
    if (!best) return [];
    if (local) {
      add(best, 'NEAR YOU', Number.isFinite(best.userDistance)
        ? `Closest useful receiver for this local/regional frequency · ${Math.round(best.userDistance)} mi from you.`
        : 'Closest useful receiver for this local/regional frequency.');
    } else {
      add(best, Number.isFinite(best.userDistance) && best.userDistance <= 250 ? 'NEAR YOU' : 'BEST MATCH',
        'Best balance of your location, transmitter path, frequency, and current day/night conditions.');
    }

    if (hasUser) {
      add([...eligible].sort((a, b) => (a.userDistance ?? Infinity) - (b.userDistance ?? Infinity))[0],
        'NEAR YOU', 'Useful comparison point because its RF environment is geographically closest to yours.');
    }
    if (!local && hasTx) {
      add([...eligible].sort((a, b) => (a.txDistance ?? Infinity) - (b.txDistance ?? Infinity))[0],
        'STATION CHECK', 'Closer to the transmitter; useful for checking whether the broadcast appears to be reaching the airwaves.');
    }
    if (!local && hasUser && hasTx) {
      add([...eligible].filter((receiver) => receiver.id !== best.id)
        .sort((a, b) => (b.pathSimilarity * 0.72 + b.solar * 0.28) - (a.pathSimilarity * 0.72 + a.solar * 0.28))[0],
        'PROPAGATION ALT', 'Alternate receiver with a similar transmitter path and useful HF propagation geometry.');
    }
    for (const receiver of eligible) {
      if (picks.length >= 7) break;
      add(receiver, 'ALTERNATE', 'Another public KiwiSDR that covers this frequency.');
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

  function activeRankedReceivers(url = null) {
    const frequency = finite(url?.searchParams?.get('frequency')) ?? activeContext?.frequency;
    if (!Number.isFinite(frequency)) return [];
    const stored = loadStoredLocation();
    const userLat = finite(url?.searchParams?.get('lat')) ?? stored?.lat ?? null;
    const userLon = finite(url?.searchParams?.get('lon')) ?? stored?.lon ?? null;
    let txLat = finite(url?.searchParams?.get('txLat'));
    let txLon = finite(url?.searchParams?.get('txLon'));
    if ((!Number.isFinite(txLat) || !Number.isFinite(txLon)) && activeContext && Math.abs(activeContext.frequency - frequency) < 0.11) {
      txLat = activeContext.txLat;
      txLon = activeContext.txLon;
    }
    return rankReceivers({ frequency, userLat, userLon, txLat, txLon });
  }

  function receiverRequest(input, init) {
    const method = String(init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET') return null;
    try {
      const raw = input instanceof Request ? input.url : input;
      const url = new URL(String(raw), window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== '/api/sdr/receivers') return null;
      return url;
    } catch {
      return null;
    }
  }

  window.fetch = (input, init) => {
    const url = receiverRequest(input, init);
    if (!url) return upstreamFetch(input, init);
    if (init?.signal?.aborted) return Promise.reject(new DOMException('The user aborted a request.', 'AbortError'));
    const receivers = activeRankedReceivers(url);
    return Promise.resolve(new Response(JSON.stringify({ receivers, source: VERSION, generatedAt: new Date().toISOString() }), {
      status: receivers.length ? 200 : 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, max-age=0, no-store',
        'x-freqbeacon-sdr-directory': VERSION
      }
    }));
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatCoverage(receiver) {
    const min = Number(receiver?.minKHz);
    const max = Number(receiver?.maxKHz);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return 'KiwiSDR';
    const minText = min >= 1000 ? `${(min / 1000).toFixed(min % 1000 ? 1 : 0)} MHz` : `${Math.round(min)} kHz`;
    const maxText = max >= 1000 ? `${(max / 1000).toFixed(max % 1000 ? 1 : 0)} MHz` : `${Math.round(max)} kHz`;
    return `${minText}–${maxText}`;
  }

  function renderInstantChooser(frequency, stationName) {
    const chooser = document.querySelector('.sdr-chooser');
    if (!chooser || !instantReceivers.length) return false;
    chooser.dataset.freqbeaconInstant = 'true';
    const subtitle = chooser.querySelector('[data-sdr-chooser-subtitle]');
    if (subtitle) subtitle.textContent = `Ranked for ${Number(frequency).toLocaleString(undefined, { maximumFractionDigits: 1 })} kHz${stationName ? ` · ${stationName}` : ''}.`;
    const list = chooser.querySelector('[data-sdr-chooser-list]');
    if (!list) return false;
    list.innerHTML = instantReceivers.map((receiver, index) => {
      const distance = Number.isFinite(receiver.distanceMiles) ? `${Math.round(receiver.distanceMiles).toLocaleString()} mi from you` : '';
      const badges = [
        receiver.recommended ? '<span class="sdr-choice-badge is-recommended">★ Recommended</span>' : '',
        receiver.role && receiver.role !== 'ALTERNATE' ? `<span class="sdr-choice-badge">${escapeHtml(receiver.role)}</span>` : ''
      ].filter(Boolean).join('');
      return `
        <button type="button" class="sdr-choice ${index === 0 ? 'is-selected' : ''}" data-freqbeacon-instant-choice="${index}">
          <div class="sdr-choice-top">
            <div class="sdr-choice-name">${escapeHtml(receiver.name)}</div>
            <div class="sdr-choice-distance">${escapeHtml(distance)}</div>
          </div>
          <div class="sdr-choice-location">${escapeHtml(receiver.location)}</div>
          ${badges ? `<div class="sdr-choice-badges">${badges}</div>` : ''}
          <div class="sdr-choice-reason">${escapeHtml(receiver.reason)}</div>
          <div class="sdr-choice-meta">${escapeHtml(formatCoverage(receiver))} · PUBLIC KIWI</div>
        </button>`;
    }).join('');
    const foot = chooser.querySelector('[data-sdr-chooser-foot]');
    if (foot) {
      foot.classList.remove('is-warning');
      foot.textContent = 'Ranked instantly on this device. Public SDRs are independently operated and can fill up or go offline without warning.';
    }
    chooser.hidden = false;
    return true;
  }

  function syncChosenReceiver(receiver) {
    const button = document.getElementById('lookupReceiverButton');
    if (!button) return;
    button.click();
    let attempts = 0;
    const finish = () => {
      attempts += 1;
      const choices = [...document.querySelectorAll('.sdr-chooser [data-sdr-choice-index]')];
      const match = choices.find((choice) => choice.querySelector('.sdr-choice-name')?.textContent?.trim() === receiver.name)
        || choices.find((choice) => choice.querySelector('.sdr-choice-location')?.textContent?.trim() === receiver.location);
      if (match) {
        match.click();
        return;
      }
      if (attempts < 20) window.setTimeout(finish, 10);
    };
    window.setTimeout(finish, 0);
  }

  window.addEventListener('click', (event) => {
    const instantChoice = event.target.closest('[data-freqbeacon-instant-choice]');
    if (instantChoice) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const receiver = instantReceivers[Number(instantChoice.dataset.freqbeaconInstantChoice)];
      if (receiver) syncChosenReceiver(receiver);
      return;
    }

    const receiverButton = event.target.closest('.card-receiver-options');
    if (!receiverButton) return;
    const card = receiverButton.closest('.signal-card');
    if (!card) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const frequency = frequencyFromCard(card);
    if (!Number.isFinite(frequency)) return;
    const stationName = card.querySelector('.station-name')?.textContent?.trim() || '';
    const tx = stationCoordinates(frequency, stationName);
    const stored = loadStoredLocation();
    activeContext = {
      frequency,
      stationName,
      txLat: tx?.lat ?? null,
      txLon: tx?.lon ?? null,
      userLat: stored?.lat ?? null,
      userLon: stored?.lon ?? null
    };

    const input = document.getElementById('lookupFrequency');
    if (input) input.value = Number.isInteger(frequency) ? String(frequency) : frequency.toFixed(1);

    instantReceivers = rankReceivers({
      frequency,
      userLat: stored?.lat ?? null,
      userLon: stored?.lon ?? null,
      txLat: tx?.lat ?? null,
      txLon: tx?.lon ?? null
    });

    renderInstantChooser(frequency, stationName);
  }, true);

  window.__freqbeaconReceiverOptionsSync = {
    version: VERSION,
    catalogCount: CATALOG.length
  };
})();