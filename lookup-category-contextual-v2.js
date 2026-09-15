(() => {
  'use strict';

  const base = window.FREQBEACON_LOOKUP_CATEGORIES;
  const engine = window.FREQBEACON_IDENTIFICATION_ENGINE;
  const stage = document.getElementById('lookupResults');
  const count = document.getElementById('lookupResultCount');
  const status = document.getElementById('lookupStatus');
  const title = document.getElementById('lookupResultsTitle');
  if (!base || !engine || !stage || !count) return;

  const AIR_NETWORKS = Object.freeze({
    caribbean: Object.freeze([
      Object.freeze({ name: 'Caribbean Family A', badge: 'GULF / CARIBBEAN', serviceArea: 'New York Radio · Caribbean Family A', frequencies: Object.freeze([2887, 3455, 5550, 6577, 8846, 11396]) }),
      Object.freeze({ name: 'Caribbean Family B', badge: 'GULF / CARIBBEAN', serviceArea: 'New York Radio · Caribbean Family B', frequencies: Object.freeze([5520, 6586, 8918, 11330, 13297, 17907]) })
    ]),
    atlantic: Object.freeze([
      Object.freeze({ name: 'North Atlantic Family A', badge: 'NORTH ATLANTIC', serviceArea: 'New York Radio · North Atlantic Family A', frequencies: Object.freeze([3016, 5598, 8906, 13306, 17946, 21964]) }),
      Object.freeze({ name: 'North Atlantic Family E', badge: 'NORTH ATLANTIC', serviceArea: 'New York Radio · North Atlantic Family E', frequencies: Object.freeze([2962, 6628, 8825, 11309, 13354, 17952]) })
    ]),
    pacific: Object.freeze([
      Object.freeze({ name: 'Central East Pacific', badge: 'PACIFIC PATH', serviceArea: 'San Francisco Radio · Central East Pacific', frequencies: Object.freeze([3413, 3452, 5574, 5667, 6673, 8843, 10057, 11330, 13354]) }),
      Object.freeze({ name: 'North Pacific', badge: 'PACIFIC PATH', serviceArea: 'San Francisco Radio · North Pacific', frequencies: Object.freeze([2932, 5628, 6655, 8915, 8951, 10048, 11330, 13273, 13339, 17946, 21925]) }),
      Object.freeze({ name: 'Central West Pacific', badge: 'PACIFIC PATH', serviceArea: 'San Francisco Radio · Central West Pacific', frequencies: Object.freeze([2998, 4666, 6532, 8903, 11384, 13300, 17904, 21985]) })
    ])
  });

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[ch]));

  function selectedCategory() {
    return base.selected?.() || window.FREQBEACON_LOOKUP_SELECTED_CATEGORY || '';
  }

  function frequency(entry) {
    const value = Number(entry?.frequencyKHz ?? entry?.frequency);
    return Number.isFinite(value) ? value : NaN;
  }

  function milesBetween(a, b) {
    const lat1 = Number(a?.lat);
    const lon1 = Number(a?.lon);
    const lat2 = Number(b?.lat);
    const lon2 = Number(b?.lon);
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
    const radius = 3958.8;
    const radians = Math.PI / 180;
    const dLat = (lat2 - lat1) * radians;
    const dLon = (lon2 - lon1) * radians;
    const x = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) ** 2;
    return 2 * radius * Math.asin(Math.sqrt(x));
  }

  function localSolarHour(receiver) {
    const now = new Date();
    const lon = Number(receiver?.lon);
    const utc = now.getUTCHours() + now.getUTCMinutes() / 60;
    return Number.isFinite(lon) ? (utc + lon / 15 + 24) % 24 : utc;
  }

  function isNight(receiver) {
    const hour = localSolarHour(receiver);
    return hour < 6 || hour >= 18;
  }

  function tuneHref(frequencyKHz, mode = 'am') {
    return `/zero?frequency=${encodeURIComponent(Number(frequencyKHz).toFixed(3))}&mode=${encodeURIComponent(mode)}&from=lookup-category`;
  }

  function receiverRegion(receiver) {
    const lat = Number(receiver?.lat);
    const lon = Number(receiver?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
    if (lat >= 15 && lat <= 75 && lon >= -170 && lon <= -50) return 'north-america';
    if (lat >= 34 && lat <= 72 && lon >= -25 && lon <= 45) return 'europe';
    if (lat >= -58 && lat < 15 && lon >= -85 && lon <= -30) return 'south-america';
    if (lat >= -38 && lat <= 38 && lon >= -20 && lon <= 55) return 'africa';
    if (lat >= 5 && lat <= 80 && lon > 45 && lon <= 180) return 'asia';
    if (lat >= -50 && lat < 10 && lon >= 105 && lon <= 180) return 'oceania';
    return '';
  }

  function aviationContext(receiver) {
    const region = receiverRegion(receiver);
    const lat = Number(receiver?.lat);
    const lon = Number(receiver?.lon);
    if (region !== 'north-america') return null;

    if (lon <= -108) {
      return { label: 'western North America / Pacific', networks: AIR_NETWORKS.pacific };
    }

    // South-central and southeastern receivers are much more useful for the
    // Caribbean/Gulf-facing New York Radio families than for blindly leading
    // with North Atlantic/Europe-facing traffic.
    if (lat <= 37 && lon >= -108 && lon <= -76) {
      return { label: 'south-central North America / Gulf-Caribbean', networks: AIR_NETWORKS.caribbean };
    }

    if (lon >= -88) {
      return { label: 'eastern North America / North Atlantic', networks: AIR_NETWORKS.atlantic };
    }

    return {
      label: 'central North America',
      networks: Object.freeze([AIR_NETWORKS.caribbean[0], AIR_NETWORKS.atlantic[0]])
    };
  }

  function hfTimeScore(frequencyKHz, night) {
    const kHz = Number(frequencyKHz);
    if (!Number.isFinite(kHz)) return -1000;
    if (night) {
      if (kHz < 5000) return 250;
      if (kHz < 9000) return 220;
      if (kHz < 14000) return 90;
      if (kHz < 18000) return 20;
      return -120;
    }
    if (kHz < 5000) return -120;
    if (kHz < 9000) return 80;
    if (kHz < 14000) return 250;
    if (kHz < 18000) return 190;
    return 90;
  }

  function aviationCard(item) {
    const detail = `USB · ${item.serviceArea} · ${item.night ? 'night-path frequencies prioritized' : 'day-path frequencies prioritized'}`;
    return `<article class="lookup-category-result">
      <div class="lookup-category-copy">
        <div class="lookup-category-result-top">
          <strong>${esc(item.name)}</strong>
          <span class="lookup-status-pill is-now"><i aria-hidden="true"></i>${esc(item.badge)}</span>
        </div>
        <span class="lookup-category-frequency">${esc(engine.formatFrequency(item.frequencyKHz))}</span>
        <small>${esc(detail)}</small>
      </div>
      <a class="lookup-tune" href="${esc(tuneHref(item.frequencyKHz, 'usb'))}">TUNE ON RADIO</a>
    </article>`;
  }

  function browseAviation(receiver) {
    const context = aviationContext(receiver);
    if (!context) return base.browse(receiver, { source: 'contextual-v2-non-na' });

    const night = isNight(receiver);
    const seen = new Set();
    const ranked = [];
    context.networks.forEach((network, networkIndex) => {
      network.frequencies.forEach((frequencyKHz) => {
        const key = Number(frequencyKHz).toFixed(3);
        if (seen.has(key)) return;
        seen.add(key);
        ranked.push({
          frequencyKHz,
          name: network.name,
          badge: network.badge,
          serviceArea: network.serviceArea,
          night,
          score: 500 - networkIndex * 80 + hfTimeScore(frequencyKHz, night)
        });
      });
    });

    ranked.sort((a, b) => b.score - a.score || a.frequencyKHz - b.frequencyKHz);
    const visible = ranked.slice(0, 10);
    if (title) title.textContent = 'AVIATION ON THIS RECEIVER';
    count.textContent = `${visible.length} contextual Aviation candidate${visible.length === 1 ? '' : 's'}`;
    stage.innerHTML = visible.map(aviationCard).join('');
    if (status) {
      status.className = 'lookup-status';
      status.textContent = `Aviation · ${context.label} · FAA HF network families ranked for receiver geography + local time · not live signal proof`;
    }
    return true;
  }

  function sportsStations() {
    return (window.FREQBEACON_ZERO_AM_CATALOG || []).filter((station) =>
      (station?.categories || []).some((category) => String(category).toLowerCase() === 'sports')
    );
  }

  function sportsCandidate(station, receiver) {
    const distance = milesBetween(receiver, station);
    if (!Number.isFinite(distance)) return null;
    const night = isNight(receiver);
    const power = Math.max(0, Number(night ? station?.nightPowerW : station?.dayPowerW) || 0);
    const categories = (station?.categories || []).map((value) => String(value).toLowerCase());
    const allSports = categories.length === 1 && categories[0] === 'sports';

    let score = -Infinity;
    if (distance <= 100) score = 2200 - distance * 5;
    else if (distance <= 250) score = 1700 - distance * 2.5;
    else if (distance <= 500) score = 950 - distance;
    else if (night && distance <= 1200 && power >= 5000) score = 650 - distance * 0.35;

    if (!Number.isFinite(score)) return null;
    score += Math.log10(Math.max(100, power)) * 55;
    if (allSports) score += 220;
    if (/texas/i.test(String(receiver?.location || '')) && /texas/i.test(String(station?.location || ''))) score += 180;

    let label = 'SPORTS TRY';
    if (distance <= 100) label = 'LOCAL SPORTS';
    else if (distance <= 250) label = 'REGIONAL SPORTS';
    else if (night && distance > 500) label = 'NIGHT DX';

    return { station, distance, power, night, score, label };
  }

  function sportsCard(item) {
    const station = item.station;
    const powerText = item.power >= 1000 ? `${Math.round(item.power / 1000)} kW ${item.night ? 'night' : 'day'}` : `${Math.round(item.power)} W ${item.night ? 'night' : 'day'}`;
    const detail = [
      station.callsign,
      station.location,
      `${Math.round(item.distance).toLocaleString()} mi from receiver`,
      powerText
    ].filter(Boolean).join(' · ');
    return `<article class="lookup-category-result">
      <div class="lookup-category-copy">
        <div class="lookup-category-result-top">
          <strong>${esc(station.name || station.callsign || 'Sports radio')}</strong>
          <span class="lookup-status-pill is-now"><i aria-hidden="true"></i>${esc(item.label)}</span>
        </div>
        <span class="lookup-category-frequency">${esc(engine.formatFrequency(frequency(station)))}</span>
        <small>${esc(detail)}</small>
        ${station.description ? `<small>${esc(station.description)}</small>` : ''}
      </div>
      <a class="lookup-tune" href="${esc(tuneHref(frequency(station), 'am'))}">TUNE ON RADIO</a>
    </article>`;
  }

  async function browseSports(receiver, context = {}) {
    const ranked = sportsStations()
      .map((station) => sportsCandidate(station, receiver))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score || a.distance - b.distance);

    if (!ranked.length) return base.browse(receiver, { ...context, source: 'contextual-v2-sports-fallback' });

    const visible = ranked.slice(0, 10);
    if (title) title.textContent = 'SPORTS ON THIS RECEIVER';
    count.textContent = `${visible.length} receiver-ranked Sports candidate${visible.length === 1 ? '' : 's'}`;
    stage.innerHTML = visible.map(sportsCard).join('');
    if (status) {
      status.className = 'lookup-status';
      status.textContent = `Sports · AM stations ranked from ${receiver.location || receiver.name || 'this receiver'} using distance + day/night power · actual program may vary`;
    }
    return true;
  }

  async function browse(receiver, context = {}) {
    const key = selectedCategory();
    if (!receiver || !key) return base.browse(receiver, context);
    if (key === 'sports') return browseSports(receiver, context);
    if (key === 'aviation') return browseAviation(receiver);
    return base.browse(receiver, context);
  }

  window.FREQBEACON_LOOKUP_CATEGORIES = Object.freeze({ ...base, browse });
})();
