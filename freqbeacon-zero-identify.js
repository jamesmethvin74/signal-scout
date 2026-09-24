(() => {
  'use strict';

  // Zero display adapter only. The shared engine performs lookup/ranking when
  // the user deliberately asks what is on the tuned frequency. No work runs
  // continuously while tuning.
  const engine = window.FREQBEACON_IDENTIFICATION_ENGINE;
  const readout = document.querySelector('.zero-readout');
  const frequencyDisplay = document.querySelector('#frequencyDisplay');
  const frequencyUnit = document.querySelector('#frequencyUnit');
  const frequencyBridge = document.querySelector('#frequencyValue');
  const receiverIdentity = document.querySelector('#receiverIdentity');
  const RECEIVER_SNAPSHOT_KEY = 'freqbeacon:explore-receiver-snapshot:v1';

  if (!engine || !readout || !frequencyDisplay) return;

  const identifyButton = document.createElement('button');
  identifyButton.type = 'button';
  identifyButton.id = 'zeroIdentifyButton';
  identifyButton.className = 'zero-identify-trigger';
  identifyButton.title = 'What am I hearing?';
  identifyButton.setAttribute('aria-label', 'What am I hearing? Identify the tuned frequency');
  identifyButton.innerHTML = '<span aria-hidden="true">?</span><small>IDENTIFY</small>';
  readout.prepend(identifyButton);

  let backdrop = null;
  let titleEl = null;
  let eyebrowEl = null;
  let metaEl = null;
  let descriptionEl = null;
  let programEl = null;
  let noteEl = null;
  let closeButton = null;
  let lookupToken = 0;
  let programKey = '';

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

  function selectedReceiverId() {
    const match = document.cookie.match(/(?:^|;\s*)fb_explore_receiver=([^;]+)/);
    if (!match) return '';
    try { return decodeURIComponent(match[1]); } catch { return ''; }
  }

  function validReceiver(receiver, selectedId) {
    if (!selectedId || !receiver || typeof receiver !== 'object') return null;
    if (String(receiver.id || '') !== selectedId) return null;

    const lat = Number(receiver.lat);
    const lon = Number(receiver.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

    return { ...receiver, lat, lon };
  }

  function selectedReceiverContext() {
    const selectedId = selectedReceiverId();
    if (!selectedId) return null;

    const live = validReceiver(window.FREQBEACON_RADIO_CONTEXT?.read?.()?.receiver, selectedId);
    if (live) return live;

    try {
      const snapshot = JSON.parse(localStorage.getItem(RECEIVER_SNAPSHOT_KEY) || 'null');
      return validReceiver(snapshot, selectedId);
    } catch {
      return null;
    }
  }

  function identificationOptions() {
    const options = {
      receiverIdentity: String(receiverIdentity?.textContent || '').trim()
    };
    const receiver = selectedReceiverContext();
    if (receiver) options.receiver = receiver;
    return options;
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
        <div class="zero-identify-program" hidden></div>
        <div class="zero-identify-note"></div>
      </section>`;
    document.body.appendChild(backdrop);
    titleEl = backdrop.querySelector('.zero-identify-title');
    eyebrowEl = backdrop.querySelector('.zero-identify-eyebrow');
    metaEl = backdrop.querySelector('.zero-identify-meta');
    descriptionEl = backdrop.querySelector('.zero-identify-description');
    programEl = backdrop.querySelector('.zero-identify-program');
    noteEl = backdrop.querySelector('.zero-identify-note');
    closeButton = backdrop.querySelector('.zero-identify-close');
    closeButton.addEventListener('click', close);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close();
    });
  }

  function programStation(entry) {
    const text = [entry?.callsign, entry?.name].filter(Boolean).join(' ');
    if (/WBCQ/i.test(text)) return 'WBCQ';
    if (/WRMI|Radio Miami International/i.test(text)) return 'WRMI';
    if (/Radio Exterior/i.test(text)) return 'REE';
    if (/Radio Romania|\\bRRI\\b/i.test(text)) return 'RRI';
    if (/KARN|Sports Animal 920/i.test(text)) return 'KARN';
    return entry?.callsign || entry?.name || '';
  }

  function clearProgram() {
    programKey = '';
    if (!programEl) return;
    programEl.hidden = true;
    programEl.className = 'zero-identify-program';
    programEl.innerHTML = '';
  }

  function renderProgram(data) {
    if (!programEl) return;
    const status = String(data?.status || '');
    if (status === 'unsupported') {
      clearProgram();
      return;
    }

    const verified = status === 'verified';
    const broadcast = status === 'broadcast';
    const conflict = status === 'ambiguous';
    const currentUnavailable = ['stale','expired','unavailable','unverified'].includes(status);
    programEl.hidden = false;
    programEl.className = 'zero-identify-program'
      + (verified || broadcast ? ' is-verified' : '')
      + (currentUnavailable || conflict ? ' is-warning' : '');

    const kicker = verified
      ? 'ON NOW · VERIFIED'
      : broadcast
        ? 'ON NOW · VERIFIED BROADCAST'
        : conflict
          ? 'PROGRAM GUIDE · PUBLISHED LISTINGS CONFLICT'
          : 'PROGRAM GUIDE · CURRENT DATA UNAVAILABLE';

    const title = verified || broadcast
      ? (data.program || 'Verified broadcast')
      : conflict
        ? 'Exact program not verified'
        : 'Station identified — current program schedule unavailable';

    const detail = verified || broadcast
      ? [data.window, data.sourceLabel].filter(Boolean).join(' · ')
      : conflict
        ? (data.candidates || []).join(' · ')
        : (data.message || 'No trustworthy current program listing is available for this station and time.');

    programEl.innerHTML = `
      <div class="zero-identify-program-kicker">${escapeHtml(kicker)}</div>
      <div class="zero-identify-program-title">${escapeHtml(title)}</div>
      ${detail ? `<div class="zero-identify-program-detail">${escapeHtml(detail)}</div>` : ''}`;
  }

  function loadProgramGuide(result) {
    if (!programEl || result?.kind !== 'exact' || result.entry?.type !== 'station') {
      clearProgram();
      return;
    }

    const station = programStation(result.entry);
    const nominal = Number(result.nominalFrequencyKHz ?? result.entry.frequencyKHz ?? result.frequencyKHz);
    if (!station || !Number.isFinite(nominal)) {
      clearProgram();
      return;
    }

    const token = lookupToken;
    const key = `${token}|${station}|${nominal.toFixed(3)}`;
    if (programKey === key) return;
    programKey = key;

    programEl.hidden = false;
    programEl.className = 'zero-identify-program is-loading';
    programEl.innerHTML = `
      <div class="zero-identify-program-kicker">PROGRAM GUIDE</div>
      <div class="zero-identify-program-title">Checking current program…</div>`;

    const params = new URLSearchParams({
      station,
      frequency:String(nominal),
      at:new Date().toISOString(),
      tz:Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    });

    fetch('/api/program-guide?' + params.toString(), { cache:'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('program guide HTTP ' + response.status);
        return response.json();
      })
      .then((data) => {
        if (token !== lookupToken || !backdrop || backdrop.hidden || programKey !== key) return;
        renderProgram(data);
      })
      .catch(() => {
        if (token !== lookupToken || !backdrop || backdrop.hidden || programKey !== key) return;
        renderProgram({
          status:'unavailable',
          message:'The current program guide could not be reached. Station identification is still valid.'
        });
      });
  }

  function renderExact(result) {
    const entry = result.entry;
    eyebrowEl.textContent = exactEyebrow(result);
    titleEl.textContent = entry.name;
    metaEl.textContent = exactMeta(entry);
    descriptionEl.textContent = entry.description || entry.format || 'Known cataloged signal.';
    const nominal = Number(result.nominalFrequencyKHz ?? entry.frequencyKHz ?? result.frequencyKHz);
    const offset = Number(result.frequencyOffsetKHz);
    const details = [engine.formatFrequency(nominal)];
    if (Number.isFinite(offset) && Math.abs(offset) >= 0.05) {
      const decimals = Math.abs(offset) < 1 ? 2 : 1;
      details.push(`tuned ${offset > 0 ? '+' : ''}${offset.toFixed(decimals)} kHz from channel center`);
    }
    if (Number.isFinite(result.distance)) details.push(`about ${Math.round(result.distance)} mi from receiver`);
    if (entry.classA) details.push('Class A / clear-channel');
    const schedule = scheduleLabel(entry, result.schedule);
    if (schedule) details.push(schedule);
    if (entry.target) details.push(`target: ${entry.target}`);
    if (result.alternatives?.length) details.push(`${result.alternatives.length} other candidate on this channel${result.alternatives.length === 1 ? '' : 's'}`);
    noteEl.textContent = details.join(' · ');
    loadProgramGuide(result);
  }

  function renderRange(result) {
    clearProgram();
    const range = result.range;
    eyebrowEl.textContent = range.type === 'band' || range.type === 'broadcast-band' ? 'BAND' : 'SERVICE';
    titleEl.textContent = range.name;
    metaEl.textContent = [engine.formatRange(range), range.mode].filter(Boolean).join(' · ');
    descriptionEl.textContent = range.description;
    noteEl.textContent = `${engine.formatFrequency(result.frequencyKHz)} · local frequency guide`;
  }

  function renderUnknown(result) {
    clearProgram();
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
    const options = identificationOptions();
    const token = ++lookupToken;

    // Open immediately from the in-memory catalog; a static A26 shard may then
    // enrich the same sheet. This request happens only because IDENTIFY was tapped.
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
    programKey = '';
    if (!backdrop || backdrop.hidden) return;
    backdrop.hidden = true;
    identifyButton.focus({ preventScroll: true });
  }

  identifyButton.addEventListener('click', open);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && backdrop && !backdrop.hidden) close();
  });
})();