(() => {
  'use strict';

  const engine = window.FREQBEACON_IDENTIFICATION_ENGINE;
  const form = document.querySelector('#lookupForm');
  const input = document.querySelector('#lookupFrequency');
  const stage = document.querySelector('#lookupResults');
  const count = document.querySelector('#lookupResultCount');
  const status = document.querySelector('#lookupStatus');
  const resultsTitle = document.querySelector('#lookupResultsTitle');
  const receiverCard = document.querySelector('#lookupRadioContext');
  const receiverName = document.querySelector('#lookupReceiverName');
  const receiverPlace = document.querySelector('#lookupReceiverPlace');
  const modeChip = document.querySelector('#lookupModeChip');
  const submit = form?.querySelector('.lookup-submit');
  if (!engine || !form || !input || !stage || !count || !status) return;

  let lookupToken = 0;
  let validatedReceiver = null;

  function esc(value) {
    return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  }

  function selectedReceiverId() {
    const match = document.cookie.match(/(?:^|;\s*)fb_explore_receiver=([^;]+)/);
    if (!match) return '';
    try { return decodeURIComponent(match[1]); } catch { return ''; }
  }

  function radioContext() {
    return window.FREQBEACON_RADIO_CONTEXT?.read?.() || {};
  }

  function contextFrequency(context = radioContext()) {
    const value = Number(context?.frequencyKHz);
    return Number.isFinite(value) && value >= 30 && value <= 30000 ? value : null;
  }

  function contextMode(context = radioContext()) {
    return String(context?.mode || 'am').toUpperCase();
  }

  function receiverFromFeature(feature) {
    const properties = feature?.properties || {};
    const coordinates = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    if (!properties.id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return {
      id: String(properties.id),
      name: String(properties.name || 'Trusted KiwiSDR'),
      location: String(properties.location || properties.country || 'Location not published'),
      country: String(properties.country || ''),
      receiverType: String(properties.receiverType || 'KiwiSDR'),
      antenna: String(properties.antenna || ''),
      lat,
      lon,
      trusted: true
    };
  }

  async function resolveActiveReceiver({ force = false } = {}) {
    const receiverId = selectedReceiverId();
    if (!receiverId) return null;
    if (!force && validatedReceiver?.id === receiverId) return validatedReceiver;

    const stored = radioContext()?.receiver;
    try {
      const response = await fetch('/api/explore/receivers', {
        cache: 'no-store',
        headers: { accept: 'application/geo+json,application/json' }
      });
      if (!response.ok) throw new Error(`trusted receiver feed ${response.status}`);
      const payload = await response.json();
      const feature = (payload?.features || []).find((item) => String(item?.properties?.id || '') === receiverId);
      const receiver = receiverFromFeature(feature);
      if (!receiver) return null;
      validatedReceiver = receiver;
      window.FREQBEACON_RADIO_CONTEXT?.update?.({ receiver, receiverConfirmedAt: Date.now() });
      return receiver;
    } catch (error) {
      const storedLat = Number(stored?.lat);
      const storedLon = Number(stored?.lon);
      if (String(stored?.id || '') === receiverId && stored?.trusted === true && Number.isFinite(storedLat) && Number.isFinite(storedLon)) {
        validatedReceiver = { ...stored, lat: storedLat, lon: storedLon };
        return validatedReceiver;
      }
      throw error;
    }
  }

  function paintRadioContext(receiver, context) {
    receiverCard?.classList.toggle('is-missing', !receiver);
    if (receiverName) receiverName.textContent = receiver ? receiver.name : 'Choose a receiver in Explore';
    if (receiverPlace) receiverPlace.textContent = receiver
      ? receiver.location
      : 'Lookup only identifies signals from the receiver currently selected for Radio.';
    if (modeChip) modeChip.textContent = contextMode(context);
  }

  function showMissingContext(message, context = radioContext()) {
    paintRadioContext(null, context);
    const frequencyKHz = contextFrequency(context);
    input.value = frequencyKHz == null ? '—' : frequencyKHz.toFixed(3);
    count.textContent = '';
    if (resultsTitle) resultsTitle.textContent = "WHAT YOU'RE HEARING";
    status.className = 'lookup-status is-error';
    status.textContent = message;
    stage.innerHTML = `<div class="lookup-empty"><strong>Radio context required.</strong><p>${esc(message)}</p><a class="lookup-radio-change" href="/explore">CHOOSE RECEIVER</a></div>`;
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
      <div class="lookup-card-actions"><a class="lookup-tune" href="/zero">RADIO</a></div>
    </article>`;
  }

  function categorySelected() {
    return window.FREQBEACON_LOOKUP_CATEGORIES?.selected?.() || window.FREQBEACON_LOOKUP_SELECTED_CATEGORY || '';
  }

  function renderExact(result) {
    const candidates = [{ entry: result.entry, distance: result.distance, schedule: result.schedule, rank: result.rank }, ...(result.alternatives || [])];
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
      <div class="lookup-card-actions"><a class="lookup-tune" href="/zero">RADIO</a></div>
    </article>`;
  }

  function renderUnknown(result) {
    count.textContent = `No catalog match for ${Number(result.frequencyKHz).toFixed(3)} kHz`;
    stage.innerHTML = `<div class="lookup-empty"><strong>${esc(Number(result.frequencyKHz).toFixed(3))} kHz</strong><p>No exact identity is stored yet for the frequency this receiver is tuned to.</p><div class="lookup-card-actions" style="justify-content:center;padding-top:12px"><a class="lookup-tune" href="/zero">RADIO</a></div></div>`;
  }

  function render(result) {
    if (!result) return;
    if (result.kind === 'exact') renderExact(result);
    else if (result.kind === 'range') renderRange(result);
    else renderUnknown(result);
  }

  async function runLookup({ forceReceiverRefresh = false } = {}) {
    const token = ++lookupToken;
    const context = radioContext();
    const frequencyKHz = contextFrequency(context);
    if (frequencyKHz == null) {
      showMissingContext('Open Radio and tune a frequency first.', context);
      return;
    }

    input.value = frequencyKHz.toFixed(3);
    if (modeChip) modeChip.textContent = contextMode(context);
    status.className = 'lookup-status is-working';
    status.textContent = 'Confirming the active trusted receiver…';
    if (submit) submit.disabled = true;

    let receiver;
    try {
      receiver = await resolveActiveReceiver({ force: forceReceiverRefresh });
    } catch (error) {
      console.warn('FREQBEACON active receiver confirmation failed:', error);
      receiver = null;
    }
    if (token !== lookupToken) return;
    if (!receiver) {
      if (submit) submit.disabled = false;
      showMissingContext('Choose a currently trusted receiver in Explore, then open Radio before using Lookup.', context);
      return;
    }

    paintRadioContext(receiver, context);

    const selectedCategory = categorySelected();
    if (selectedCategory) {
      const browsed = await window.FREQBEACON_LOOKUP_CATEGORIES?.browse?.(receiver, context);
      if (token !== lookupToken) return;
      if (browsed) {
        if (submit) submit.disabled = false;
        return;
      }
    }

    if (resultsTitle) resultsTitle.textContent = "WHAT YOU'RE HEARING";
    const options = {
      now: new Date(),
      receiver: {
        lat: receiver.lat,
        lon: receiver.lon,
        identity: `${receiver.name} · ${receiver.location}`
      }
    };

    status.className = 'lookup-status is-working';
    status.textContent = `Identifying ${frequencyKHz.toFixed(3)} kHz as heard from ${receiver.location}…`;
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
    status.textContent = `${contextMode(context)} · ${receiver.name} · ranked from the receiver's location`;
    if (submit) submit.disabled = false;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    runLookup({ forceReceiverRefresh: true });
  });

  window.addEventListener('freqbeacon:lookup-filter-change', () => {
    runLookup();
  });

  window.addEventListener('freqbeacon:radio-context', () => {
    runLookup();
  });

  history.replaceState(null, '', '/lookup.html');
  runLookup({ forceReceiverRefresh: true });
})();