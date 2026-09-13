(() => {
  'use strict';

  // Display-only identification adapter. It reads the already-rendered tuned
  // frequency and receiver identity, then performs a local in-memory lookup.
  // It does not open sockets, retune, fetch schedules, or make network calls.
  const catalog = window.FREQBEACON_ZERO_IDENTIFICATION_CATALOG;
  const frequencyButton = document.querySelector('.zero-frequency');
  const frequencyDisplay = document.querySelector('#frequencyDisplay');
  const frequencyUnit = document.querySelector('#frequencyUnit');
  const frequencyBridge = document.querySelector('#frequencyValue');
  const receiverIdentity = document.querySelector('#receiverIdentity');

  if (!catalog || !frequencyButton || !frequencyDisplay) return;

  let backdrop = null;
  let titleEl = null;
  let eyebrowEl = null;
  let metaEl = null;
  let descriptionEl = null;
  let noteEl = null;
  let closeButton = null;

  function tunedKHz() {
    const value = Number(String(frequencyDisplay.textContent || '').replace(/,/g, '').trim());
    const unit = String(frequencyUnit?.textContent || '').trim().toLowerCase();

    if (Number.isFinite(value) && value > 0) {
      if (unit.includes('mhz')) return value * 1000;
      if (unit.includes('khz')) return value;
    }

    const bridgeMHz = Number(frequencyBridge?.textContent);
    return Number.isFinite(bridgeMHz) && bridgeMHz > 0 ? bridgeMHz * 1000 : NaN;
  }

  function currentReceiver() {
    const identity = String(receiverIdentity?.textContent || '').trim();
    const upper = identity.toUpperCase();
    const known = (catalog.receivers || []).find((receiver) => upper.includes(String(receiver.match || '').toUpperCase()));
    return known ? { ...known, identity } : { identity };
  }

  function milesBetween(a, b) {
    if (![a?.lat, a?.lon, b?.lat, b?.lon].every(Number.isFinite)) return Infinity;
    const radiusMiles = 3958.8;
    const radians = Math.PI / 180;
    const dLat = (b.lat - a.lat) * radians;
    const dLon = (b.lon - a.lon) * radians;
    const x = Math.sin(dLat / 2) ** 2
      + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2;
    return 2 * radiusMiles * Math.asin(Math.sqrt(x));
  }

  function stationMatch(kHz, receiver) {
    const tolerance = kHz < 2000 ? 0.6 : 0.25;
    const matches = (catalog.stations || [])
      .filter((station) => Math.abs(Number(station.frequencyKHz) - kHz) <= tolerance)
      .map((station) => ({
        station,
        distance: milesBetween(receiver, station)
      }));

    if (!matches.length) return null;
    matches.sort((a, b) => a.distance - b.distance || String(a.station.name).localeCompare(String(b.station.name)));
    return matches[0];
  }

  function rangeMatch(kHz) {
    const matches = (catalog.ranges || [])
      .filter((range) => kHz >= Number(range.startKHz) && kHz <= Number(range.endKHz))
      .sort((a, b) => (Number(a.endKHz) - Number(a.startKHz)) - (Number(b.endKHz) - Number(b.startKHz)));
    return matches[0] || null;
  }

  function formatFrequency(kHz) {
    if (!Number.isFinite(kHz)) return 'Unknown frequency';
    if (kHz < 1000) {
      const decimals = Math.abs(kHz - Math.round(kHz)) < 0.001 ? 0 : 1;
      return `${kHz.toFixed(decimals)} kHz`;
    }
    const mhz = kHz / 1000;
    const decimals = Math.abs(kHz - Math.round(kHz)) < 0.001 ? 3 : 4;
    return `${mhz.toFixed(decimals)} MHz`;
  }

  function formatRange(range) {
    return `${formatFrequency(Number(range.startKHz))}–${formatFrequency(Number(range.endKHz))}`;
  }

  function createUi() {
    backdrop = document.createElement('div');
    backdrop.className = 'zero-identify-backdrop';
    backdrop.hidden = true;
    backdrop.innerHTML = `
      <section class="zero-identify-sheet" role="dialog" aria-modal="true" aria-labelledby="zeroIdentifyTitle">
        <button class="zero-identify-close" type="button" aria-label="Close identification">×</button>
        <p class="zero-identify-eyebrow"></p>
        <h2 class="zero-identify-title" id="zeroIdentifyTitle"></h2>
        <p class="zero-identify-meta"></p>
        <p class="zero-identify-description"></p>
        <div class="zero-identify-note"></div>
      </section>`;

    document.body.appendChild(backdrop);
    titleEl = backdrop.querySelector('.zero-identify-title');
    eyebrowEl = backdrop.querySelector('.zero-identify-eyebrow');
    metaEl = backdrop.querySelector('.zero-identify-meta');
    descriptionEl = backdrop.querySelector('.zero-identify-description');
    noteEl = backdrop.querySelector('.zero-identify-note');
    closeButton = backdrop.querySelector('.zero-identify-close');

    closeButton.addEventListener('click', close);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close();
    });
  }

  function open() {
    if (!backdrop) createUi();

    const kHz = tunedKHz();
    if (!Number.isFinite(kHz)) return;

    const receiver = currentReceiver();
    const candidate = stationMatch(kHz, receiver);

    if (candidate) {
      const { station } = candidate;
      eyebrowEl.textContent = 'LIKELY STATION';
      titleEl.textContent = station.name;
      metaEl.textContent = [station.callsign, station.location, station.mode].filter(Boolean).join(' · ');
      descriptionEl.textContent = station.description;

      const receiverLabel = receiver.identity || receiver.name || 'current receiver';
      noteEl.textContent = `${formatFrequency(kHz)} · likely match near ${receiverLabel}`;
    } else {
      const range = rangeMatch(kHz);
      if (range) {
        eyebrowEl.textContent = range.type === 'band' ? 'BAND' : 'SERVICE';
        titleEl.textContent = range.name;
        metaEl.textContent = [formatRange(range), range.mode].filter(Boolean).join(' · ');
        descriptionEl.textContent = range.description;
        noteEl.textContent = `${formatFrequency(kHz)} · local frequency guide`;
      } else {
        eyebrowEl.textContent = 'FREQUENCY';
        titleEl.textContent = formatFrequency(kHz);
        metaEl.textContent = 'No catalog match yet';
        descriptionEl.textContent = 'This frequency is not in the lightweight local identification catalog yet. The radio continues to work normally while the catalog grows.';
        noteEl.textContent = 'Local lookup only · no network request';
      }
    }

    backdrop.hidden = false;
    window.requestAnimationFrame(() => closeButton?.focus({ preventScroll: true }));
  }

  function close() {
    if (!backdrop || backdrop.hidden) return;
    backdrop.hidden = true;
    frequencyButton.focus({ preventScroll: true });
  }

  frequencyButton.setAttribute('role', 'button');
  frequencyButton.setAttribute('tabindex', '0');
  frequencyButton.setAttribute('title', 'Tap to identify this frequency');
  frequencyButton.setAttribute('aria-label', 'Identify the tuned frequency');

  frequencyButton.addEventListener('click', open);
  frequencyButton.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    open();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && backdrop && !backdrop.hidden) close();
  });
})();
