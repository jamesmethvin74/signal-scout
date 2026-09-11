(() => {
  if (new URLSearchParams(window.location.search).get('classic') === '1') return;

  const main = document.querySelector('.app-shell main');
  const grid = document.getElementById('signalGrid');
  const player = document.getElementById('sdrPlayer');
  if (!main || !grid || !player) return;

  const state = {
    targets: [],
    peaks: [],
    centerKHz: null,
    spanKHz: null,
    currentFrequency: null,
    currentMode: 'am',
    started: false,
    live: false,
    rfFrames: 0,
    pendingAutoLand: false,
    autoLandStartedAt: 0,
    dialDrag: null,
    panel: null,
    manualTuneSeen: false,
    lastDialTuneAt: 0
  };

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  function parseNumber(text) {
    const value = Number(String(text || '').replace(/,/g, '').match(/[0-9]+(?:\.[0-9]+)?/)?.[0]);
    return Number.isFinite(value) ? value : null;
  }

  function parsePlayerFrequency() {
    return parseNumber(player.querySelector('[data-sdr-frequency]')?.textContent || '');
  }

  function formatFrequency(kHz) {
    if (!Number.isFinite(kHz)) return '—';
    const rounded = Math.round(kHz * 10) / 10;
    return rounded.toLocaleString(undefined, {
      minimumFractionDigits: Number.isInteger(rounded) ? 0 : 1,
      maximumFractionDigits: 1
    });
  }

  function fallbackTarget() {
    const hour = new Date().getHours();
    if (hour >= 18 || hour < 7) return { frequency: 5000, station: 'WWV · time and frequency standard', mode: 'am' };
    if (hour >= 10 && hour < 17) return { frequency: 15000, station: 'WWV · time and frequency standard', mode: 'am' };
    return { frequency: 10000, station: 'WWV · time and frequency standard', mode: 'am' };
  }

  function frequencyFromCard(card) {
    const el = card?.querySelector('.frequency');
    if (!el) return null;
    const unit = el.querySelector('span')?.textContent?.trim().toLowerCase() || '';
    const clone = el.cloneNode(true);
    clone.querySelector('span')?.remove();
    let value = parseNumber(clone.textContent);
    if (!Number.isFinite(value)) return null;
    if (unit.includes('mhz')) value *= 1000;
    return value;
  }

  function collectTargets() {
    const cards = [...grid.querySelectorAll(':scope > .signal-card')];
    const seen = new Set();
    const targets = [];
    for (const card of cards) {
      if (card.matches('[data-ham-card]')) continue;
      const frequency = frequencyFromCard(card);
      if (!Number.isFinite(frequency)) continue;
      const station = card.querySelector('.station-name')?.textContent?.trim() || 'Scheduled signal';
      const key = `${frequency.toFixed(1)}|${station}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ frequency, station, mode: 'am' });
      if (targets.length >= 14) break;
    }
    state.targets = targets;
    renderDiscoverList();
  }

  const home = document.createElement('section');
  home.className = 'fb2-home';
  home.id = 'fbTunerHome';
  home.innerHTML = `
    <div class="fb2-hero">
      <div class="fb2-topline">
        <div class="fb2-live-label"><span class="fb2-live-dot"></span><span data-fb2-live-text>Real public SDR</span></div>
        <button class="fb2-location" type="button" data-fb2-location>Choose listening location</button>
      </div>

      <div class="fb2-readout">
        <div class="fb2-eyebrow">Tuned frequency</div>
        <div class="fb2-frequency-line"><span class="fb2-frequency" data-fb2-frequency>—</span><span class="fb2-unit">kHz</span></div>
        <div class="fb2-station" data-fb2-station>Tap Start Listening and FREQBEACON will put you on the air.</div>
        <div class="fb2-mode-row" role="group" aria-label="Radio mode">
          <button class="fb2-mode is-active" type="button" data-fb2-mode="am">AM</button>
          <button class="fb2-mode" type="button" data-fb2-mode="sam">SAM</button>
          <button class="fb2-mode" type="button" data-fb2-mode="lsb">LSB</button>
          <button class="fb2-mode" type="button" data-fb2-mode="usb">USB</button>
        </div>
      </div>

      <div class="fb2-stage">
        <div class="fb2-start-layer">
          <div class="fb2-start-inner">
            <div class="fb2-start-mark">⌁</div>
            <h2>Turn on the radio.</h2>
            <p>This is a real receiver, not a demo. One tap connects to a public SDR and starts with a signal that is likely to be active right now.</p>
            <button class="fb2-start-button" type="button" data-fb2-start>Start listening</button>
            <div class="fb2-start-note">LIVE AUDIO · LIVE RF · NO FAKE WATERFALL</div>
          </div>
        </div>
        <div class="fb2-player-slot" data-fb2-player-slot></div>
        <div class="fb2-coach" data-fb2-coach hidden></div>
      </div>

      <div class="fb2-signal-strip" data-fb2-signal-strip>
        <span class="fb2-signal-caption">Live carriers</span>
        <span class="fb2-signal-empty">Start the radio and strong signals will appear here.</span>
      </div>

      <div class="fb2-dial-zone">
        <div class="fb2-dial" data-fb2-dial tabindex="0" aria-label="Drag left or right to tune">
          <div class="fb2-dial-scale"><span>LOWER</span><span>◀</span><span>●</span><span>▶</span><span>HIGHER</span></div>
        </div>
      </div>

      <div class="fb2-actions">
        <button class="fb2-action" type="button" data-fb2-seek="-1"><strong>◀ Seek</strong>previous signal</button>
        <button class="fb2-action is-primary" type="button" data-fb2-find><strong>Find signal</strong>strongest live carrier</button>
        <button class="fb2-action" type="button" data-fb2-seek="1"><strong>Seek ▶</strong>next signal</button>
        <button class="fb2-action" type="button" data-fb2-identify><strong>What is this?</strong>identify frequency</button>
        <button class="fb2-action" type="button" data-fb2-receiver><strong>Receiver</strong>change location</button>
      </div>

      <div class="fb2-footerbar">
        <div class="fb2-receiver" data-fb2-receiver-label>Receiver will be selected automatically for the signal.</div>
        <button class="fb2-more" type="button" data-fb2-more>Discover stations & bands</button>
      </div>
    </div>

    <section class="fb2-panel" data-fb2-panel hidden>
      <div class="fb2-panel-head">
        <div><h3>Go somewhere interesting</h3><p>Scheduled stations are ranked by FREQBEACON; nearby live carriers come directly from the receiver waterfall.</p></div>
        <button class="fb2-panel-close" type="button" data-fb2-panel-close aria-label="Close">×</button>
      </div>
      <div class="fb2-discover-list" data-fb2-discover-list></div>
      <div class="fb2-band-row">
        <button class="fb2-band" type="button" data-fb2-jump="3900|lsb|80 meters · voice"><b>80m</b>Night voice</button>
        <button class="fb2-band" type="button" data-fb2-jump="7200|lsb|40 meters · voice"><b>40m</b>Regional voice</button>
        <button class="fb2-band" type="button" data-fb2-jump="14300|usb|20 meters · voice"><b>20m</b>DX voice</button>
        <button class="fb2-band" type="button" data-fb2-jump="28400|usb|10 meters · voice"><b>10m</b>Daytime voice</button>
      </div>
      <div class="fb2-classic-link">Need all the schedules and filters? <a href="/?classic=1">Open Classic FREQBEACON</a></div>
    </section>`;

  main.insertBefore(home, main.firstChild);
  document.body.classList.add('fb-tuner-v2');
  home.querySelector('[data-fb2-player-slot]').appendChild(player);

  const frequencyEl = home.querySelector('[data-fb2-frequency]');
  const stationEl = home.querySelector('[data-fb2-station]');
  const receiverEl = home.querySelector('[data-fb2-receiver-label]');
  const liveTextEl = home.querySelector('[data-fb2-live-text]');
  const coachEl = home.querySelector('[data-fb2-coach]');
  const signalStrip = home.querySelector('[data-fb2-signal-strip]');
  const dial = home.querySelector('[data-fb2-dial]');
  const panel = home.querySelector('[data-fb2-panel]');
  state.panel = panel;

  function setCoach(html, timeout = 0) {
    coachEl.innerHTML = html;
    coachEl.hidden = false;
    if (timeout) {
      window.clearTimeout(setCoach.timer);
      setCoach.timer = window.setTimeout(() => { coachEl.hidden = true; }, timeout);
    }
  }

  function updateLocationLabel() {
    const source = document.getElementById('locationName');
    const button = home.querySelector('[data-fb2-location]');
    const text = source?.textContent?.trim();
    button.textContent = text && text !== 'Location not set' ? `Listening from ${text}` : 'Choose listening location';
  }

  function playerMode() {
    return String(player.querySelector('[data-sdr-mode]')?.value || 'am').toLowerCase();
  }

  function updateFromPlayer() {
    const frequency = parsePlayerFrequency();
    if (Number.isFinite(frequency)) state.currentFrequency = frequency;
    state.currentMode = playerMode();
    frequencyEl.textContent = formatFrequency(state.currentFrequency);
    const station = player.querySelector('[data-sdr-station]')?.textContent?.trim();
    if (station) stationEl.textContent = station;

    home.querySelectorAll('[data-fb2-mode]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.fb2Mode === state.currentMode);
    });

    const status = String(player.querySelector('[data-sdr-status]')?.textContent || '').trim();
    const receiver = String(player.querySelector('[data-sdr-receiver]')?.textContent || '').trim();
    state.live = status.toLowerCase() === 'live rf';
    home.classList.toggle('is-live', state.live);
    liveTextEl.textContent = state.live ? 'Live RF + audio' : (status || 'Real public SDR');
    if (receiver) receiverEl.textContent = receiver;
  }

  function proxyMarkup(target) {
    const frequency = Number(target.frequency);
    const mode = String(target.mode || 'am').toLowerCase();
    if (mode === 'usb' || mode === 'lsb' || mode === 'sam') {
      return `<div class="lookup-result" hidden><span class="lookup-result-frequency">${frequency.toFixed(1)} kHz</span><h3>${escapeHtml(target.station || 'Live signal')}</h3><button class="listen-live-button" type="button" data-ham-quick-mode="${escapeHtml(mode)}">Listen</button></div>`;
    }
    const mhz = frequency >= 1000;
    const value = mhz ? (frequency / 1000).toFixed(3) : frequency.toFixed(Number.isInteger(frequency) ? 0 : 1);
    return `<article class="signal-card" hidden><div class="frequency">${value}<span>${mhz ? 'MHz' : 'kHz'}</span></div><div class="station-name">${escapeHtml(target.station || 'Live signal')}</div><button class="listen-live-button" type="button">Listen</button></article>`;
  }

  function startTarget(target, { autoLand = true } = {}) {
    if (!target || !Number.isFinite(Number(target.frequency))) return;
    state.started = true;
    state.pendingAutoLand = Boolean(autoLand);
    state.autoLandStartedAt = performance.now();
    state.rfFrames = 0;
    home.classList.add('has-started');
    stationEl.textContent = target.station || 'Finding a live signal…';
    state.currentFrequency = Number(target.frequency);
    state.currentMode = target.mode || 'am';
    frequencyEl.textContent = formatFrequency(state.currentFrequency);
    setCoach('<b>Connecting…</b> FREQBEACON is choosing a useful public receiver. When the waterfall lights up, every trace you see is real RF from that receiver.');

    const holder = document.createElement('div');
    holder.dataset.fb2Proxy = '1';
    holder.innerHTML = proxyMarkup(target);
    document.body.appendChild(holder);
    const button = holder.querySelector('.listen-live-button');
    if (!button) {
      holder.remove();
      return;
    }
    button.click();
    window.setTimeout(() => holder.remove(), 0);
  }

  function bestStartTarget() {
    return state.targets[0] || fallbackTarget();
  }

  function renderDiscoverList() {
    const list = home.querySelector('[data-fb2-discover-list]');
    if (!list) return;
    const targets = state.targets.slice(0, 8);
    if (!targets.length) {
      list.innerHTML = '<div class="fb2-signal-empty">Current schedule recommendations are still loading.</div>';
      return;
    }
    list.innerHTML = targets.map((target, index) => `
      <button class="fb2-discover-target" type="button" data-fb2-target-index="${index}">
        <b>${escapeHtml(formatFrequency(target.frequency))}</b>
        <span>${escapeHtml(target.station)}</span>
        <em>LISTEN</em>
      </button>`).join('');
  }

  function rfGeometry() {
    const canvas = player.querySelector('[data-sdr-rf-v2-canvas]');
    if (!canvas) return null;
    const label = player.querySelector('.sdr-spectrum-label')?.textContent || '';
    const span = Number(label.match(/([0-9]+(?:\.[0-9]+)?)\s*kHz\s+span/i)?.[1]);
    const current = parsePlayerFrequency();
    if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(current)) return null;
    let center = current;
    const cursor = player.querySelector('[data-sdr-active-cursor]');
    if (cursor && !cursor.hidden) {
      const ratio = Number.parseFloat(cursor.style.left) / 100;
      if (Number.isFinite(ratio)) center = current - (ratio - 0.5) * span;
    }
    return { canvas, span, center, start: center - span / 2, stop: center + span / 2 };
  }

  function tuneTo(frequency, { teach = true } = {}) {
    if (!state.started || !Number.isFinite(Number(frequency))) return false;
    const geometry = rfGeometry();
    if (!geometry) return false;
    const rect = geometry.canvas.getBoundingClientRect();
    if (rect.width <= 0) return false;
    const guard = geometry.span * 0.008;
    const target = Math.max(geometry.start + guard, Math.min(geometry.stop - guard, Number(frequency)));
    const ratio = (target - geometry.start) / geometry.span;
    const clientX = rect.left + ratio * rect.width;
    const pointerId = 919;
    const options = { bubbles: true, cancelable: true, pointerId, isPrimary: true, pointerType: 'mouse', clientX, clientY: rect.top + rect.height * 0.55, buttons: 1 };
    geometry.canvas.dispatchEvent(new PointerEvent('pointerdown', options));
    geometry.canvas.dispatchEvent(new PointerEvent('pointerup', { ...options, buttons: 0 }));
    state.currentFrequency = target;
    state.centerKHz = geometry.center;
    state.spanKHz = geometry.span;
    if (teach && !state.manualTuneSeen) {
      state.manualTuneSeen = true;
      setCoach('<b>That moved the live receiver.</b> Now try dragging the tuning scale. The waterfall stays put while the tuning needle moves, so you can explore nearby activity without throwing away the view.', 6500);
    }
    return true;
  }

  function sortedPeaks() {
    return state.peaks
      .filter((peak) => Number.isFinite(peak.frequencyKHz))
      .slice()
      .sort((a, b) => a.frequencyKHz - b.frequencyKHz);
  }

  function seek(direction) {
    const peaks = sortedPeaks();
    const current = state.currentFrequency ?? parsePlayerFrequency();
    if (!peaks.length || !Number.isFinite(current)) {
      setCoach('<b>No clear carriers yet.</b> Give the waterfall another second to build, then try Seek again.', 2800);
      return;
    }
    let candidate;
    if (direction > 0) candidate = peaks.find((peak) => peak.frequencyKHz > current + 0.25) || peaks[0];
    else candidate = [...peaks].reverse().find((peak) => peak.frequencyKHz < current - 0.25) || peaks[peaks.length - 1];
    tuneTo(candidate.frequencyKHz);
  }

  function strongestPeak() {
    const current = state.currentFrequency ?? parsePlayerFrequency();
    const peaks = state.peaks
      .filter((peak) => Number.isFinite(peak.frequencyKHz))
      .slice()
      .sort((a, b) => (b.prominenceDb || 0) - (a.prominenceDb || 0));
    return peaks.find((peak) => !Number.isFinite(current) || Math.abs(peak.frequencyKHz - current) > 0.35) || peaks[0] || null;
  }

  function findSignal() {
    const peak = strongestPeak();
    if (!peak) {
      setCoach('<b>I do not have a trustworthy RF peak yet.</b> Let the live waterfall fill for a moment; I only want this button to move you to a signal the receiver can actually see.', 3600);
      return;
    }
    tuneTo(peak.frequencyKHz);
    setCoach(`<b>Moved to a live carrier at ${formatFrequency(peak.frequencyKHz)} kHz.</b> Listen for a few seconds. If it is data or noise, hit Find signal again or Seek.`, 5200);
  }

  function maybeAutoLand() {
    if (!state.pendingAutoLand || state.rfFrames < 3 || performance.now() - state.autoLandStartedAt < 500) return;
    const current = state.currentFrequency ?? parsePlayerFrequency();
    if (!Number.isFinite(current) || !state.peaks.length) return;
    const nearby = state.peaks
      .filter((peak) => Math.abs(peak.frequencyKHz - current) <= 8)
      .map((peak) => ({ ...peak, score: (peak.prominenceDb || 0) - Math.abs(peak.frequencyKHz - current) * 1.35 }))
      .sort((a, b) => b.score - a.score)[0];
    state.pendingAutoLand = false;
    if (nearby && (nearby.prominenceDb || 0) >= 5.5 && Math.abs(nearby.frequencyKHz - current) >= 0.35) tuneTo(nearby.frequencyKHz, { teach: false });
    setCoach('<b>You are looking at live RF.</b> Bright vertical traces are signals. Tap one in the waterfall, hit Seek, or drag the tuning scale below it. FREQBEACON keeps the RF view around you while you explore.', 7500);
  }

  function renderPeaks() {
    const caption = '<span class="fb2-signal-caption">Live carriers</span>';
    const peaks = state.peaks.slice(0, 8);
    if (!peaks.length) {
      signalStrip.innerHTML = `${caption}<span class="fb2-signal-empty">Waiting for distinct RF peaks…</span>`;
      return;
    }
    signalStrip.innerHTML = caption + peaks.map((peak, index) => {
      const strength = (peak.prominenceDb || 0) >= 10 ? 'is-strong' : '';
      return `<button class="fb2-signal-chip ${strength}" type="button" data-fb2-peak="${index}"><strong>${escapeHtml(formatFrequency(peak.frequencyKHz))}</strong> ${escapeHtml((peak.prominenceDb || 0) >= 10 ? 'strong' : 'signal')}</button>`;
    }).join('');
  }

  function setMode(mode) {
    const select = player.querySelector('[data-sdr-mode]');
    if (!select || !['am', 'sam', 'usb', 'lsb'].includes(mode)) return;
    select.value = mode;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    state.currentMode = mode;
    updateFromPlayer();
  }

  function identifyCurrent() {
    const frequency = state.currentFrequency ?? parsePlayerFrequency();
    if (!Number.isFinite(frequency)) {
      setCoach('<b>Start the radio first.</b> Then I can identify the tuned frequency.', 2500);
      return;
    }
    const lookupView = document.getElementById('lookupView');
    const input = document.getElementById('lookupFrequency');
    const mode = document.getElementById('lookupMode');
    const submit = document.getElementById('lookupSubmit');
    if (!lookupView || !input || !submit) return;
    input.value = String(Math.round(frequency * 10) / 10);
    if (mode) mode.value = ['am', 'sam', 'usb', 'lsb'].includes(state.currentMode) ? state.currentMode : 'am';
    lookupView.hidden = false;
    document.body.classList.add('fb2-show-lookup');
    submit.click();
    window.setTimeout(() => lookupView.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  function togglePanel(force) {
    const open = force ?? panel.hidden;
    panel.hidden = !open;
    if (open) {
      renderDiscoverList();
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function dialSpan() {
    if (Number.isFinite(state.spanKHz) && state.spanKHz > 0) return state.spanKHz;
    return state.currentMode === 'usb' || state.currentMode === 'lsb' ? 29.3 : 58.6;
  }

  function beginDial(event) {
    if (!state.started || !Number.isFinite(state.currentFrequency)) return;
    state.dialDrag = {
      id: event.pointerId,
      startX: event.clientX,
      startFrequency: state.currentFrequency,
      width: Math.max(240, dial.getBoundingClientRect().width),
      moved: false
    };
    try { dial.setPointerCapture(event.pointerId); } catch {}
  }

  function moveDial(event) {
    const drag = state.dialDrag;
    if (!drag || drag.id !== event.pointerId) return;
    const delta = event.clientX - drag.startX;
    if (Math.abs(delta) > 3) drag.moved = true;
    if (!drag.moved) return;
    const now = performance.now();
    if (now - state.lastDialTuneAt < 90) return;
    state.lastDialTuneAt = now;
    const target = drag.startFrequency - (delta / drag.width) * dialSpan() * 0.88;
    tuneTo(target, { teach: true });
  }

  function endDial(event) {
    const drag = state.dialDrag;
    if (!drag || drag.id !== event.pointerId) return;
    state.dialDrag = null;
    try { dial.releasePointerCapture(event.pointerId); } catch {}
  }

  function wheelTune(event) {
    if (!state.started) return;
    event.preventDefault();
    const current = state.currentFrequency ?? parsePlayerFrequency();
    if (!Number.isFinite(current)) return;
    const fine = state.currentMode === 'usb' || state.currentMode === 'lsb';
    const step = fine ? 0.1 : 1;
    tuneTo(current + (event.deltaY > 0 ? -step : step));
  }

  function detectLivePeaks() {
    if (!state.started || !state.live) return;
    const geometry = rfGeometry();
    if (!geometry) return;
    const canvas = geometry.canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || canvas.width < 80 || canvas.height < 80) return;
    const spectrumH = Math.round(canvas.height * 0.56);
    const y = Math.min(canvas.height - 3, spectrumH + 2);
    let image;
    try { image = ctx.getImageData(0, y, canvas.width, Math.min(4, canvas.height - y)); } catch { return; }
    const scores = new Float32Array(canvas.width);
    const rows = image.height;
    for (let x = 0; x < canvas.width; x += 1) {
      let total = 0;
      for (let row = 0; row < rows; row += 1) {
        const p = (row * canvas.width + x) * 4;
        total += image.data[p] * 0.28 + image.data[p + 1] * 0.48 + image.data[p + 2] * 0.24;
      }
      scores[x] = total / rows;
    }
    const sample = Array.from(scores).filter((_, x) => x > canvas.width * .04 && x < canvas.width * .96).sort((a, b) => a - b);
    if (sample.length < 32) return;
    const baseline = sample[Math.floor(sample.length * .55)];
    const threshold = baseline + 14;
    const candidates = [];
    const edge = Math.round(canvas.width * .04);
    for (let x = edge + 2; x < canvas.width - edge - 2; x += 1) {
      const value = scores[x];
      if (value < threshold || value < scores[x - 1] || value < scores[x + 1]) continue;
      candidates.push({ x, prominence: value - baseline });
    }
    candidates.sort((a, b) => b.prominence - a.prominence);
    const selected = [];
    const minGap = Math.max(8, Math.round(canvas.width / 90));
    for (const candidate of candidates) {
      if (selected.some((item) => Math.abs(item.x - candidate.x) < minGap)) continue;
      selected.push(candidate);
      if (selected.length >= 10) break;
    }
    state.centerKHz = geometry.center;
    state.spanKHz = geometry.span;
    state.peaks = selected.map((item) => ({
      frequencyKHz: geometry.start + (item.x / Math.max(1, canvas.width - 1)) * geometry.span,
      prominenceDb: item.prominence
    })).sort((a, b) => b.prominenceDb - a.prominenceDb);
    state.rfFrames += 1;
    renderPeaks();
    maybeAutoLand();
  }

  home.querySelector('[data-fb2-start]').addEventListener('click', () => startTarget(bestStartTarget()));
  home.querySelector('[data-fb2-location]').addEventListener('click', () => document.getElementById('locationButton')?.click());
  home.querySelector('[data-fb2-find]').addEventListener('click', findSignal);
  home.querySelectorAll('[data-fb2-seek]').forEach((button) => button.addEventListener('click', () => seek(Number(button.dataset.fb2Seek))));
  home.querySelector('[data-fb2-identify]').addEventListener('click', identifyCurrent);
  home.querySelector('[data-fb2-receiver]').addEventListener('click', () => player.querySelector('[data-sdr-receiver-button]')?.click());
  home.querySelector('[data-fb2-more]').addEventListener('click', () => togglePanel());
  home.querySelector('[data-fb2-panel-close]').addEventListener('click', () => togglePanel(false));
  home.querySelectorAll('[data-fb2-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.fb2Mode)));

  home.addEventListener('click', (event) => {
    const targetButton = event.target.closest('[data-fb2-target-index]');
    if (targetButton) {
      const target = state.targets[Number(targetButton.dataset.fb2TargetIndex)];
      if (target) {
        togglePanel(false);
        startTarget(target);
      }
      return;
    }
    const peakButton = event.target.closest('[data-fb2-peak]');
    if (peakButton) {
      const peak = state.peaks[Number(peakButton.dataset.fb2Peak)];
      if (peak) tuneTo(peak.frequencyKHz);
      return;
    }
    const jump = event.target.closest('[data-fb2-jump]');
    if (jump) {
      const [frequency, mode, station] = String(jump.dataset.fb2Jump).split('|');
      togglePanel(false);
      startTarget({ frequency: Number(frequency), mode, station }, { autoLand: true });
    }
  });

  dial.addEventListener('pointerdown', beginDial);
  dial.addEventListener('pointermove', moveDial);
  dial.addEventListener('pointerup', endDial);
  dial.addEventListener('pointercancel', endDial);
  dial.addEventListener('wheel', wheelTune, { passive: false });
  dial.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const current = state.currentFrequency ?? parsePlayerFrequency();
    if (!Number.isFinite(current)) return;
    const step = (state.currentMode === 'usb' || state.currentMode === 'lsb') ? 0.1 : 1;
    tuneTo(current + (event.key === 'ArrowRight' ? step : -step));
  });

  window.setInterval(detectLivePeaks, 360);

  new MutationObserver(updateFromPlayer).observe(player, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['class', 'value']
  });

  const locationName = document.getElementById('locationName');
  if (locationName) new MutationObserver(updateLocationLabel).observe(locationName, { childList: true, subtree: true, characterData: true });
  new MutationObserver(() => window.requestAnimationFrame(collectTargets)).observe(grid, { childList: true, subtree: false });

  document.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.target?.matches?.('input, textarea, select, [contenteditable="true"]') || !state.started) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const current = state.currentFrequency ?? parsePlayerFrequency();
    if (!Number.isFinite(current)) return;
    const step = (state.currentMode === 'usb' || state.currentMode === 'lsb') ? 0.1 : 1;
    tuneTo(current + (event.key === 'ArrowRight' ? step : -step));
  });

  collectTargets();
  updateLocationLabel();
  updateFromPlayer();
  renderPeaks();
})();
