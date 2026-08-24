(() => {
  const stations = window.SIGNAL_SCOUT_STATIONS || [];
  const state = {
    band: 'SW',
    offsetHours: 0,
    bestOnly: false,
    user: {
      lat: null,
      lon: null,
      label: 'Location not set',
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    }
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const pad = (value) => String(value).padStart(2, '0');

  function updateClock() {
    const now = new Date();
    $('#utcClock').textContent = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())} UTC`;
  }

  function targetDate() {
    return new Date(Date.now() + state.offsetHours * 60 * 60 * 1000);
  }

  function hhmmToMinutes(value) {
    if (value === '2400') return 1440;
    return Number(value.slice(0, 2)) * 60 + Number(value.slice(2));
  }

  function isOnAir(station, date) {
    if (station.band !== 'SW') return true;
    const nowMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
    const start = hhmmToMinutes(station.start);
    const end = hhmmToMinutes(station.end);

    if (start === 0 && end === 1440) return true;
    if (end > start) return nowMinutes >= start && nowMinutes < end;
    return nowMinutes >= start || nowMinutes < end;
  }

  function milesBetween(lat1, lon1, lat2, lon2) {
    const radiusMiles = 3958.8;
    const r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r;
    const dLon = (lon2 - lon1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
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

  function scoreShortwave(station, date) {
    if (state.user.lat == null) {
      return { score: 50, distance: null, why: 'Set your location for a real reception estimate.' };
    }

    const distance = milesBetween(state.user.lat, state.user.lon, station.lat, station.lon);
    const localSolarHour = approximateSolarHour(date, state.user.lon);
    const isNight = localSolarHour >= 19 || localSolarHour < 6;
    const mhz = station.frequency / 1000;
    const reasons = [];
    let score = 42;

    if (distance < 400) {
      score += 20;
      reasons.push('nearby transmitter');
    } else if (distance < 1200) {
      score += 24;
      reasons.push('good regional skywave distance');
    } else if (distance < 3000) {
      score += 15;
      reasons.push('workable skywave distance');
    } else if (distance < 6000) {
      score += 7;
      reasons.push('long-haul path');
    } else {
      score -= 5;
      reasons.push('very long path');
    }

    score += Math.min(16, Math.log10(Math.max(1, station.power || 1)) * 8);

    if (station.beam) {
      const listenerBearing = bearingBetween(station.lat, station.lon, state.user.lat, state.user.lon);
      const beamDifference = angularDifference(station.beam, listenerBearing);
      if (beamDifference < 30) {
        score += 18;
        reasons.push('antenna beam points near you');
      } else if (beamDifference < 65) {
        score += 9;
        reasons.push('near the antenna beam');
      } else if (beamDifference > 120) {
        score -= 12;
        reasons.push('antenna beam points away');
      }
    } else {
      reasons.push('beam is broad or unknown');
    }

    if (isNight) {
      if (mhz < 8) {
        score += 14;
        reasons.push('lower band favors darkness');
      } else if (mhz < 12) {
        score += 8;
        reasons.push('evening-friendly band');
      } else if (mhz > 16) {
        score -= 10;
        reasons.push('high band may fade after dark');
      }
    } else {
      if (mhz > 11 && mhz < 19) {
        score += 10;
        reasons.push('daylight-friendly band');
      } else if (mhz < 5) {
        score -= 9;
        reasons.push('low band is tougher in daylight');
      }
    }

    return {
      score: Math.max(4, Math.min(96, Math.round(score))),
      distance,
      why: reasons.join(' · ')
    };
  }

  function scoreMediumWave(station, date) {
    if (state.user.lat == null) {
      return { score: 50, distance: null, why: 'Set your location for a distance-based AM estimate.' };
    }

    const distance = milesBetween(state.user.lat, state.user.lon, station.lat, station.lon);
    const localSolarHour = approximateSolarHour(date, state.user.lon);
    const isNight = localSolarHour >= 19 || localSolarHour < 6;
    const power = isNight ? station.nightPower : station.dayPower;
    const reasons = [];
    let score;

    if (!isNight) {
      if (distance < 40) score = 92;
      else if (distance < 90) score = 78;
      else if (distance < 160) score = 55;
      else if (distance < 250) score = 32;
      else score = 12;
      reasons.push('daytime ground-wave estimate');
    } else {
      if (distance < 75) score = 90;
      else if (distance < 350) score = 82;
      else if (distance < 800) score = 68;
      else if (distance < 1300) score = 47;
      else score = 20;
      reasons.push('nighttime skywave estimate');
    }

    score += Math.min(12, Math.log10(Math.max(0.01, power || 0.01)) * 6);
    if (isNight && power < 0.1) {
      score -= 20;
      reasons.push('very low night power');
    }

    return {
      score: Math.max(3, Math.min(97, Math.round(score))),
      distance,
      power,
      isNight,
      why: reasons.join(' · ')
    };
  }

  function receptionLabel(score) {
    if (score >= 80) return ['Excellent', 'score-good'];
    if (score >= 62) return ['Good', 'score-good'];
    if (score >= 42) return ['Possible', 'score-maybe'];
    return ['Long shot', 'score-long'];
  }

  function languageMatches(station, selected) {
    if (selected === 'all') return true;
    const language = station.language || '';
    if (selected === 'English') return language.includes('English');
    if (selected === 'Spanish') return language.includes('Spanish');
    return !language.includes('English') && !language.includes('Spanish');
  }

  function utcScheduleText(station) {
    const start = `${station.start.slice(0, 2)}:${station.start.slice(2)}`;
    const end = station.end === '2400' ? '24:00' : `${station.end.slice(0, 2)}:${station.end.slice(2)}`;
    return `${start}–${end} UTC`;
  }

  function shortwaveSchedule(station, selectedDate) {
    const startMinutes = hhmmToMinutes(station.start);
    const endMinutes = hhmmToMinutes(station.end);
    const selectedMinutes = selectedDate.getUTCHours() * 60 + selectedDate.getUTCMinutes();

    let startDayOffset = 0;
    let endDayOffset = 0;

    if (startMinutes === 0 && endMinutes === 1440) {
      endDayOffset = 1;
    } else if (endMinutes <= startMinutes) {
      if (selectedMinutes < endMinutes) {
        startDayOffset = -1;
      } else {
        endDayOffset = 1;
      }
    }

    const baseUtc = Date.UTC(
      selectedDate.getUTCFullYear(),
      selectedDate.getUTCMonth(),
      selectedDate.getUTCDate(),
      0, 0, 0, 0
    );

    const startDate = new Date(baseUtc + (startDayOffset * 1440 + startMinutes) * 60000);
    const endDate = new Date(baseUtc + (endDayOffset * 1440 + endMinutes) * 60000);
    const timeZone = state.user.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    try {
      const timeFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      const zoneFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'short'
      });
      const zone = zoneFormatter.formatToParts(selectedDate).find((part) => part.type === 'timeZoneName')?.value || '';

      return {
        local: `${timeFormatter.format(startDate)}–${timeFormatter.format(endDate)}${zone ? ` ${zone}` : ''}`,
        utc: utcScheduleText(station)
      };
    } catch {
      return {
        local: utcScheduleText(station),
        utc: ''
      };
    }
  }

  function formatFrequency(station) {
    if (station.band === 'SW') {
      return { value: (station.frequency / 1000).toFixed(station.frequency % 10 ? 3 : 2), unit: 'MHz' };
    }
    return { value: station.frequency.toLocaleString(), unit: 'kHz' };
  }

  function renderCard(station, scored, selectedDate) {
    const [label, labelClass] = receptionLabel(scored.score);
    const frequency = formatFrequency(station);
    const distance = scored.distance == null ? 'Location needed' : `${Math.round(scored.distance).toLocaleString()} mi`;
    const schedule = station.band === 'SW'
      ? shortwaveSchedule(station, selectedDate)
      : { local: 'Local station; power varies day/night', utc: '' };
    const power = station.band === 'SW'
      ? `${station.power} kW`
      : `${scored.isNight ? station.nightPower : station.dayPower} kW ${scored.isNight ? 'night' : 'day'}`;

    return `
      <article class="signal-card">
        <div class="card-top">
          <div>
            <div class="frequency">${frequency.value}<span>${frequency.unit}</span></div>
            <div class="station-name">${station.name}</div>
            <div class="station-description">${station.note || ''}</div>
          </div>
          <div class="score">
            <strong class="${labelClass}">${label}</strong>
            <small>${scored.score}/100</small>
            <div class="score-meter"><i style="width:${scored.score}%"></i></div>
          </div>
        </div>
        <div class="tags">
          <span class="tag">${station.country}</span>
          <span class="tag">${station.language}</span>
          <span class="tag">${station.format}</span>
        </div>
        <div class="details">
          <div class="detail">Transmitter<b>${station.transmitter}</b></div>
          <div class="detail">Distance<b>${distance}</b></div>
          <div class="detail">Schedule<b>${schedule.local}${schedule.utc ? `<span style="display:block;margin-top:2px;color:#8fa4bc;font-size:11px;font-weight:600">${schedule.utc}</span>` : ''}</b></div>
          <div class="detail">Power<b>${power}</b></div>
        </div>
        <div class="why"><b>Why this rating:</b> ${scored.why}</div>
      </article>`;
  }

  function render() {
    const date = targetDate();
    const query = $('#searchInput').value.trim().toLowerCase();
    const language = $('#languageFilter').value;

    if (state.band === 'LW') {
      $('#signalGrid').innerHTML = '<div class="empty-state">Longwave is the next band to wire in. For North America, the useful version should include beacons and utility signals as well as broadcast LW.</div>';
      $('#resultCount').textContent = '';
      return;
    }

    let results = stations
      .filter((station) => station.band === state.band)
      .filter((station) => isOnAir(station, date))
      .filter((station) => languageMatches(station, language))
      .map((station) => ({ station, scored: station.band === 'MW' ? scoreMediumWave(station, date) : scoreShortwave(station, date) }));

    if (query) {
      results = results.filter(({ station }) => [
        station.name,
        station.country,
        station.transmitter,
        station.frequency,
        station.language,
        station.format
      ].join(' ').toLowerCase().includes(query));
    }

    if (state.bestOnly) results = results.filter(({ scored }) => scored.score >= 55);

    results.sort((a, b) => b.scored.score - a.scored.score || a.station.frequency - b.station.frequency);

    $('#resultsTitle').textContent = state.bestOnly ? 'Best reception bets' : 'Best bets on the air';
    $('#resultCount').textContent = `${results.length} signal${results.length === 1 ? '' : 's'}`;

    $('#signalGrid').innerHTML = results.length
      ? results.map(({ station, scored }) => renderCard(station, scored, date)).join('')
      : '<div class="empty-state">Nothing in the starter dataset matches those filters at this time. Try another hour, language, or band.</div>';
  }

  async function reverseGeocode(lat, lon) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=10`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Reverse geocoding failed');
      const json = await response.json();
      const address = json.address || {};
      return [address.city || address.town || address.village || address.county, address.state, address.country]
        .filter(Boolean)
        .join(', ');
    } catch {
      return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
    }
  }

  async function resolveTimeZone(lat, lon) {
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&current=temperature_2m&timezone=auto`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Timezone lookup failed');
      const json = await response.json();
      if (json.timezone) return json.timezone;
    } catch {
      // Fall through to the device timezone if the coordinate lookup is unavailable.
    }
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }

  function requestLocation() {
    const button = $('#locationButton');
    if (!navigator.geolocation) {
      $('#locationMeta').textContent = 'Geolocation is not available in this browser.';
      return;
    }

    button.textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition(async (position) => {
      state.user.lat = position.coords.latitude;
      state.user.lon = position.coords.longitude;
      const [label, timeZone] = await Promise.all([
        reverseGeocode(state.user.lat, state.user.lon),
        resolveTimeZone(state.user.lat, state.user.lon)
      ]);
      state.user.label = label;
      state.user.timeZone = timeZone;
      $('#locationName').textContent = state.user.label;
      $('#locationMeta').textContent = `${state.user.lat.toFixed(3)}, ${state.user.lon.toFixed(3)} · accuracy ±${Math.round(position.coords.accuracy)} m · ${state.user.timeZone}`;
      button.textContent = '✓ Located';
      render();
    }, () => {
      $('#locationMeta').textContent = 'Location permission was not granted. You can still browse schedules, but reception ratings stay generic.';
      button.textContent = '◎ Try again';
      render();
    }, {
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 300000
    });
  }

  $('#locationButton').addEventListener('click', requestLocation);
  $('#searchInput').addEventListener('input', render);
  $('#languageFilter').addEventListener('change', render);

  $$('.time-picker .chip').forEach((button) => {
    button.addEventListener('click', () => {
      $$('.time-picker .chip').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      state.offsetHours = Number(button.dataset.offset);
      render();
    });
  });

  $$('.band-tabs .tab').forEach((button) => {
    button.addEventListener('click', () => {
      $$('.band-tabs .tab').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      state.band = button.dataset.band;
      render();
    });
  });

  $('#bestBetsButton').addEventListener('click', () => {
    state.bestOnly = !state.bestOnly;
    $('#bestBetsButton').classList.toggle('active', state.bestOnly);
    render();
  });

  $('#aboutButton').addEventListener('click', () => {
    window.alert('Signal Scout MVP\n\nGoal: answer “What can I hear here, right now?” instead of dumping a schedule table on you.\n\nThis first scoring model uses distance, transmitter power, beam direction, frequency, and simple day/night behavior. Full HFCC/EiBi/FCC ingestion and live propagation data come next.');
  });

  updateClock();
  window.setInterval(updateClock, 30000);
  render();
})();
