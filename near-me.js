(() => {
  'use strict';

  const LOCATION_STORAGE_KEY = 'signalScout:location:v1';
  const LOCATION_STORAGE_VERSION = 1;
  const PAGE_SIZE = 24;

  const state = {
    location: null,
    band: 'ALL',
    offsetHours: 0,
    visible: PAGE_SIZE,
    dataReady: false
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  function normalizeLocation(value) {
    const lat = Number(value?.lat);
    const lon = Number(value?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return {
      lat,
      lon,
      label: String(value?.label || '').trim() || `${lat.toFixed(3)}, ${lon.toFixed(3)}`,
      accuracy: Number.isFinite(Number(value?.accuracy)) ? Number(value.accuracy) : null,
      updatedAt: Number.isFinite(Number(value?.updatedAt)) ? Number(value.updatedAt) : 0
    };
  }

  function loadStoredLocation() {
    try {
      const parsed = JSON.parse(window.localStorage?.getItem(LOCATION_STORAGE_KEY) || 'null');
      if (!parsed || parsed.version !== LOCATION_STORAGE_VERSION) return null;
      return normalizeLocation(parsed);
    } catch {
      return null;
    }
  }

  function saveLocation(location) {
    const normalized = normalizeLocation(location);
    if (!normalized) return;
    try {
      window.localStorage?.setItem(LOCATION_STORAGE_KEY, JSON.stringify({
        version: LOCATION_STORAGE_VERSION,
        ...normalized,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      }));
    } catch {}
  }

  function milesBetween(lat1, lon1, lat2, lon2) {
    const radiusMiles = 3958.8;
    const r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r;
    const dLon = (lon2 - lon1) * r;
    const a = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * radiusMiles * Math.asin(Math.sqrt(a));
  }

  function bearingBetween(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const a = lat1 * r;
    const b = lat2 * r;
    const dLon = (lon2 - lon1) * r;
    const y = Math.sin(dLon) * Math.cos(b);
    const x = Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(dLon);
    return (Math.atan2(y, x) / r + 360) % 360;
  }

  function angularDifference(a, b) {
    return Math.abs(((a - b + 540) % 360) - 180);
  }

  function approximateSolarHour(date, longitude) {
    return (date.getUTCHours() + date.getUTCMinutes() / 60 + longitude / 15 + 24) % 24;
  }

  function targetDate() {
    return new Date(Date.now() + state.offsetHours * 60 * 60 * 1000);
  }

  function hhmmToMinutes(value) {
    const text = String(value || '').padStart(4, '0');
    if (!/^\d{4}$/.test(text)) return null;
    if (text === '2400') return 1440;
    return Number(text.slice(0, 2)) * 60 + Number(text.slice(2));
  }

  function isOnAir(station, date) {
    const start = hhmmToMinutes(station?.start);
    const end = hhmmToMinutes(station?.end);
    if (start == null || end == null) return true;
    const now = date.getUTCHours() * 60 + date.getUTCMinutes();
    if (start === 0 && end === 1440) return true;
    if (end > start) return now >= start && now < end;
    return now >= start || now < end;
  }

  function receptionLabel(score) {
    if (score >= 80) return { text: 'EXCELLENT', cls: 'good' };
    if (score >= 62) return { text: 'GOOD', cls: 'good' };
    if (score >= 42) return { text: 'POSSIBLE', cls: '' };
    return { text: 'LONG SHOT', cls: 'long' };
  }

  function scoreShortwave(station, date) {
    const user = state.location;
    const lat = Number(station.lat);
    const lon = Number(station.lon);
    if (!user || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;

    const distance = milesBetween(user.lat, user.lon, lat, lon);
    const localSolarHour = approximateSolarHour(date, user.lon);
    const isNight = localSolarHour >= 19 || localSolarHour < 6;
    const mhz = Number(station.frequency) / 1000;
    const reasons = [];
    let score = 28;

    // Shortwave is not "closer is always stronger." Keep the estimate
    // conservative because local noise, skip zones and antenna efficiency matter.
    if (distance < 300) {
      score += 5;
      reasons.push('close enough for a possible skip-zone penalty');
    } else if (distance < 1200) {
      score += 15;
      reasons.push('useful regional skywave path');
    } else if (distance < 2500) {
      score += 9;
      reasons.push('workable multi-hop path');
    } else if (distance < 4500) {
      score += 3;
      reasons.push('long-haul path');
    } else if (distance < 6000) {
      score -= 8;
      reasons.push('difficult long-haul path');
    } else {
      score -= 15;
      reasons.push('extreme DX path');
    }

    const powerKw = Number(station.power);
    if (Number.isFinite(powerKw) && powerKw > 0) {
      if (powerKw >= 250) score += 7;
      else if (powerKw >= 100) score += 5;
      else if (powerKw >= 50) score += 3;
      else if (powerKw < 10) score -= 4;
    }

    const beam = Number(station.beam);
    if (Number.isFinite(beam) && beam !== 0) {
      const listenerBearing = bearingBetween(lat, lon, user.lat, user.lon);
      const difference = angularDifference(beam, listenerBearing);
      if (difference < 30) {
        score += 10;
        reasons.push('transmitter beam favors you');
      } else if (difference < 65) {
        score += 5;
        reasons.push('near the transmitter beam');
      } else if (difference > 120) {
        score -= 12;
        reasons.push('beam points away');
      }
    }

    if (isNight) {
      if (mhz < 8) {
        score += 8;
        reasons.push('lower HF favors darkness');
      } else if (mhz < 12) {
        score += 5;
        reasons.push('evening-friendly band');
      } else if (mhz > 16) {
        score -= 8;
        reasons.push('high HF is less dependable after dark');
      }
    } else {
      if (mhz > 11 && mhz < 19) {
        score += 7;
        reasons.push('daylight-friendly band');
      } else if (mhz < 5) {
        score -= 7;
        reasons.push('low HF is tougher in daylight');
      }
    }

    if (station.locationApproximate) {
      score -= 12;
      reasons.push('transmitter location is approximate');
    }

    return {
      score: Math.max(3, Math.min(90, Math.round(score))),
      distance,
      why: reasons.join(' · ')
    };
  }

  function scoreMediumWave(station, date) {
    const user = state.location;
    const lat = Number(station.lat);
    const lon = Number(station.lon);
    if (!user || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const distance = milesBetween(user.lat, user.lon, lat, lon);
    const localSolarHour = approximateSolarHour(date, user.lon);
    const isNight = localSolarHour >= 19 || localSolarHour < 6;
    const dayPowerW = Number(station.dayPowerW);
    const nightPowerW = Number(station.nightPowerW);
    const powerW = isNight ? nightPowerW : dayPowerW;
    const powerKw = Number.isFinite(powerW) ? powerW / 1000 : 0;
    const reasons = [];
    let score;

    // Near Me is intentionally conservative. Ground-wave/local reception gets
    // the strongest confidence. Nighttime skywave is treated as DX: possible,
    // sometimes excellent in practice, but never assumed merely from distance.
    if (!isNight) {
      if (distance < 35) score = 92;
      else if (distance < 60) score = 82;
      else if (distance < 90) score = 68;
      else if (distance < 120) score = 54;
      else if (distance < 180) score = 36;
      else score = 15;
      reasons.push('daytime ground-wave estimate');
    } else {
      if (distance < 40) score = 90;
      else if (distance < 75) score = 80;
      else if (distance < 120) score = 66;
      else if (distance < 180) score = 52;
      else if (distance < 300) score = 38;
      else if (distance < 500) score = 26;
      else if (distance < 800) score = 18;
      else score = 10;
      reasons.push(distance < 120 ? 'nearby nighttime reception' : 'nighttime skywave DX estimate');
    }

    if (powerKw >= 50) score += 8;
    else if (powerKw >= 10) score += 6;
    else if (powerKw >= 5) score += 4;
    else if (powerKw >= 1) score += 2;

    if (isNight && (!Number.isFinite(nightPowerW) || nightPowerW <= 0)) {
      score -= 40;
      reasons.push('no meaningful authorized night power');
    } else if (isNight && powerKw < .1) {
      score -= 25;
      reasons.push('very low night power');
    } else if (isNight && powerKw < .5) {
      score -= 10;
      reasons.push('low night power');
    }

    if (isNight && station.classA) {
      score += 5;
      reasons.push('clear-channel class helps DX potential');
    }

    return {
      score: Math.max(3, Math.min(95, Math.round(score))),
      distance,
      why: reasons.join(' · '),
      isNight,
      powerW
    };
  }

  function scoreLongwave(entry) {
    const user = state.location;
    const lat = Number(entry.lat);
    const lon = Number(entry.lon);
    if (!user || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const distance = milesBetween(user.lat, user.lon, lat, lon);
    let score;
    if (distance < 250) score = 64;
    else if (distance < 700) score = 56;
    else if (distance < 1400) score = 46;
    else if (distance < 3000) score = 30;
    else score = 16;
    return {
      score,
      distance,
      why: 'LF reception is strongly antenna- and noise-dependent'
    };
  }

  function antennaFor(candidate) {
    const score = candidate.score;
    const distance = Number(candidate.distance);

    if (candidate.band === 'MW') {
      if (distance <= 55 && score >= 75) {
        return { text: 'BUILT-IN AM ANTENNA LIKELY', cls: 'good', category: 'easy' };
      }
      if (distance <= 100 && score >= 58) {
        return { text: 'BUILT-IN AM ANTENNA WORTH TRYING', cls: '', category: 'easy' };
      }
      if (distance <= 250 && score >= 40) {
        return { text: 'EXTERNAL AM LOOP RECOMMENDED', cls: '', category: 'wire' };
      }
      return { text: 'DX TRY · EXTERNAL LOOP RECOMMENDED', cls: 'muted', category: 'wire' };
    }

    if (candidate.band === 'LW') {
      return { text: 'SPECIALIZED LF LOOP / LONG WIRE', cls: 'muted', category: 'wire' };
    }

    // A whip can absolutely catch strong shortwave, but Near Me should not
    // promise it. Reserve the easy label for a very strong, non-approximate path.
    if (!candidate.approximate && distance <= 1500 && score >= 78) {
      return { text: 'TELESCOPIC WORTH TRYING', cls: 'good', category: 'easy' };
    }
    if (score >= 45) {
      return { text: 'BETTER WITH WIRE', cls: '', category: 'wire' };
    }
    return { text: 'WIRE RECOMMENDED · DX CONDITIONS', cls: 'muted', category: 'wire' };
  }

  function unusableShortwaveName(name) {
    const text = String(name || '').trim();
    if (!text) return true;
    return /^(?:for\s+new\s+organization|new\s+organization|unknown|n\/?a|not\s+available|test|tentative)$/i.test(text);
  }

  function buildShortwave(date) {
    const stations = Array.isArray(window.SIGNAL_SCOUT_STATIONS) ? window.SIGNAL_SCOUT_STATIONS : [];
    const seen = new Set();
    const results = [];

    for (const station of stations) {
      if (station?.band !== 'SW' || !isOnAir(station, date)) continue;
      if (/\bDRM\b/i.test(String(station.format || ''))) continue;
      if (unusableShortwaveName(station.name)) continue;
      const frequencyKHz = Number(station.frequency);
      if (!Number.isFinite(frequencyKHz)) continue;
      const scored = scoreShortwave(station, date);
      if (!scored) continue;
      const key = `${frequencyKHz.toFixed(3)}|${String(station.name || '')}|${String(station.transmitter || '')}`;
      if (seen.has(key)) continue;
      seen.add(key);

      results.push({
        band: 'SW',
        frequencyKHz,
        mode: 'am',
        name: String(station.name || 'Shortwave broadcast'),
        place: String(station.transmitter || station.country || 'Transmitter not listed'),
        country: String(station.country || ''),
        language: String(station.language || ''),
        format: 'Shortwave',
        approximate: Boolean(station.locationApproximate),
        ...scored
      });
    }
    return results;
  }

  function buildMediumWave(date) {
    const stations = Array.isArray(window.FREQBEACON_ZERO_AM_CATALOG) ? window.FREQBEACON_ZERO_AM_CATALOG : [];
    const seen = new Set();
    const results = [];

    for (const station of stations) {
      const frequencyKHz = Number(station?.frequencyKHz);
      if (!Number.isFinite(frequencyKHz)) continue;
      const scored = scoreMediumWave(station, date);
      if (!scored) continue;
      const callsign = String(station.callsign || '').trim();
      const stationName = String(station.name || callsign || 'AM broadcast').trim();
      const key = `${frequencyKHz.toFixed(1)}|${callsign.toUpperCase()}|${String(station.location || '')}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const displayName = callsign && !stationName.toUpperCase().includes(callsign.toUpperCase())
        ? `${callsign} — ${stationName}`
        : stationName;

      results.push({
        band: 'MW',
        frequencyKHz,
        mode: 'am',
        name: displayName,
        place: String(station.location || 'Location not listed'),
        country: 'United States',
        language: '',
        format: 'AM Broadcast',
        approximate: false,
        ...scored
      });
    }
    return results;
  }

  function buildLongwave() {
    const entries = window.FREQBEACON_IDENTIFICATION_CATALOG?.entries;
    if (!Array.isArray(entries)) return [];
    const seen = new Set();
    const results = [];
    for (const entry of entries) {
      const cats = Array.isArray(entry.categories) ? entry.categories : [];
      if (entry?.band !== 'LW' && !cats.includes('longwave')) continue;
      const frequencyKHz = Number(entry.frequencyKHz);
      if (!Number.isFinite(frequencyKHz)) continue;
      const scored = scoreLongwave(entry);
      if (!scored) continue;
      const key = `${frequencyKHz.toFixed(3)}|${String(entry.name || '')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        band: 'LW',
        frequencyKHz,
        mode: 'am',
        name: String(entry.name || 'Longwave signal'),
        place: String(entry.location || entry.transmitter || entry.country || 'Location not listed'),
        country: String(entry.country || ''),
        language: String(entry.language || ''),
        format: 'Longwave',
        approximate: false,
        ...scored
      });
    }
    return results;
  }

  function candidatesFor(date) {
    const sw = buildShortwave(date);
    const mw = buildMediumWave(date);
    const lw = buildLongwave();

    let candidates;
    if (state.band === 'SW') candidates = sw;
    else if (state.band === 'MW') candidates = mw;
    else if (state.band === 'LW') candidates = lw;
    else candidates = [...mw, ...sw];

    candidates.sort((a, b) =>
      b.score - a.score
      || a.distance - b.distance
      || a.frequencyKHz - b.frequencyKHz
    );

    const practical = candidates.filter((candidate) => candidate.score >= 35);
    return practical.length >= 8 ? practical : candidates.slice(0, Math.max(8, practical.length));
  }

  function formatFrequency(candidate) {
    if (candidate.band === 'SW') {
      const mhz = candidate.frequencyKHz / 1000;
      return { value: mhz.toFixed(candidate.frequencyKHz % 10 ? 3 : 2), unit: 'MHz' };
    }
    const decimals = Number.isInteger(candidate.frequencyKHz) ? 0 : 1;
    return {
      value: candidate.frequencyKHz.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }),
      unit: 'kHz'
    };
  }

  function bandLabel(candidate) {
    if (candidate.band === 'MW') return 'AM BROADCAST';
    if (candidate.band === 'LW') return 'LONGWAVE';
    return 'SHORTWAVE';
  }

  function distanceLabel(candidate) {
    const rounded = Math.round(candidate.distance).toLocaleString();
    return `${candidate.approximate ? '≈' : ''}${rounded} mi`;
  }

  function targetTimeLabel() {
    if (state.offsetHours === 0) return 'NOW';
    try {
      const text = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(targetDate());
      return `${text} LOCAL`;
    } catch {
      return `+${state.offsetHours} HR`;
    }
  }

  function renderCard(candidate, index) {
    const frequency = formatFrequency(candidate);
    const reception = receptionLabel(candidate.score);
    const antenna = antennaFor(candidate);
    const radioHref = `/zero?from=lookup&frequency=${encodeURIComponent(candidate.frequencyKHz)}&mode=${encodeURIComponent(candidate.mode || 'am')}`;
    const isBest = index === 0;

    return `
      <article class="near-card ${isBest ? 'is-best' : ''}">
        <div class="near-card-body">
          ${isBest ? '<span class="near-best-badge">BEST BET</span>' : ''}
          <div class="near-card-top">
            <div>
              <div class="near-frequency-line">
                <span class="near-frequency">${escapeHtml(frequency.value)}</span>
                <span class="near-unit">${escapeHtml(frequency.unit)}</span>
              </div>
            </div>
            <span class="near-reception-pill ${reception.cls}"><i aria-hidden="true"></i>${reception.text}</span>
          </div>
          <h3 class="near-station">${escapeHtml(candidate.name)}</h3>
          <div class="near-card-meta">
            <span>${escapeHtml(bandLabel(candidate))}</span>
            <span>${escapeHtml(candidate.place)}</span>
            <span>${escapeHtml(distanceLabel(candidate))}</span>
          </div>
          <div class="near-card-divider"></div>
          <div class="near-antenna ${antenna.cls}">
            <span>ANTENNA</span>
            <strong><i aria-hidden="true"></i>${escapeHtml(antenna.text)}</strong>
          </div>
          <div class="near-card-foot">
            <span><b>${state.offsetHours === 0 ? 'ON AIR NOW' : 'ACTIVE AT SELECTED TIME'}</b></span>
            <span>Reception ${candidate.score}/100</span>
          </div>
        </div>
        <div class="near-card-actions">
          <a class="near-radio-button" href="${radioHref}">RADIO</a>
        </div>
      </article>`;
  }

  function renderLocation() {
    const location = state.location;
    const button = $('#nearLocationButton');
    if (!location) {
      $('#nearLocationName').textContent = 'Location not set';
      $('#nearLocationMeta').textContent = 'Use your location to rank signals for where you are right now.';
      button.textContent = 'USE LOCATION';
      return;
    }

    $('#nearLocationName').textContent = location.label;
    const accuracy = location.accuracy == null ? '' : ` · ±${Math.round(location.accuracy)} m`;
    $('#nearLocationMeta').textContent = `${location.lat.toFixed(3)}, ${location.lon.toFixed(3)}${accuracy}`;
    button.textContent = 'UPDATE';
  }

  function render() {
    renderLocation();
    $('#nearTargetTime').textContent = targetTimeLabel();

    if (!state.location) {
      $('#nearGoodCount').textContent = '—';
      $('#nearEasyCount').textContent = '—';
      $('#nearWireCount').textContent = '—';
      $('#nearResultCount').textContent = '';
      $('#nearResults').innerHTML = `
        <div class="near-empty">
          <strong>Set your location to build your listening list.</strong>
          <p>FREQBEACON will rank active broadcasts and local AM stations, then tell you what kind of antenna is a sensible starting point.</p>
        </div>`;
      $('#nearShowMore').hidden = true;
      return;
    }

    const candidates = candidatesFor(targetDate());
    const summaryPool = candidates.slice(0, 30);
    const good = summaryPool.filter((candidate) => candidate.score >= 62).length;
    const easy = summaryPool.filter((candidate) => antennaFor(candidate).category === 'easy').length;
    const wire = summaryPool.filter((candidate) => antennaFor(candidate).category === 'wire').length;

    $('#nearGoodCount').textContent = String(good);
    $('#nearEasyCount').textContent = String(easy);
    $('#nearWireCount').textContent = String(wire);
    $('#nearResultCount').textContent = `${candidates.length.toLocaleString()} ranked`;

    const visible = candidates.slice(0, state.visible);
    $('#nearResults').innerHTML = visible.length
      ? visible.map((candidate, index) => renderCard(candidate, index)).join('')
      : `<div class="near-empty"><strong>No practical matches at this time.</strong><p>Try another time window or band. Radio propagation changes throughout the day.</p></div>`;

    const more = $('#nearShowMore');
    more.hidden = state.visible >= candidates.length;
    if (!more.hidden) more.textContent = `SHOW MORE · ${Math.min(PAGE_SIZE, candidates.length - state.visible)}`;
  }

  async function reverseGeocode(lat, lon) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4500);
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=10`;
      const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) throw new Error('reverse geocode failed');
      const json = await response.json();
      const address = json.address || {};
      return [address.city || address.town || address.village || address.county, address.state, address.country]
        .filter(Boolean)
        .join(', ');
    } catch {
      return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function requestLocation() {
    const button = $('#nearLocationButton');
    if (!navigator.geolocation) {
      $('#nearLocationMeta').textContent = 'Location is not available in this browser.';
      return;
    }
    button.disabled = true;
    button.textContent = 'LOCATING…';

    navigator.geolocation.getCurrentPosition(async (position) => {
      const lat = Number(position.coords.latitude);
      const lon = Number(position.coords.longitude);
      const label = await reverseGeocode(lat, lon);
      state.location = normalizeLocation({
        lat,
        lon,
        label,
        accuracy: position.coords.accuracy,
        updatedAt: Date.now()
      });
      saveLocation(state.location);
      state.visible = PAGE_SIZE;
      button.disabled = false;
      render();
    }, (error) => {
      button.disabled = false;
      button.textContent = state.location ? 'UPDATE' : 'USE LOCATION';
      $('#nearLocationMeta').textContent = error?.code === 1
        ? 'Location permission is blocked. Allow location access, then try again.'
        : 'FREQBEACON could not update your location. Try again.';
    }, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 120000
    });
  }

  async function refreshGrantedLocation() {
    if (!navigator.permissions?.query || !navigator.geolocation) return;
    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      if (permission?.state !== 'granted') return;
      const stored = state.location;
      if (stored?.updatedAt && Date.now() - stored.updatedAt < 15 * 60 * 1000) return;
      requestLocation();
    } catch {}
  }

  $('#nearLocationButton')?.addEventListener('click', requestLocation);

  $$('.near-time').forEach((button) => {
    button.addEventListener('click', () => {
      $$('.near-time').forEach((item) => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      state.offsetHours = Number(button.dataset.offset || 0);
      state.visible = PAGE_SIZE;
      render();
    });
  });

  $$('.near-band').forEach((button) => {
    button.addEventListener('click', () => {
      $$('.near-band').forEach((item) => {
        const active = item === button;
        item.classList.toggle('active', active);
        item.setAttribute('aria-pressed', String(active));
      });
      state.band = button.dataset.band || 'ALL';
      state.visible = PAGE_SIZE;
      render();
    });
  });

  $('#nearShowMore')?.addEventListener('click', () => {
    state.visible += PAGE_SIZE;
    render();
  });

  state.location = loadStoredLocation();
  render();

  const dataPromise = window.SIGNAL_SCOUT_DATA_READY;
  if (dataPromise && typeof dataPromise.then === 'function') {
    Promise.resolve(dataPromise)
      .then(() => {
        state.dataReady = true;
        const dataState = window.SIGNAL_SCOUT_DATA_STATE;
        $('#nearDataStatus').textContent = dataState?.loaded
          ? `Full shortwave schedule loaded · ${Number(dataState.count || 0).toLocaleString()} active schedule entries available for ranking`
          : 'Using built-in shortwave data and the current AM catalog.';
        $('#nearDataStatus').classList.add('is-ready');
        render();
      })
      .catch(() => {
        $('#nearDataStatus').textContent = 'Using built-in shortwave data and the current AM catalog.';
        $('#nearDataStatus').classList.add('is-ready');
        render();
      });
  } else {
    $('#nearDataStatus').textContent = 'Using built-in shortwave data and the current AM catalog.';
    $('#nearDataStatus').classList.add('is-ready');
  }

  refreshGrantedLocation();
})();