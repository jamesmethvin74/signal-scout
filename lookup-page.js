(() => {
  'use strict';

  const engine = window.FREQBEACON_IDENTIFICATION_ENGINE;
  const form = document.querySelector('#lookupForm');
  const input = document.querySelector('#lookupFrequency');
  const clearButton = document.querySelector('#lookupClear');
  const stage = document.querySelector('#lookupResults');
  const count = document.querySelector('#lookupResultCount');
  const status = document.querySelector('#lookupStatus');
  if (!engine || !form || !input || !stage || !count) return;

  const LOCATION_STORAGE_KEY = 'signalScout:location:v1';
  let lookupToken = 0;

  function esc(value) {
    return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
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
      return { lat, lon, identity: payload?.label || 'Your listening location' };
    } catch { return null; }
  }

  function inferredMode(item, frequencyKHz) {
    const mode = String(item?.mode || '').toLowerCase();
    if (mode.includes('usb')) return 'usb';
    if (mode.includes('lsb')) return 'lsb';
    if (mode.includes('nbfm') || mode === 'fm') return 'nbfm';
    if (mode.includes('cw') && !mode.includes('am')) return 'cw';
    const categories = new Set((item?.categories || []).map((value) => String(value).toLowerCase()));
    if (categories.has('amateur')) return Number(frequencyKHz) < 10000 ? 'lsb' : 'usb';
    return 'am';
  }

  function tuneHref(frequencyKHz, item) {
    return `/zero?frequency=${encodeURIComponent(Number(frequencyKHz).toFixed(3))}&mode=${encodeURIComponent(inferredMode(item, frequencyKHz))}&from=lookup`;
  }

  function categoryLabel(entry) {
    const cats = new Set((entry?.categories || []).map((value) => String(value).toLowerCase()));
    if (cats.has('religious')) return 'Religious';
    if (cats.has('sports')) return 'Sports';
    if (cats.has('news')) return 'News';
    if (cats.has('aviation')) return 'Aviation';
    if (cats.has('cb')) return 'CB';
    if (cats.has('amateur') && cats.has('voice')) return 'Amateur Voice';
    if (cats.has('digital')) return 'Digital';
    if (cats.has('utility')) return 'Utility';
    if (cats.has('international')) return 'International';
    if (entry?.band === 'MW') return 'AM Broadcast';
    if (entry?.band === 'SW') return 'Shortwave';
    if (entry?.band === 'LW') return 'Longwave';
    return entry?.type ? String(entry.type).replace('-', ' ') : 'Radio service';
  }

  function statusLabel(candidate, isBest) {
    if (candidate.schedule?.active === true) return { text: 'ON NOW', now: true };
    if (candidate.schedule?.active === false) return { text: 'SCHEDULED', now: false };
    if (candidate.entry?.type === 'station' && isBest) return { text: 'LIKELY NOW', now: false };
    return { text: candidate.entry?.type === 'station' ? 'POSSIBLE' : 'KNOWN', now: false };
  }

  function candidateCard(candidate, frequencyKHz, index) {
    const entry = candidate.entry;
    const statusState = statusLabel(candidate, index === 0);
    const place = entry.transmitter || entry.location || entry.country || '';
    const meta = [engine.formatFrequency(frequencyKHz), entry.language || '', categoryLabel(entry)].filter(Boolean);
    const description = entry.description || entry.format || 'Known FREQBEACON catalog entry.';
    const guideClass = entry.type === 'station' && String(entry.band || '').toUpperCase() === 'SW' ? ' lookup-result' : '';
    return `<article class="lookup-result-card${guideClass} ${index === 0 ? 'is-best' : ''}">
      <div class="lookup-card-body">
        ${index === 0 ? '<span class="lookup-best-badge">BEST MATCH</span>' : ''}
        <div class="lookup-card-title-row">
          <h3 class="lookup-card-title station-name">${esc(entry.name || entry.callsign || 'Known signal')}</h3>
          <span class="lookup-status-pill ${statusState.now ? 'is-now' : ''}"><i aria-hidden="true"></i>${esc(statusState.text)}</span>
        </div>
        <div class="lookup-result-frequency" hidden>${esc(Number(frequencyKHz).toFixed(3))} kHz</div>
        <div class="lookup-card-meta">${meta.map((item) => `<span>${esc(item)}</span>`).join('')}</div>
        ${place ? `<div class="lookup-card-location">${esc(place)}</div>` : ''}
        <div class="lookup-card-divider"></div>
        <div class="lookup-card-program-label">${candidate.schedule?.active === true ? 'Now Playing' : 'Identification'}</div>
        <p class="lookup-card-description">${esc(description)}</p>
        <div class="lookup-tags"><span class="lookup-tag">${esc(categoryLabel(entry))}</span>${entry.language ? `<span class="lookup-tag">${esc(entry.language)}</span>` : ''}</div>
      </div>
      <div class="lookup-card-actions"><a class="lookup-tune" href="${esc(tuneHref(frequencyKHz, entry))}">TUNE</a></div>
    </article>`;
  }

  function categorySelected() {
    return window.FREQBEACON_LOOKUP_CATEGORIES?.selected?.() || window.FREQBEACON_LOOKUP_SELECTED_CATEGORY || '';
  }

  function categoryMatches(entry, key) {
    if (!key) return true;
    try { return window.FREQBEACON_LOOKUP_CATEGORIES?.matches?.(entry, key) !== false; }
    catch { return true; }
  }

  function orderedCandidates(result) {
    const candidates = [{ entry: result.entry, distance: result.distance, schedule: result.schedule, rank: result.rank }, ...(result.alternatives || [])];
    const selected = categorySelected();
    if (!selected) return candidates;
    const matching = candidates.filter((candidate) => categoryMatches(candidate.entry, selected));
    return matching.length ? matching : candidates;
  }

  function renderExact(result) {
    const candidates = orderedCandidates(result);
    count.textContent = `${candidates.length} result${candidates.length === 1 ? '' : 's'} for ${Number(result.frequencyKHz).toFixed(3)} kHz`;
    stage.innerHTML = candidates.slice(0, 8).map((candidate, index) => candidateCard(candidate, result.frequencyKHz, index)).join('');
  }

  function renderRange(result) {
    const range = result.range;
    count.textContent = `1 result for ${Number(result.frequencyKHz).toFixed(3)} kHz`;
    stage.innerHTML = `<article class="lookup-result-card is-best">
      <div class="lookup-card-body">
        <span class="lookup-best-badge">BEST MATCH</span>
        <div class="lookup-card-title-row"><h3 class="lookup-card-title">${esc(range.name)}</h3><span class="lookup-status-pill"><i aria-hidden="true"></i>KNOWN RANGE</span></div>
        <div class="lookup-card-meta"><span>${esc(engine.formatFrequency(result.frequencyKHz))}</span><span>${esc(range.mode || 'Varies')}</span><span>${esc(categoryLabel(range))}</span></div>
        <div class="lookup-card-divider"></div>
        <div class="lookup-card-program-label">Frequency Guide</div>
        <p class="lookup-card-description">${esc(range.description || 'Known radio allocation or service range.')}</p>
      </div>
      <div class="lookup-card-actions"><a class="lookup-tune" href="${esc(tuneHref(result.frequencyKHz, range))}">TUNE</a></div>
    </article>`;
  }

  function renderUnknown(result) {
    count.textContent = `No catalog match for ${Number(result.frequencyKHz).toFixed(3)} kHz`;
    stage.innerHTML = `<div class="lookup-empty"><strong>${esc(Number(result.frequencyKHz).toFixed(3))} kHz</strong><p>No exact identity is stored yet. You can still tune the frequency in Radio.</p><div class="lookup-card-actions" style="justify-content:center;padding-top:12px"><a class="lookup-tune" href="${esc(tuneHref(result.frequencyKHz, {}))}">TUNE</a></div></div>`;
  }

  function render(result) {
    if (!result) return;
    if (result.kind === 'exact') renderExact(result);
    else if (result.kind === 'range') renderRange(result);
    else renderUnknown(result);
  }

  async function runLookup({ updateUrl = true } = {}) {
    const frequencyKHz = parseFrequency(input.value);
    if (!frequencyKHz || frequencyKHz < 30 || frequencyKHz > 30000) {
      status.className = 'lookup-status is-error';
      status.textContent = 'Enter a frequency from 30 to 30,000 kHz.';
      count.textContent = '';
      stage.innerHTML = '<div class="lookup-empty"><strong>Frequency not recognized.</strong><p>Try a value such as 9955, 9.955 MHz, 11175 or 27185.</p></div>';
      return;
    }

    const token = ++lookupToken;
    const receiver = storedLocation();
    const options = { now: new Date(), ...(receiver ? { receiver } : {}) };
    input.value = Number(frequencyKHz).toFixed(3);
    if (updateUrl) history.replaceState(null, '', `/lookup.html?frequency=${encodeURIComponent(input.value)}`);
    status.className = 'lookup-status is-working';
    status.textContent = 'Checking the FREQBEACON identification catalog…';

    render(engine.identify(frequencyKHz, options));
    if (typeof engine.identifyAsync === 'function') {
      try {
        const result = await engine.identifyAsync(frequencyKHz, options);
        if (token !== lookupToken) return;
        render(result);
      } catch (error) {
        console.warn('FREQBEACON lookup enrichment failed:', error);
      }
    }
    if (token !== lookupToken) return;
    status.className = 'lookup-status';
    status.textContent = categorySelected() ? 'Frequency results prioritized by the selected category when a matching candidate exists.' : 'Lookup complete.';
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    runLookup();
  });

  clearButton?.addEventListener('click', () => {
    lookupToken += 1;
    input.value = '';
    window.FREQBEACON_LOOKUP_CATEGORIES?.clearSelection?.();
    status.className = 'lookup-status';
    status.textContent = '';
    count.textContent = '';
    stage.innerHTML = '<div class="lookup-empty"><strong>Enter a frequency or choose a category.</strong><p>FREQBEACON will use its real identification catalog and schedule data to show the best matches.</p></div>';
    history.replaceState(null, '', '/lookup.html');
    input.focus({ preventScroll: true });
  });

  const params = new URLSearchParams(location.search);
  const incoming = params.get('frequency') || params.get('q') || params.get('lookup');
  if (incoming) {
    input.value = incoming;
    runLookup({ updateUrl: false });
  }
})();
