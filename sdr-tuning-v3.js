(() => {
  // Signal Scout interactive dial v3.
  // Important: the DOM observer is used only to discover the RF canvas once.
  // It disconnects after setup so cursor/readout updates cannot observe themselves.
  const WrappedWebSocket = window.WebSocket;
  const PASSBANDS = {
    am: [-4900, 4900],
    sam: [-4900, 4900],
    usb: [300, 2700],
    lsb: [-2700, -300]
  };
  const MIN_KHZ = 10;
  const MAX_KHZ = 30000;
  const DRAG_THRESHOLD_PX = 5;
  const LIVE_TUNE_INTERVAL_MS = 125;

  const state = {
    sndSocket: null,
    manualKHz: null,
    viewCenterKHz: null,
    drag: null,
    lastTuneAt: 0,
    tuneTimer: null,
    observer: null,
    uiReady: false
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function parseSocketMeta(rawUrl) {
    try {
      const url = new URL(String(rawUrl), window.location.href);
      if (url.host !== window.location.host || url.pathname !== '/api/sdr/ws') return null;
      return { stream: url.searchParams.get('stream') || 'SND' };
    } catch {
      return null;
    }
  }

  function currentMode() {
    const value = String(document.querySelector('#sdrMode, [data-sdr-mode]')?.value || 'am').toLowerCase();
    return PASSBANDS[value] ? value : 'am';
  }

  function isSsbMode(mode = currentMode()) {
    return mode === 'usb' || mode === 'lsb';
  }

  function parseFrequency(text) {
    const match = String(text || '').match(/([0-9][0-9,.]*)\s*kHz/i);
    if (!match) return null;
    const value = Number(match[1].replace(/,/g, ''));
    return Number.isFinite(value) ? value : null;
  }

  function displayedFrequency() {
    return parseFrequency(document.querySelector('[data-sdr-frequency]')?.textContent || '');
  }

  function spanKHz() {
    const label = document.querySelector('.sdr-spectrum-label')?.textContent || '';
    const match = label.match(/([0-9]+(?:\.[0-9]+)?)\s*kHz\s+span/i);
    const parsed = match ? Number(match[1]) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return isSsbMode() ? 14.6484375 : 29.296875;
  }

  function spectrumIsLive() {
    return /kHz\s+span/i.test(document.querySelector('.sdr-spectrum-label')?.textContent || '');
  }

  function snapFrequency(kHz) {
    const step = isSsbMode() ? 0.1 : 1;
    return clamp(Math.round(Number(kHz) / step) * step, MIN_KHZ, MAX_KHZ);
  }

  function formatFrequency(kHz) {
    const rounded = Math.round(kHz * 10) / 10;
    return Number.isInteger(rounded)
      ? rounded.toLocaleString()
      : rounded.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  function tuneButtonConfig(mode = currentMode()) {
    if (isSsbMode(mode)) {
      return [
        { step: -1, label: '−1', aria: 'Tune down 1 kilohertz' },
        { step: -0.1, label: '−0.1', aria: 'Tune down 100 hertz' },
        { step: 0.1, label: '+0.1', aria: 'Tune up 100 hertz' },
        { step: 1, label: '+1', aria: 'Tune up 1 kilohertz' }
      ];
    }

    return [
      { step: -5, label: '−5', aria: 'Tune down 5 kilohertz' },
      { step: -1, label: '−1', aria: 'Tune down 1 kilohertz' },
      { step: 1, label: '+1', aria: 'Tune up 1 kilohertz' },
      { step: 5, label: '+5', aria: 'Tune up 5 kilohertz' }
    ];
  }

  function refreshTuneButtons() {
    const strip = document.querySelector('[data-sdr-tune-strip]');
    if (!strip) return;
    const buttons = [...strip.querySelectorAll('[data-sdr-tune-step]')];
    const config = tuneButtonConfig();
    buttons.forEach((button, index) => {
      const item = config[index];
      if (!item) return;
      button.dataset.sdrTuneStep = String(item.step);
      if (button.textContent !== item.label) button.textContent = item.label;
      button.setAttribute('aria-label', item.aria);
    });
  }

  function ensureViewCenter() {
    if (Number.isFinite(state.viewCenterKHz)) return state.viewCenterKHz;
    const value = displayedFrequency();
    if (Number.isFinite(value)) state.viewCenterKHz = value;
    return state.viewCenterKHz;
  }

  function setText(el, value) {
    if (el && el.textContent !== value) el.textContent = value;
  }

  function updateCursor() {
    const cursor = document.querySelector('[data-sdr-active-cursor]');
    if (!cursor || !Number.isFinite(state.manualKHz)) {
      if (cursor) cursor.hidden = true;
      return;
    }

    const center = ensureViewCenter();
    const span = spanKHz();
    if (!Number.isFinite(center) || !Number.isFinite(span) || span <= 0) {
      cursor.hidden = true;
      return;
    }

    const start = center - span / 2;
    const ratio = clamp((state.manualKHz - start) / span, 0, 1);
    const left = `${(ratio * 100).toFixed(3)}%`;
    if (cursor.style.left !== left) cursor.style.left = left;
    cursor.hidden = false;
    setText(cursor.querySelector('[data-sdr-active-cursor-label]'), `${formatFrequency(state.manualKHz)} kHz`);
  }

  function renderManualReadout() {
    if (!Number.isFinite(state.manualKHz)) return;
    setText(document.querySelector('[data-sdr-frequency]'), `${formatFrequency(state.manualKHz)} kHz · ${currentMode().toUpperCase()}`);
    setText(document.querySelector('[data-sdr-station]'), 'Manual tuning');
    setText(document.querySelector('[data-sdr-tune-hint]'), `${formatFrequency(state.manualKHz)} kHz`);
    updateCursor();
  }

  function sendSndTuning() {
    if (!Number.isFinite(state.manualKHz)) return false;
    const socket = state.sndSocket;
    if (!socket || socket.readyState !== 1) return false;
    const mode = currentMode();
    const [lowCut, highCut] = PASSBANDS[mode] || PASSBANDS.am;
    try {
      socket.send(`SET mod=${mode} low_cut=${lowCut} high_cut=${highCut} freq=${state.manualKHz.toFixed(3)}`);
      return true;
    } catch {
      return false;
    }
  }

  function recenterRfIfNeeded(force = false) {
    if (!Number.isFinite(state.manualKHz)) return;
    const center = ensureViewCenter();
    const span = spanKHz();
    const edgeMargin = span * 0.06;
    const outside = !Number.isFinite(center) || Math.abs(state.manualKHz - center) >= (span / 2 - edgeMargin);
    if (!force && !outside) return;

    state.viewCenterKHz = state.manualKHz;
    updateCursor();

    // RF v2 already owns the proven W/F session. Trigger only its existing
    // reconfiguration listener instead of opening/replacing any WebSocket.
    const probe = document.createElement('select');
    probe.dataset.sdrMode = '';
    probe.dataset.sdrTuneInternal = '1';
    probe.hidden = true;
    document.body.appendChild(probe);
    probe.dispatchEvent(new Event('change', { bubbles: true }));
    probe.remove();
  }

  function commitTune({ forceRecenter = false } = {}) {
    window.clearTimeout(state.tuneTimer);
    state.tuneTimer = null;
    if (!Number.isFinite(state.manualKHz)) return;
    renderManualReadout();
    sendSndTuning();
    recenterRfIfNeeded(forceRecenter);
    state.lastTuneAt = performance.now();
  }

  function tuneTo(kHz, { immediate = false } = {}) {
    if (!Number.isFinite(Number(kHz))) return;
    ensureViewCenter();
    state.manualKHz = snapFrequency(Number(kHz));
    renderManualReadout();

    const elapsed = performance.now() - state.lastTuneAt;
    if (immediate || elapsed >= LIVE_TUNE_INTERVAL_MS) {
      commitTune();
      return;
    }

    window.clearTimeout(state.tuneTimer);
    state.tuneTimer = window.setTimeout(commitTune, Math.max(0, LIVE_TUNE_INTERVAL_MS - elapsed));
  }

  function frequencyAtX(canvas, clientX) {
    const rect = canvas.getBoundingClientRect();
    const center = ensureViewCenter();
    if (!Number.isFinite(center) || rect.width <= 0) return null;
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return center - spanKHz() / 2 + ratio * spanKHz();
  }

  function attachCanvas(canvas) {
    if (!canvas || canvas.dataset.sdrTuningV3Attached === '1') return;
    canvas.dataset.sdrTuningV3Attached = '1';
    canvas.setAttribute('title', 'Tap a carrier or drag to tune.');

    canvas.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || !spectrumIsLive()) return;
      const start = frequencyAtX(canvas, event.clientX);
      if (!Number.isFinite(start)) return;
      state.drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        lastX: event.clientX,
        moved: false
      };
      try { canvas.setPointerCapture(event.pointerId); } catch {}
    });

    canvas.addEventListener('pointermove', (event) => {
      const drag = state.drag;
      if (!drag || drag.pointerId !== event.pointerId || !spectrumIsLive()) return;
      drag.lastX = event.clientX;
      if (Math.abs(event.clientX - drag.startX) >= DRAG_THRESHOLD_PX) drag.moved = true;
      if (!drag.moved) return;
      const target = frequencyAtX(canvas, event.clientX);
      if (Number.isFinite(target)) tuneTo(target);
    });

    const finish = (event) => {
      const drag = state.drag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      state.drag = null;
      try { canvas.releasePointerCapture(event.pointerId); } catch {}
      if (event.type === 'pointercancel') return;
      const target = frequencyAtX(canvas, event.clientX);
      if (Number.isFinite(target)) tuneTo(target, { immediate: true });
    };

    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);
  }

  function installStyles() {
    if (document.getElementById('signal-scout-sdr-tuning-v3-style')) return;
    const style = document.createElement('style');
    style.id = 'signal-scout-sdr-tuning-v3-style';
    style.textContent = `
      [data-sdr-rf-v2-canvas] { touch-action:pan-y; cursor:crosshair; }
      .sdr-active-tune-cursor { position:absolute; top:0; bottom:0; width:0; z-index:7; pointer-events:none; border-left:2px solid rgba(255,255,255,.96); box-shadow:0 0 7px rgba(138,200,242,.85); transform:translateX(-1px); }
      .sdr-active-tune-cursor[hidden] { display:none !important; }
      .sdr-active-tune-pointer { position:absolute; top:12px; left:0; width:0; height:0; transform:translateX(-50%); border-left:5px solid transparent; border-right:5px solid transparent; border-top:7px solid #f4fbff; filter:drop-shadow(0 0 4px rgba(138,200,242,.9)); }
      .sdr-active-tune-label { position:absolute; top:23px; left:0; transform:translateX(-50%); padding:2px 5px; border:1px solid rgba(138,200,242,.45); border-radius:4px; color:#eef8ff; background:rgba(3,13,20,.86); font-family:var(--mono); font-size:8px; font-weight:850; white-space:nowrap; box-shadow:0 2px 9px rgba(0,0,0,.45); }
      .sdr-tune-strip { display:grid; grid-template-columns:42px 42px minmax(0,1fr) 42px 42px; gap:5px; align-items:center; margin-top:6px; }
      .sdr-tune-step { min-height:30px; border:1px solid #1b3a41; border-radius:5px; color:#a9c1c8; background:#050d10; font-family:var(--mono); font-size:9px; font-weight:850; }
      .sdr-tune-step:active { border-color:#8ac8f2; color:#e7f5ff; background:rgba(138,200,242,.09); }
      .sdr-tune-hint { overflow:hidden; text-align:center; color:#6f8b91; font-family:var(--mono); font-size:8px; font-weight:800; letter-spacing:.05em; white-space:nowrap; }
      @media (max-width:420px) {
        .sdr-tune-strip { grid-template-columns:38px 38px minmax(0,1fr) 38px 38px; gap:4px; }
        .sdr-tune-step { min-height:28px; font-size:8px; }
        .sdr-tune-hint, .sdr-active-tune-label { font-size:7px; }
      }
    `;
    document.head.appendChild(style);
  }

  function setupUi() {
    if (state.uiReady) return true;
    const wrap = document.querySelector('.sdr-spectrum-wrap');
    const canvas = wrap?.querySelector('[data-sdr-rf-v2-canvas]');
    if (!wrap || !canvas) return false;

    installStyles();
    attachCanvas(canvas);

    let cursor = wrap.querySelector('[data-sdr-active-cursor]');
    if (!cursor) {
      cursor = document.createElement('div');
      cursor.className = 'sdr-active-tune-cursor';
      cursor.dataset.sdrActiveCursor = '1';
      cursor.hidden = true;
      cursor.innerHTML = '<span class="sdr-active-tune-pointer"></span><span class="sdr-active-tune-label" data-sdr-active-cursor-label></span>';
      wrap.appendChild(cursor);
    }

    let strip = wrap.nextElementSibling?.matches?.('[data-sdr-tune-strip]') ? wrap.nextElementSibling : null;
    if (!strip) {
      strip = document.createElement('div');
      strip.className = 'sdr-tune-strip';
      strip.dataset.sdrTuneStrip = '1';
      strip.innerHTML = `
        <button type="button" class="sdr-tune-step" data-sdr-tune-step="-5" aria-label="Tune down 5 kilohertz">−5</button>
        <button type="button" class="sdr-tune-step" data-sdr-tune-step="-1" aria-label="Tune down 1 kilohertz">−1</button>
        <span class="sdr-tune-hint" data-sdr-tune-hint>DRAG / TAP TO TUNE</span>
        <button type="button" class="sdr-tune-step" data-sdr-tune-step="1" aria-label="Tune up 1 kilohertz">+1</button>
        <button type="button" class="sdr-tune-step" data-sdr-tune-step="5" aria-label="Tune up 5 kilohertz">+5</button>`;
      strip.addEventListener('click', (event) => {
        const button = event.target.closest('[data-sdr-tune-step]');
        if (!button || !spectrumIsLive()) return;
        const current = Number.isFinite(state.manualKHz) ? state.manualKHz : displayedFrequency();
        if (!Number.isFinite(current)) return;
        tuneTo(current + Number(button.dataset.sdrTuneStep || 0), { immediate: true });
      });
      wrap.insertAdjacentElement('afterend', strip);
    }

    refreshTuneButtons();
    state.uiReady = true;
    state.observer?.disconnect();
    state.observer = null;
    return true;
  }

  function resetManualTune() {
    state.manualKHz = null;
    state.viewCenterKHz = null;
    state.drag = null;
    window.clearTimeout(state.tuneTimer);
    state.tuneTimer = null;
    const cursor = document.querySelector('[data-sdr-active-cursor]');
    if (cursor) cursor.hidden = true;
    setText(document.querySelector('[data-sdr-tune-hint]'), 'DRAG / TAP TO TUNE');
  }

  function TuningWebSocket(url, protocols) {
    const socket = protocols === undefined ? new WrappedWebSocket(url) : new WrappedWebSocket(url, protocols);
    const meta = parseSocketMeta(url);
    if (meta?.stream === 'SND') {
      state.sndSocket = socket;
      socket.addEventListener('close', () => {
        if (state.sndSocket === socket) state.sndSocket = null;
      });
    }
    return socket;
  }

  TuningWebSocket.prototype = WrappedWebSocket.prototype;
  Object.defineProperties(TuningWebSocket, {
    CONNECTING: { value: WrappedWebSocket.CONNECTING },
    OPEN: { value: WrappedWebSocket.OPEN },
    CLOSING: { value: WrappedWebSocket.CLOSING },
    CLOSED: { value: WrappedWebSocket.CLOSED }
  });
  window.WebSocket = TuningWebSocket;

  document.addEventListener('click', (event) => {
    if (event.target.closest('.listen-live-button')) resetManualTune();
  }, true);

  document.addEventListener('change', (event) => {
    if (!event.target?.matches?.('[data-sdr-mode]') || event.target.dataset.sdrTuneInternal === '1') return;
    refreshTuneButtons();
    if (!Number.isFinite(state.manualKHz)) return;
    window.setTimeout(() => commitTune({ forceRecenter: true }), 0);
  });

  state.observer = new MutationObserver(() => {
    // Discovery only. setupUi() disconnects this observer permanently once the
    // RF canvas exists, so our own cursor/readout changes cannot recurse.
    setupUi();
  });
  state.observer.observe(document.documentElement, { childList: true, subtree: true });
  setupUi();
})();
