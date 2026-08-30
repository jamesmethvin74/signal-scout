(() => {
  if (window.__freqbeaconInstantReceiverOptionsV1) return;
  window.__freqbeaconInstantReceiverOptionsV1 = true;

  const trace = (event, detail = {}) => window.__freqbeaconSdrTrace?.(`options-${event}`, detail);
  const upstreamFetch = window.fetch.bind(window);
  const LOCATION_STORAGE_KEY = 'signalScout:location:v1';
  const VERSION = 'instant-options-v1-20260829';

  // The chooser must never wait on ReceiverBook, Cloudflare, or any network body.
  // This mirrors the deployment-bundled KiwiSDR safety catalog and is ranked on
  // the phone for the current frequency, user location, and transmitter path.
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

  let activeCardContext = null;

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
    const frequency = finite(url.searchParams.get('frequency'));
    const userLat = finite(url.searchParams.get('lat'));
    const userLon = finite(url.searchParams.get('lon'));
    let txLat = finite(url.searchParams.get('txLat'));
    let txLon = finite(url.searchParams.get('txLon'));

    if (!Number.isFinite(frequency)) return [];
    if ((!Number.isFinite(txLat) || !Number.isFinite(txLon))
      && activeCardContext
      && Math.abs(activeCardContext.frequency - frequency) < 0.11) {
      txLat = activeCardContext.txLat;
      txLon = activeCardContext.txLon;
    }

    const hasUser = Number.isFinite(userLat) && Number.isFinite(userLon);
    const hasTx = Number.isFinite(txLat) && Number.isFinite(txLon);
    const local = frequency < 2000;
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
      add(best, 'NEAR YOU', `Closest useful receiver for this local/regional frequency · ${distance}.`);
    } else {
      const near = Number.isFinite(best.userDistance) && best.userDistance <= 250;
      add(
        best,
        near ? 'NEAR YOU' : 'BEST MATCH',
        near
          ? 'Closest strong match to your listening location while keeping a useful HF path.'
          : 'Best balance of your location, transmitter path, frequency, and current day/night conditions.'
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
        'Alternate receiver with a similar transmitter path and useful HF propagation geometry.'
      );
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

  window.fetch = (input, init) => {
    const url = receiverRequest(input, init);
    if (!url) return upstreamFetch(input, init);
    if (init?.signal?.aborted) return Promise.reject(new DOMException('The user aborted a request.', 'AbortError'));

    const receivers = rankReceivers(url);
    const payload = receivers.length
      ? { receivers, source: 'instant-local-options', generatedAt: new Date().toISOString() }
      : { error: 'No built-in SDR covers this frequency', receivers: [], source: 'instant-local-options', generatedAt: new Date().toISOString() };

    trace('local-ranked', { frequency: url.searchParams.get('frequency'), count: receivers.length, names: receivers.map((receiver) => receiver.name) });
    return Promise.resolve(new Response(JSON.stringify(payload), {
      status: receivers.length ? 200 : 503,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, max-age=0, no-store',
        'x-freqbeacon-sdr-directory': VERSION
      }
    }));
  };

  function normalizeText(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function setTextIfChanged(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  function setPlainTextNode(element, text) {
    if (!element) return;
    if (element.childNodes.length === 1 && element.firstChild?.nodeType === Node.TEXT_NODE) {
      if (element.firstChild.nodeValue !== text) element.firstChild.nodeValue = text;
      return;
    }
    setTextIfChanged(element, text);
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
    const exactName = candidates.find((station) => String(station.name || '').trim().toLowerCase() === normalizedName);
    const station = exactName || candidates[0];
    const lat = Number(station?.lat);
    const lon = Number(station?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;
    return { lat, lon };
  }

  function prepareReceiverContext(card) {
    const frequency = frequencyFromCard(card);
    if (!Number.isFinite(frequency)) {
      trace('context-failed', { reason: 'invalid-card-frequency' });
      return false;
    }

    const input = document.getElementById('lookupFrequency');
    if (!input) {
      trace('context-failed', { reason: 'lookup-frequency-input-missing', frequency });
      return false;
    }

    const stationName = card.querySelector('.station-name')?.textContent?.trim() || '';
    const tx = stationCoordinates(frequency, stationName);
    activeCardContext = {
      frequency,
      stationName,
      txLat: tx?.lat ?? null,
      txLon: tx?.lon ?? null
    };

    input.value = Number.isInteger(frequency) ? String(frequency) : frequency.toFixed(1);
    input.dispatchEvent(new Event('input', { bubbles: false }));

    const primary = document.querySelector('#lookupResults .lookup-result-primary, #lookupResults .lookup-result');
    if (primary) {
      const frequencyText = `${Number.isInteger(frequency) ? frequency.toLocaleString() : frequency.toLocaleString(undefined, { maximumFractionDigits: 1 })} kHz`;
      setPlainTextNode(primary.querySelector('.lookup-result-frequency'), frequencyText);
      if (stationName) setPlainTextNode(primary.querySelector('h3'), stationName);
    }

    trace('context-prepared', {
      frequency,
      inputValue: input.value,
      station: stationName,
      txLat: activeCardContext.txLat,
      txLon: activeCardContext.txLon,
      primaryLookupResultPresent: Boolean(primary)
    });
    return true;
  }

  let polishTimer = null;

  function polishChooser() {
    const chooser = document.querySelector('.sdr-chooser');
    const list = chooser?.querySelector('[data-sdr-chooser-list]');
    if (!chooser || chooser.hidden || !list?.children.length) return false;

    const subtitle = chooser.querySelector('[data-sdr-chooser-subtitle]');
    if (subtitle) {
      const rankedText = subtitle.textContent.replace(/\s*★.*$/, '').trim();
      setTextIfChanged(subtitle, `${rankedText} ★ marks the best match for what you may hear at your location.`);
    }

    const seen = new Set();
    [...list.querySelectorAll('.sdr-choice')].forEach((choice) => {
      const name = normalizeText(choice.querySelector('.sdr-choice-name')?.textContent);
      const location = normalizeText(choice.querySelector('.sdr-choice-location')?.textContent);
      const distance = normalizeText(choice.querySelector('.sdr-choice-distance')?.textContent);
      const key = `${name}|${location}|${distance}`;

      if (seen.has(key)) {
        choice.remove();
        return;
      }
      seen.add(key);

      const recommended = choice.querySelector('.sdr-choice-badge.is-recommended');
      const roleBadges = [...choice.querySelectorAll('.sdr-choice-badge:not(.is-recommended)')]
        .map((badge) => normalizeText(badge.textContent));
      const reason = choice.querySelector('.sdr-choice-reason');

      if (recommended) {
        setTextIfChanged(recommended, '★ Best match for you');
        if (reason && roleBadges.includes('near you')) {
          setTextIfChanged(reason, 'Best receiver for comparing with what your radio is likely to hear at your location. It is nearby and still follows a useful HF path.');
        } else if (reason) {
          setTextIfChanged(reason, 'Best overall receiver for comparing against your location, considering distance, path, frequency, and current day/night conditions.');
        }
      }

      if (reason && roleBadges.includes('station check')) {
        setTextIfChanged(reason, 'Best used to check whether the transmitter appears active. It is not necessarily the best receiver for matching what you should hear at your location.');
      }
    });
    trace('chooser-polished', { choiceCount: list.querySelectorAll('.sdr-choice').length });
    return true;
  }

  function scheduleChooserPolish(attempt = 0) {
    window.clearTimeout(polishTimer);
    polishTimer = window.setTimeout(() => {
      if (polishChooser()) return;
      if (attempt < 4) scheduleChooserPolish(attempt + 1);
      else trace('chooser-polish-exhausted');
    }, attempt === 0 ? 0 : 40);
  }

  function openReceiverOptions(card) {
    trace('open-start');
    if (!prepareReceiverContext(card)) return;

    const smartButton = document.getElementById('lookupReceiverButton');
    if (!smartButton) {
      trace('open-failed', { reason: 'smart-button-missing' });
      return;
    }

    const openPlayer = document.querySelector('#sdrPlayer:not([hidden])');
    trace('open-before-player-close', { openPlayer: Boolean(openPlayer) });
    if (openPlayer) openPlayer.querySelector('[data-sdr-close]')?.click();

    // No animation frame, no navigation, and no network wait. The hidden SMART
    // handler immediately receives the locally ranked receiver response and
    // opens the existing chooser in this tap turn.
    trace('before-smart-click', { lookupFrequency: document.getElementById('lookupFrequency')?.value || '' });
    smartButton.click();
    scheduleChooserPolish();
  }

  window.addEventListener('click', (event) => {
    const button = event.target.closest('.card-receiver-options');
    if (!button) return;
    const card = button.closest('.signal-card');
    if (!card) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    trace('card-click', { isTrusted: event.isTrusted });
    openReceiverOptions(card);
  }, true);

  document.getElementById('lookupReceiverButton')?.addEventListener('click', () => {
    trace('lookup-smart-button-handler-observed');
    scheduleChooserPolish();
  });

  window.__freqbeaconInstantReceiverOptions = {
    version: VERSION,
    catalogCount: CATALOG.length
  };
})();
