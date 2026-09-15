(() => {
  'use strict';

  const base = window.FREQBEACON_LOOKUP_CATEGORIES;
  const engine = window.FREQBEACON_IDENTIFICATION_ENGINE;
  const contextCatalog = window.FREQBEACON_CONTEXT_CATALOG || {};
  const stage = document.getElementById('lookupResults');
  const count = document.getElementById('lookupResultCount');
  const status = document.getElementById('lookupStatus');
  const title = document.getElementById('lookupResultsTitle');
  if (!base || !engine || !stage || !count) return;

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

  function receiverLabel(receiver) {
    return receiver?.location || receiver?.name || 'the selected receiver';
  }

  function tuneHref(frequencyKHz, mode = 'am') {
    return `/zero?frequency=${encodeURIComponent(Number(frequencyKHz).toFixed(3))}&mode=${encodeURIComponent(mode)}&from=lookup-category`;
  }

  function coverageNote(key) {
    return contextCatalog?.coverage?.[key]?.note || '';
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
    if (distance <= 75) score = 2400 - distance * 5;
    else if (distance <= 200) score = 1900 - distance * 3;
    else if (distance <= 400) score = 1200 - distance * 1.4;
    else if (night && distance <= 1500 && power >= 5000) score = 760 - distance * 0.35;

    if (!Number.isFinite(score)) return null;
    score += Math.log10(Math.max(100, power)) * 55;
    if (allSports) score += 180;

    let label = 'SPORTS TRY';
    if (distance <= 75) label = 'LOCAL SPORTS';
    else if (distance <= 200) label = 'REGIONAL SPORTS';
    else if (night && distance > 400) label = 'NIGHT DX';

    return { station, distance, power, night, score, label };
  }

  function sportsCard(item) {
    const station = item.station;
    const powerText = item.power >= 1000
      ? `${Math.round(item.power / 1000)} kW ${item.night ? 'night' : 'day'}`
      : `${Math.round(item.power)} W ${item.night ? 'night' : 'day'}`;
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

    if (ranked.length) {
      const visible = ranked.slice(0, 10);
      if (title) title.textContent = 'SPORTS ON THIS RECEIVER';
      count.textContent = `${visible.length} receiver-ranked Sports candidate${visible.length === 1 ? '' : 's'}`;
      stage.innerHTML = visible.map(sportsCard).join('');
      if (status) {
        status.className = 'lookup-status';
        status.textContent = `Sports · ${receiverLabel(receiver)} · nearby AM ranked by receiver distance + day/night power · program format may vary`;
      }
      return true;
    }

    // The global HF schedule is still useful if it happens to carry a sports-
    // identified transmission. Delegate instead of inventing a local station.
    const result = await base.browse(receiver, { ...context, source: 'receiver-global-sports-fallback' });
    const cards = stage.querySelectorAll('.lookup-category-result').length;
    if (!cards) {
      if (title) title.textContent = 'SPORTS ON THIS RECEIVER';
      count.textContent = 'No receiver-local Sports matches in the current catalog';
      stage.innerHTML = `<div class="lookup-empty"><strong>Sports coverage is still being expanded here.</strong><p>${esc(coverageNote('sports') || 'The selected receiver is understood, but this region does not yet have enough local sports-station metadata to make a responsible recommendation.')}</p></div>`;
      if (status) {
        status.className = 'lookup-status';
        status.textContent = `Sports · receiver context confirmed for ${receiverLabel(receiver)} · local catalog coverage incomplete`;
      }
    }
    return result || true;
  }

  function insideBounds(receiver, bounds) {
    const lat = Number(receiver?.lat);
    const lon = Number(receiver?.lon);
    if (![lat, lon].every(Number.isFinite) || !bounds) return false;
    return lat >= Number(bounds.minLat) && lat <= Number(bounds.maxLat)
      && lon >= Number(bounds.minLon) && lon <= Number(bounds.maxLon);
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

  function aviationNetworkScore(network, receiver) {
    const inSector = insideBounds(receiver, network?.bounds);
    const distance = milesBetween(receiver, network?.center || {});
    return {
      network,
      inSector,
      distance,
      score: (inSector ? 3000 : 0) - Math.min(3000, Number.isFinite(distance) ? distance : 3000)
    };
  }

  function aviationCard(item) {
    const detail = [
      'USB',
      item.serviceArea,
      item.night ? 'night-path frequencies prioritized' : 'day-path frequencies prioritized'
    ].filter(Boolean).join(' · ');
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

  function globalAviationFallback() {
    return (window.FREQBEACON_IDENTIFICATION_CATALOG?.entries || [])
      .filter((entry) => (entry.categories || []).some((category) => String(category).toLowerCase() === 'aviation'))
      .filter((entry) => /hfgcs|military/i.test([entry.name, entry.description, entry.shortName].filter(Boolean).join(' ')))
      .filter((entry) => Number.isFinite(frequency(entry)))
      .slice(0, 6)
      .map((entry) => ({
        frequencyKHz: frequency(entry),
        name: entry.name || 'USAF HFGCS',
        badge: 'GLOBAL AIR',
        serviceArea: entry.shortName || 'Global military/utility alternate',
        night: isNight({ lon: 0 })
      }));
  }

  function browseAviation(receiver) {
    const networks = Array.isArray(contextCatalog?.aviationNetworks) ? contextCatalog.aviationNetworks : [];
    const rankedNetworks = networks
      .map((network) => aviationNetworkScore(network, receiver))
      .sort((a, b) => b.score - a.score || a.distance - b.distance);
    const mapped = rankedNetworks.filter((item) => item.inSector);
    const night = isNight(receiver);

    if (mapped.length) {
      const seen = new Set();
      const candidates = [];
      mapped.slice(0, 3).forEach((networkItem, networkIndex) => {
        networkItem.network.frequencies.forEach((frequencyKHz) => {
          const key = Number(frequencyKHz).toFixed(3);
          if (seen.has(key)) return;
          seen.add(key);
          candidates.push({
            frequencyKHz,
            name: networkItem.network.name,
            badge: networkItem.network.badge,
            serviceArea: networkItem.network.serviceArea,
            night,
            score: 1000 - networkIndex * 100 + hfTimeScore(frequencyKHz, night)
          });
        });
      });
      candidates.sort((a, b) => b.score - a.score || a.frequencyKHz - b.frequencyKHz);
      const visible = candidates.slice(0, 10);
      if (title) title.textContent = 'AVIATION ON THIS RECEIVER';
      count.textContent = `${visible.length} receiver-sector Aviation candidate${visible.length === 1 ? '' : 's'}`;
      stage.innerHTML = visible.map(aviationCard).join('');
      if (status) {
        status.className = 'lookup-status';
        status.textContent = `Aviation · ${receiverLabel(receiver)} · mapped HF sector + receiver local time · not live signal proof`;
      }
      return true;
    }

    // We know exactly where the SDR is, but do not yet have a mapped civil-HF
    // sector for every point on Earth. Be explicit and offer only genuinely
    // global known channels rather than pretending a distant sector is local.
    const fallback = globalAviationFallback();
    if (title) title.textContent = 'AVIATION ON THIS RECEIVER';
    count.textContent = fallback.length
      ? `${fallback.length} global Aviation alternate${fallback.length === 1 ? '' : 's'}`
      : 'Regional aviation data not mapped yet';
    stage.innerHTML = fallback.length
      ? fallback.map(aviationCard).join('')
      : `<div class="lookup-empty"><strong>Regional aviation coverage is still being expanded here.</strong><p>${esc(coverageNote('aviation') || 'The receiver location is known, but this area does not yet have a mapped civil HF family in the FREQBEACON catalog.')}</p></div>`;
    if (status) {
      status.className = 'lookup-status';
      status.textContent = `Aviation · receiver context confirmed for ${receiverLabel(receiver)} · no mapped regional civil-HF sector yet${fallback.length ? ' · showing global HFGCS alternates' : ''}`;
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
