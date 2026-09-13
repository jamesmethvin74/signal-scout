(() => {
  'use strict';

  const engine = window.FREQBEACON_IDENTIFICATION_ENGINE;
  const form = document.querySelector('#lookupForm');
  const input = document.querySelector('#lookupFrequency');
  const stage = document.querySelector('#lookupStage');
  const clock = document.querySelector('#lookupClock');
  if (!engine || !form || !input || !stage) return;

  const LOCATION_STORAGE_KEY = 'signalScout:location:v1';
  let offsetHours = 0;
  let lookupToken = 0;

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function parseFrequency(raw) {
    const text = String(raw || '').trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '');
    if (!text) return null;
    const explicitMHz = /(?:mhz|m)$/.test(text);
    const explicitKHz = /(?:khz|k)$/.test(text);
    const numeric = Number(text.replace(/mhz|khz|m|k/g, ''));
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    if (explicitMHz) return numeric * 1000;
    if (explicitKHz) return numeric;
    return numeric < 100 ? numeric * 1000 : numeric;
  }

  function storedLocation() {
    try {
      const payload = JSON.parse(localStorage.getItem(LOCATION_STORAGE_KEY) || 'null');
      const lat = Number(payload?.lat);
      const lon = Number(payload?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon, identity: payload?.name || 'Your listening location' };
    } catch {
      return null;
    }
  }

  function lookupDate() {
    return new Date(Date.now() + offsetHours * 3600000);
  }

  function updateClock() {
    const date = lookupDate();
    const utc = `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')} UTC`;
    const local = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
    if (clock) clock.textContent = `${local} · ${utc}`;
  }

  function scheduleText(entry, schedule) {
    if (!entry?.start || !entry?.end) return 'Not time-specific';
    const start = String(entry.start).padStart(4, '0');
    const end = String(entry.end).padStart(4, '0');
    const label = `${start.slice(0, 2)}:${start.slice(2)}–${end === '2400' ? '24:00' : `${end.slice(0, 2)}:${end.slice(2)}`} UTC`;
    if (!schedule) return label;
    return `${schedule.active ? 'On schedule' : 'Outside schedule'} · ${label}`;
  }

  function powerText(entry) {
    const watts = Number(entry?.powerW);
    if (!Number.isFinite(watts) || watts <= 0) return 'Not listed';
    if (watts >= 1000) return `${(watts / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} kW`;
    return `${Math.round(watts)} W`;
  }

  function inferredMode(item, frequencyKHz) {
    const mode = String(item?.mode || '').toLowerCase();
    if (mode.includes('usb')) return 'usb';
    if (mode.includes('lsb')) return 'lsb';
    if (mode.includes('nbfm') || mode === 'fm') return 'nbfm';
    if (mode.includes('cw') && !mode.includes('am')) return 'cw';
    const categories = new Set(item?.categories || []);
    if (categories.has('amateur')) return Number(frequencyKHz) < 10000 ? 'lsb' : 'usb';
    return 'am';
  }

  function statusLabel(result) {
    const entry = result.entry;
    if (entry.type === 'station' && entry.band === 'MW') return 'LIKELY STATION';
    if (entry.type === 'station') {
      if (result.confidence === 'likely') return 'LIKELY BROADCAST';
      if (result.confidence === 'cataloged') return 'CATALOGED BROADCAST';
      return 'KNOWN BROADCAST';
    }
    if (entry.type === 'signal') return result.confidence === 'likely' ? 'LIKELY SIGNAL' : 'KNOWN SIGNAL';
    if (entry.type === 'channel') return 'KNOWN CHANNEL';
    if (entry.type === 'service') return 'KNOWN SERVICE';
    return 'KNOWN SIGNAL';
  }

  function resultMeta(entry) {
    return [
      entry.callsign && entry.callsign !== entry.name ? entry.callsign : '',
      entry.transmitter || entry.location || entry.country,
      entry.language,
      entry.mode
    ].filter(Boolean).join(' · ');
  }

  function tuneHref(frequencyKHz, item) {
    const mode = inferredMode(item, frequencyKHz);
    return `/zero?frequency=${encodeURIComponent(Number(frequencyKHz).toFixed(3))}&mode=${encodeURIComponent(mode)}&from=lookup`;
  }

  function tagsHtml(categories = []) {
    return [...new Set(categories)].slice(0, 8).map((category) => `<span class="lookup-tag">${escapeHtml(String(category).replaceAll('-', ' '))}</span>`).join('');
  }

  function detail(label, value) {
    if (!value) return '';
    return `<div class="lookup-detail"><small>${escapeHtml(label)}</small><b>${escapeHtml(value)}</b></div>`;
  }

  function alternativeHtml(candidate, frequencyKHz) {
    const entry = candidate.entry;
    const schedule = candidate.schedule;
    return `<div class="lookup-alternative">
      <div>
        <strong>${escapeHtml(entry.name || 'Catalog candidate')}</strong>
        <span>${escapeHtml([entry.transmitter || entry.location || entry.country, entry.language, entry.mode].filter(Boolean).join(' · '))}</span>
      </div>
      <span class="lookup-alt-status">${escapeHtml(schedule?.active === true ? 'ON SCHEDULE' : schedule?.active === false ? 'CATALOGED' : engine.formatFrequency(frequencyKHz))}</span>
    </div>`;
  }

  function renderExact(result) {
    const entry = result.entry;
    const categories = entry.categories || [];
    const alternatives = (result.alternatives || []).slice(0, 6);
    const location = storedLocation();
    const distance = Number.isFinite(result.distance) && result.distance !== Infinity
      ? `${entry.locationApproximate ? '≈' : ''}${Math.round(result.distance).toLocaleString()} mi${location ? ' from your saved location' : ''}`
      : '';
    const schedule = scheduleText(entry, result.schedule);

    stage.innerHTML = `
      <article class="lookup-result-card">
        <div class="lookup-result-top">
          <div class="lookup-result-eyebrow"><span>${escapeHtml(statusLabel(result))}</span><span>SHARED IDENTIFICATION ENGINE</span></div>
          <div class="lookup-result-frequency">${escapeHtml(engine.formatFrequency(result.frequencyKHz))}</div>
          <h2>${escapeHtml(entry.name || 'Known signal')}</h2>
          <p class="lookup-result-meta">${escapeHtml(resultMeta(entry) || 'Known catalog entry')}</p>
          <p class="lookup-result-description">${escapeHtml(entry.description || entry.format || 'Known cataloged signal or service.')}</p>
          <div class="lookup-tags">${tagsHtml(categories)}</div>
        </div>
        <div class="lookup-detail-grid">
          ${detail('Schedule', schedule)}
          ${detail('Transmitter', entry.transmitter || entry.location || entry.country || 'Not listed')}
          ${detail('Language', entry.language || 'Not listed')}
          ${detail('Power', powerText(entry))}
          ${detail('Target', entry.target || '')}
          ${detail('Distance', distance)}
          ${detail('Source', entry.source || entry.season || 'FREQBEACON catalog')}
          ${detail('Other candidates', alternatives.length ? `${alternatives.length} shown${(result.alternatives || []).length > alternatives.length ? ` of ${(result.alternatives || []).length}` : ''}` : 'None at this exact frequency')}
        </div>
        <div class="lookup-actions">
          <a class="lookup-action-primary" href="${escapeHtml(tuneHref(result.frequencyKHz, entry))}"><i aria-hidden="true"></i>Tune this in Zero</a>
          <a class="lookup-action-secondary" href="/">Back to discovery</a>
        </div>
      </article>
      ${alternatives.length ? `<div class="lookup-alternatives"><h3>Other exact-frequency candidates</h3>${alternatives.map((candidate) => alternativeHtml(candidate, result.frequencyKHz)).join('')}</div>` : ''}`;
  }

  function renderRange(result) {
    const range = result.range;
    stage.innerHTML = `
      <article class="lookup-result-card lookup-range-card">
        <div class="lookup-result-top">
          <div class="lookup-result-eyebrow"><span>${range.type === 'band' || range.type === 'broadcast-band' ? 'BAND' : 'SERVICE RANGE'}</span><span>FREQUENCY GUIDE</span></div>
          <div class="lookup-result-frequency">${escapeHtml(engine.formatFrequency(result.frequencyKHz))}</div>
          <h2>${escapeHtml(range.name)}</h2>
          <p class="lookup-result-meta">${escapeHtml([engine.formatRange(range), range.mode].filter(Boolean).join(' · '))}</p>
          <p class="lookup-result-description">${escapeHtml(range.description || 'Known radio allocation or service range.')}</p>
          <div class="lookup-tags">${tagsHtml(range.categories || [])}</div>
        </div>
        <div class="lookup-detail-grid">
          ${detail('Allocation', engine.formatRange(range))}
          ${detail('Typical mode', range.mode || 'Varies')}
          ${detail('Source', range.source || 'FREQBEACON band guide')}
        </div>
        <div class="lookup-actions">
          <a class="lookup-action-primary" href="${escapeHtml(tuneHref(result.frequencyKHz, range))}"><i aria-hidden="true"></i>Tune this in Zero</a>
          <a class="lookup-action-secondary" href="/">Back to discovery</a>
        </div>
      </article>`;
  }

  function renderUnknown(result) {
    stage.innerHTML = `<div class="lookup-empty">
      <div class="lookup-empty-rings" aria-hidden="true"><i></i><i></i><i></i></div>
      <strong>${escapeHtml(engine.formatFrequency(result.frequencyKHz))}</strong>
      <p>No exact station, signal, channel or known range is in the shared static catalog yet. Zero can still tune it normally.</p>
      <div class="lookup-actions" style="justify-content:center"><a class="lookup-action-primary" href="${escapeHtml(tuneHref(result.frequencyKHz, {}))}"><i aria-hidden="true"></i>Tune in Zero</a></div>
    </div>`;
  }

  function render(result) {
    if (!result) return;
    if (result.kind === 'exact') renderExact(result);
    else if (result.kind === 'range') renderRange(result);
    else renderUnknown(result);
  }

  async function runLookup({ updateUrl = true } = {}) {
    const frequencyKHz = parseFrequency(input.value);
    updateClock();
    if (!frequencyKHz || frequencyKHz < 30 || frequencyKHz > 30000) {
      stage.innerHTML = `<div class="lookup-empty"><strong>Enter a frequency from 30 to 30,000 kHz.</strong><p>Examples: 153, 9955, 10 MHz, 11175, 14.200 MHz or 27185.</p></div>`;
      return;
    }

    const token = ++lookupToken;
    const now = lookupDate();
    const receiver = storedLocation();
    const options = { now, ...(receiver ? { receiver } : {}) };
    const normalized = Number.isInteger(frequencyKHz) ? String(frequencyKHz) : String(Number(frequencyKHz.toFixed(3)));
    input.value = normalized;
    if (updateUrl) history.replaceState(null, '', `/lookup.html?frequency=${encodeURIComponent(normalized)}${offsetHours ? `&offset=${offsetHours}` : ''}`);

    render(engine.identify(frequencyKHz, options));
    if (typeof engine.identifyAsync !== 'function') return;

    stage.insertAdjacentHTML('beforeend', '<div class="lookup-loading" id="lookupLoading"><i></i>CHECKING STATIC A26 CATALOG…</div>');
    try {
      const result = await engine.identifyAsync(frequencyKHz, options);
      if (token !== lookupToken) return;
      render(result);
    } catch {
      document.querySelector('#lookupLoading')?.remove();
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    runLookup();
  });

  document.querySelectorAll('[data-offset]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-offset]').forEach((peer) => peer.classList.toggle('active', peer === button));
      offsetHours = Number(button.dataset.offset || 0);
      updateClock();
      if (parseFrequency(input.value)) runLookup();
    });
  });

  document.querySelectorAll('[data-quick]').forEach((button) => {
    button.addEventListener('click', () => {
      input.value = button.dataset.quick || '';
      runLookup();
      input.focus({ preventScroll: true });
    });
  });

  const params = new URLSearchParams(location.search);
  const incoming = params.get('frequency') || params.get('q') || params.get('lookup');
  const incomingOffset = Number(params.get('offset'));
  if ([0, 1, 3, 6].includes(incomingOffset)) {
    offsetHours = incomingOffset;
    document.querySelectorAll('[data-offset]').forEach((button) => button.classList.toggle('active', Number(button.dataset.offset) === offsetHours));
  }
  updateClock();
  if (incoming) {
    input.value = incoming;
    runLookup({ updateUrl: false });
  } else {
    window.setTimeout(() => input.focus({ preventScroll: true }), 50);
  }
})();
