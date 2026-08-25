(() => {
  const LOCATION_STORAGE_KEY = 'signalScout:location:v1';
  const KIWISDR_DIRECTORY = 'https://kiwisdr.com/.public/';
  const RECEIVERS = [
    {
      name: 'Florida KiwiSDR',
      location: 'Palm Harbor, Florida',
      baseUrl: 'http://22315.proxy.kiwisdr.com'
    },
    {
      name: 'North Carolina KiwiSDR',
      location: 'Apex, North Carolina',
      baseUrl: 'http://22904.proxy.kiwisdr.com'
    },
    {
      name: 'Pennsylvania KiwiSDR',
      location: 'Ridley Park, Pennsylvania',
      baseUrl: 'http://22479.proxy.kiwisdr.com'
    }
  ];

  const lookupView = document.getElementById('lookupView');
  const lookupButton = document.getElementById('lookupButton');
  const onAirButton = document.getElementById('onAirButton');
  const bestBetsButton = document.getElementById('bestBetsButton');
  const frequencyInput = document.getElementById('lookupFrequency');
  const modeSelect = document.getElementById('lookupMode');
  const lookupSubmit = document.getElementById('lookupSubmit');
  const lookupResults = document.getElementById('lookupResults');
  const lookupSummary = document.getElementById('lookupSummary');
  const lookupTimeLabel = document.getElementById('lookupTimeLabel');
  const receiverSelect = document.getElementById('lookupReceiver');
  const locationButton = document.getElementById('locationButton');
  const signalGrid = document.getElementById('signalGrid');
  const discoverElements = [
    document.querySelector('.time-picker'),
    document.querySelector('.toolbar'),
    document.querySelector('.notice'),
    document.querySelector('.results-header'),
    signalGrid,
    document.querySelector('.source-note')
  ].filter(Boolean);

  if (!lookupView || !lookupButton || !frequencyInput || !lookupSubmit || !lookupResults) return;

  let lookupOffsetHours = 0;
  let lastFrequency = null;
  let discoveryBestOnly = bestBetsButton?.classList.contains('active') || false;

  const isAndroid = /Android/i.test(navigator.userAgent || '');

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function showLookup() {
    discoverElements.forEach((element) => { element.hidden = true; });
    lookupView.hidden = false;
    document.querySelectorAll('.bottom-nav .nav-button').forEach((button) => button.classList.remove('active'));
    lookupButton.classList.add('active');
    window.setTimeout(() => frequencyInput.focus({ preventScroll: true }), 0);
    updateTimeLabel();
    if (lastFrequency != null) runLookup();
  }

  function showDiscover(activeButton = onAirButton) {
    discoverElements.forEach((element) => { element.hidden = false; });
    lookupView.hidden = true;
    document.querySelectorAll('.bottom-nav .nav-button').forEach((button) => button.classList.remove('active'));
    activeButton?.classList.add('active');
  }

  function targetDate() {
    return new Date(Date.now() + lookupOffsetHours * 60 * 60 * 1000);
  }

  function hhmmToMinutes(value) {
    const clean = String(value || '').padStart(4, '0');
    if (clean === '2400') return 1440;
    const hours = Number(clean.slice(0, 2));
    const minutes = Number(clean.slice(2, 4));
    return hours * 60 + minutes;
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

  function parseFrequency(raw) {
    const normalized = String(raw || '').trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '');
    if (!normalized) return null;
    const mhzExplicit = normalized.endsWith('mhz') || normalized.endsWith('m');
    const khzExplicit = normalized.endsWith('khz') || normalized.endsWith('k');
    const numeric = Number(normalized.replace(/mhz|khz|m|k/g, ''));
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    if (mhzExplicit) return numeric * 1000;
    if (khzExplicit) return numeric;
    return numeric < 100 ? numeric * 1000 : numeric;
  }

  function formatLookupFrequency(khz) {
    const decimals = Number.isInteger(khz) ? 0 : 1;
    return `${khz.toLocaleString(undefined, { maximumFractionDigits: decimals })} kHz`;
  }

  function scheduleText(station) {
    if (station.band !== 'SW') return 'Local/medium-wave service';
    const start = `${String(station.start).padStart(4, '0').slice(0, 2)}:${String(station.start).padStart(4, '0').slice(2)}`;
    const endRaw = String(station.end).padStart(4, '0');
    const end = endRaw === '2400' ? '24:00' : `${endRaw.slice(0, 2)}:${endRaw.slice(2)}`;
    return `${start}–${end} UTC`;
  }

  function loadStoredLocation() {
    try {
      const payload = JSON.parse(window.localStorage?.getItem(LOCATION_STORAGE_KEY) || 'null');
      const lat = Number(payload?.lat);
      const lon = Number(payload?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon };
    } catch {
      return null;
    }
  }

  function milesBetween(lat1, lon1, lat2, lon2) {
    const radiusMiles = 3958.8;
    const r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r;
    const dLon = (lon2 - lon1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * radiusMiles * Math.asin(Math.sqrt(a));
  }

  function candidateRank(station, delta, user) {
    let score = delta === 0 ? 100 : Math.max(20, 72 - delta * 10);
    const power = Number(station.power || station.dayPower || 0);
    if (power > 0) score += Math.min(12, Math.log10(Math.max(1, power)) * 5);
    if (user && Number.isFinite(station.lat) && Number.isFinite(station.lon) && (station.lat !== 0 || station.lon !== 0)) {
      const distance = milesBetween(user.lat, user.lon, station.lat, station.lon);
      if (distance < 1500) score += 10;
      else if (distance < 3500) score += 6;
      else if (distance > 7000) score -= 5;
    }
    return score;
  }

  function currentReceiver() {
    return RECEIVERS[Number(receiverSelect?.value || 0)] || RECEIVERS[0];
  }

  function rawReceiverUrl(frequencyKHz, mode = 'am', receiver = currentReceiver()) {
    const normalizedMode = String(mode || 'am').toLowerCase();
    return `${receiver.baseUrl}/?f=${frequencyKHz.toFixed(1)}${normalizedMode}z8`;
  }

  function androidIntentUrl(rawUrl) {
    const withoutScheme = rawUrl.replace(/^http:\/\//i, '');
    const fallback = encodeURIComponent(KIWISDR_DIRECTORY);
    return `intent://${withoutScheme}#Intent;scheme=http;package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
  }

  function liveReceiverUrl(frequencyKHz, mode = 'am', receiver = currentReceiver()) {
    const rawUrl = rawReceiverUrl(frequencyKHz, mode, receiver);
    return isAndroid ? androidIntentUrl(rawUrl) : rawUrl;
  }

  function liveAnchorAttributes(url) {
    return isAndroid
      ? `href="${escapeHtml(url)}"`
      : `href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"`;
  }

  function renderCandidate(candidate, index, requestedFrequency, mode) {
    const { station, delta } = candidate;
    const exact = delta < 0.01;
    const stationFrequency = Number(station.frequency);
    const liveUrl = liveReceiverUrl(stationFrequency, mode);
    const target = station.target ? `<span class="lookup-tag">Target ${escapeHtml(station.target)}</span>` : '';
    const approximate = station.locationApproximate ? '≈' : '';
    const user = loadStoredLocation();
    const distance = user && Number.isFinite(station.lat) && Number.isFinite(station.lon) && (station.lat !== 0 || station.lon !== 0)
      ? `${approximate}${Math.round(milesBetween(user.lat, user.lon, station.lat, station.lon)).toLocaleString()} mi from you`
      : '';
    const receiver = currentReceiver();

    return `
      <article class="lookup-result ${index === 0 ? 'lookup-result-primary' : ''}">
        <div class="lookup-result-head">
          <div>
            <div class="lookup-match-label">${index === 0 ? 'Most likely' : 'Also scheduled'}${exact ? ' · exact frequency' : ` · ${delta.toFixed(1)} kHz away`}</div>
            <div class="lookup-result-frequency">${escapeHtml(formatLookupFrequency(stationFrequency))}</div>
            <h3>${escapeHtml(station.name || 'Unknown station')}</h3>
            <p>${escapeHtml(station.transmitter || station.country || 'Transmitter not listed')}${distance ? ` · ${escapeHtml(distance)}` : ''}</p>
          </div>
          <div class="lookup-match-score">${exact ? 'EXACT' : 'NEAR'}</div>
        </div>
        <div class="lookup-tags">
          <span class="lookup-tag">${escapeHtml(station.country || 'Unknown country')}</span>
          <span class="lookup-tag">${escapeHtml(station.language || 'Unknown language')}</span>
          <span class="lookup-tag">${escapeHtml(scheduleText(station))}</span>
          ${target}
        </div>
        <div class="lookup-actions">
          <a class="listen-live-button" ${liveAnchorAttributes(liveUrl)}>
            <span class="live-dot" aria-hidden="true"></span>
            Listen live
          </a>
          <span class="lookup-live-note">Live RF · ${escapeHtml(receiver.location)} · tuned to ${escapeHtml(formatLookupFrequency(stationFrequency))}${isAndroid ? ' · opens in Chrome' : ''}</span>
          <a class="lookup-directory-link" href="${KIWISDR_DIRECTORY}" target="_blank" rel="noopener noreferrer">Receiver directory</a>
        </div>
      </article>`;
  }

  function updateTimeLabel() {
    if (!lookupTimeLabel) return;
    const date = targetDate();
    const local = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    }).format(date);
    const utc = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')} UTC`;
    lookupTimeLabel.textContent = `${local} · ${utc}`;
  }

  function runLookup() {
    const requestedFrequency = parseFrequency(frequencyInput.value);
    updateTimeLabel();

    if (requestedFrequency == null || requestedFrequency < 100 || requestedFrequency > 30000) {
      lookupSummary.textContent = 'Enter a frequency between 100 and 30,000 kHz. You can also type MHz, such as 9.955.';
      lookupResults.innerHTML = '<div class="lookup-empty">Give me the number on your radio dial and Signal Scout will work backward from there.</div>';
      return;
    }

    lastFrequency = requestedFrequency;
    const date = targetDate();
    const stations = window.SIGNAL_SCOUT_STATIONS || [];
    const user = loadStoredLocation();
    const candidates = stations
      .filter((station) => isOnAir(station, date))
      .map((station) => ({
        station,
        delta: Math.abs(Number(station.frequency) - requestedFrequency)
      }))
      .filter(({ delta }) => Number.isFinite(delta) && delta <= 5.1)
      .map((candidate) => ({
        ...candidate,
        rank: candidateRank(candidate.station, candidate.delta, user)
      }))
      .sort((a, b) => a.delta - b.delta || b.rank - a.rank)
      .slice(0, 12);

    const exactCount = candidates.filter(({ delta }) => delta < 0.01).length;
    if (candidates.length === 0) {
      lookupSummary.textContent = `No scheduled broadcasts found within ±5 kHz of ${formatLookupFrequency(requestedFrequency)} at this time.`;
      lookupResults.innerHTML = `
        <div class="lookup-empty">
          <strong>Nothing scheduled here right now.</strong>
          Your radio may be slightly off-frequency, the station may be unscheduled, or this may be utility/amateur traffic that is not in the broadcast schedule yet.
        </div>`;
      return;
    }

    lookupSummary.textContent = exactCount
      ? `${exactCount} exact scheduled match${exactCount === 1 ? '' : 'es'} on ${formatLookupFrequency(requestedFrequency)} right now.`
      : `No exact match on ${formatLookupFrequency(requestedFrequency)}. Showing the closest scheduled broadcasts within ±5 kHz.`;

    const mode = modeSelect?.value || 'am';
    lookupResults.innerHTML = candidates.map((candidate, index) => renderCandidate(candidate, index, requestedFrequency, mode)).join('');
  }

  function populateReceivers() {
    if (!receiverSelect) return;
    receiverSelect.innerHTML = RECEIVERS.map((receiver, index) =>
      `<option value="${index}">${escapeHtml(receiver.name)} · ${escapeHtml(receiver.location)}</option>`
    ).join('');
  }

  function frequencyFromCard(card) {
    const freqEl = card.querySelector('.frequency');
    if (!freqEl) return null;
    const unit = freqEl.querySelector('span')?.textContent?.trim().toLowerCase() || '';
    const clone = freqEl.cloneNode(true);
    clone.querySelector('span')?.remove();
    const value = Number(clone.textContent.replace(/,/g, '').trim());
    if (!Number.isFinite(value) || value <= 0) return null;
    if (unit.includes('mhz')) return value * 1000;
    if (unit.includes('khz')) return value;
    return value < 100 ? value * 1000 : value;
  }

  function openLookupForFrequency(frequencyKHz) {
    frequencyInput.value = Number.isInteger(frequencyKHz) ? String(frequencyKHz) : frequencyKHz.toFixed(1);
    lastFrequency = frequencyKHz;
    showLookup();
    runLookup();
    lookupView.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function decorateFrontPageCard(card) {
    if (!card.classList.contains('signal-card') || card.querySelector('[data-card-live-row]')) return;
    const frequencyKHz = frequencyFromCard(card);
    if (!Number.isFinite(frequencyKHz) || frequencyKHz < 100 || frequencyKHz > 30000) return;

    const stationName = card.querySelector('.station-name')?.textContent?.trim() || 'this signal';
    const receiver = RECEIVERS[0];
    const liveUrl = liveReceiverUrl(frequencyKHz, 'am', receiver);
    const row = document.createElement('div');
    row.className = 'card-live-row';
    row.dataset.cardLiveRow = 'true';

    const live = document.createElement('a');
    live.className = 'listen-live-button card-listen-live';
    live.href = liveUrl;
    if (!isAndroid) {
      live.target = '_blank';
      live.rel = 'noopener noreferrer';
    }
    live.setAttribute('aria-label', `Listen live to ${stationName} near ${formatLookupFrequency(frequencyKHz)}`);
    live.innerHTML = '<span class="live-dot" aria-hidden="true"></span><span>Listen live</span>';

    const options = document.createElement('button');
    options.type = 'button';
    options.className = 'card-receiver-options';
    options.textContent = 'Receiver options';
    options.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openLookupForFrequency(frequencyKHz);
    });

    row.append(live, options);
    const toggle = card.querySelector('[data-card-toggle]');
    if (toggle) card.insertBefore(row, toggle);
    else card.appendChild(row);
  }

  function decorateFrontPageCards() {
    document.querySelectorAll('.signal-card').forEach(decorateFrontPageCard);
  }

  function stabilizeBackgroundLocationRefresh() {
    if (!locationButton) return;
    if (locationButton.textContent.trim() !== 'Refreshing…') return;
    if (!loadStoredLocation()) return;
    locationButton.textContent = '✓ Located';
  }

  const style = document.createElement('style');
  style.id = 'signal-scout-live-actions-styles';
  style.textContent = `
    .card-live-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 11px;
      padding-top: 10px;
      border-top: 1px solid rgba(37,212,230,.1);
    }
    .card-listen-live {
      min-height: 36px;
      padding: 8px 11px;
      flex: 0 0 auto;
    }
    .card-receiver-options {
      min-height: 36px;
      border: 1px solid #1d3940;
      border-radius: 5px;
      padding: 8px 10px;
      color: #8fa4aa;
      background: rgba(5,13,16,.78);
      font-family: var(--mono);
      font-size: 9px;
      font-weight: 800;
      letter-spacing: .05em;
      text-transform: uppercase;
    }
    .card-receiver-options:hover {
      border-color: #2b5962;
      color: var(--accent-soft);
    }
    @media (max-width: 430px) {
      .card-live-row { align-items: stretch; }
      .card-listen-live,
      .card-receiver-options { flex: 1 1 0; justify-content: center; }
    }
  `;
  document.head.appendChild(style);

  lookupButton.addEventListener('click', showLookup);
  onAirButton?.addEventListener('click', () => {
    if (discoveryBestOnly && bestBetsButton) bestBetsButton.click();
    showDiscover(onAirButton);
  });
  bestBetsButton?.addEventListener('click', () => {
    discoveryBestOnly = bestBetsButton.classList.contains('active');
    showDiscover(bestBetsButton);
  });
  lookupSubmit.addEventListener('click', runLookup);
  frequencyInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') runLookup();
  });
  modeSelect?.addEventListener('change', () => {
    if (lastFrequency != null) runLookup();
  });
  receiverSelect?.addEventListener('change', () => {
    if (lastFrequency != null) runLookup();
  });

  document.querySelectorAll('[data-lookup-offset]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-lookup-offset]').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      lookupOffsetHours = Number(button.dataset.lookupOffset || 0);
      updateTimeLabel();
      if (lastFrequency != null) runLookup();
    });
  });

  populateReceivers();
  updateTimeLabel();
  decorateFrontPageCards();
  stabilizeBackgroundLocationRefresh();

  if (signalGrid) {
    new MutationObserver(() => window.requestAnimationFrame(decorateFrontPageCards))
      .observe(signalGrid, { childList: true, subtree: true });
  }

  if (locationButton) {
    new MutationObserver(stabilizeBackgroundLocationRefresh)
      .observe(locationButton, { childList: true, subtree: true, characterData: true });
  }

  if (window.SIGNAL_SCOUT_DATA_READY?.then) {
    window.SIGNAL_SCOUT_DATA_READY.then(() => {
      decorateFrontPageCards();
      if (lastFrequency != null) runLookup();
    }).catch(() => {});
  }
})();
