(() => {
  'use strict';

  // Zero display adapter only. The shared engine performs lookup/ranking when
  // the user taps the frequency. No work runs continuously while tuning.
  const engine = window.FREQBEACON_IDENTIFICATION_ENGINE;
  const frequencyButton = document.querySelector('.zero-frequency');
  const frequencyDisplay = document.querySelector('#frequencyDisplay');
  const frequencyUnit = document.querySelector('#frequencyUnit');
  const frequencyBridge = document.querySelector('#frequencyValue');
  const receiverIdentity = document.querySelector('#receiverIdentity');

  if (!engine || !frequencyButton || !frequencyDisplay) return;

  let backdrop = null;
  let titleEl = null;
  let eyebrowEl = null;
  let metaEl = null;
  let descriptionEl = null;
  let noteEl = null;
  let closeButton = null;
  let lookupToken = 0;

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

  function scheduleLabel(entry, schedule) {
    if (!entry?.start || !entry?.end) return '';
    const window = `${String(entry.start).padStart(4, '0')}–${String(entry.end).padStart(4, '0')} UTC`;
    if (!schedule) return `static schedule ${window}`;
    return `${schedule.active ? 'in' : 'outside'} static schedule ${window}`;
  }

  function exactEyebrow(result) {
    const entry = result.entry;
    if (entry.type === 'station' && entry.band === 'MW') return 'LIKELY STATION';
    if (entry.type === 'station' && (entry.band === 'SW' || entry.band === 'LW')) {
      if (result.confidence === 'likely') return 'LIKELY BROADCAST';
      if (result.confidence === 'cataloged') return 'CATALOGED BROADCAST';
      return 'KNOWN BROADCAST';
    }
    if (entry.type === 'signal') return result.confidence === 'likely' ? 'LIKELY SIGNAL' : 'KNOWN SIGNAL';
    if (entry.type === 'channel') return 'KNOWN CHANNEL';
    if (entry.type === 'service') return 'KNOWN SERVICE';
    return 'KNOWN SIGNAL';
  }

  function exactMeta(entry) {
    if (entry.type === 'station') {
      return [
        entry.callsign && entry.callsign !== entry.name ? entry.callsign : '',
        entry.transmitter || entry.location,
        entry.language,
        entry.mode
      ].filter(Boolean).join(' · ');
    }
    if (entry.type === 'signal') {
      return [entry.callsign && entry.callsign !== entry.name ? entry.callsign : '', entry.location, entry.mode]
        .filter(Boolean).join(' · ');
    }
    if (entry.type === 'channel') return [entry.callsign, entry.mode].filter(Boolean).join(' · ');
    return [entry.shortName, entry.mode].filter(Boolean).join(' · ');
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

  function renderExact(result) {
    const entry = result.entry;
    eyebrowEl.textContent = exactEyebrow(result);
    titleEl.textContent = entry.name;
    metaEl.textContent = exactMeta(entry);
    descriptionEl.textContent = entry.description || entry.format || 'Known cataloged signal.';
    const details = [engine.formatFrequency(result.frequencyKHz)];
    if (Number.isFinite(result.distance)) details.push(`about ${Math.round(result.distance)} mi from receiver`);
    if (entry.classA) details.push('Class A / clear-channel');
    const schedule = scheduleLabel(entry, result.schedule);
    if (schedule) details.push(schedule);
    if (entry.target) details.push(`target: ${entry.target}`);
    if (result.alternatives?.length) details.push(`${result.alternatives.length} other exact-frequency candidate${result.alternatives.length === 1 ? '' : 's'}`);
    noteEl.textContent = details.join(' · ');
  }

  function renderRange(result) {
    const range = result.range;
    eyebrowEl.textContent = range.type === 'band' || range.type === 'broadcast-band' ? 'BAND' : 'SERVICE';
    titleEl.textContent = range.name;
    metaEl.textContent = [engine.formatRange(range), range.mode].filter(Boolean).join(' · ');
    descriptionEl.textContent = range.description;
    noteEl.textContent = `${engine.formatFrequency(result.frequencyKHz)} · local frequency guide`;
  }

  function renderUnknown(result) {
    eyebrowEl.textContent = 'FREQUENCY';
    titleEl.textContent = engine.formatFrequency(result.frequencyKHz);
    metaEl.textContent = 'No catalog match yet';
    descriptionEl.textContent = 'This frequency is not in the static identification catalog yet. The radio continues to work normally while the catalog grows.';
    noteEl.textContent = 'Static catalog only · no live schedule request';
  }

  function render(result) {
    if (!result) return;
    if (result.kind === 'exact') renderExact(result);
    else if (result.kind === 'range') renderRange(result);
    else renderUnknown(result);
  }

  function open() {
    if (!backdrop) createUi();
    const kHz = tunedKHz();
    if (!Number.isFinite(kHz)) return;
    const options = { receiverIdentity: String(receiverIdentity?.textContent || '').trim() };
    const token = ++lookupToken;

    // Open immediately from the in-memory catalog; a static A26 shard may then
    // enrich the same sheet. This request happens only because the user tapped.
    render(engine.identify(kHz, options));
    backdrop.hidden = false;
    window.requestAnimationFrame(() => closeButton?.focus({ preventScroll: true }));

    if (typeof engine.identifyAsync === 'function') {
      engine.identifyAsync(kHz, options).then((result) => {
        if (token !== lookupToken || !backdrop || backdrop.hidden) return;
        if (Math.abs(tunedKHz() - kHz) > 0.25) return;
        render(result);
      }).catch(() => {});
    }
  }

  function close() {
    lookupToken += 1;
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
