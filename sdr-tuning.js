(() => {
  // Interactive tuning layer for Signal Scout's live KiwiSDR player.
  // Loaded after the RF + health WebSocket wrappers and before sdr-player.js so
  // it can observe the player's SND socket without changing the proven RF path.
  const WrappedWebSocket = window.WebSocket;
  const PASSBANDS = {
    am: [-4900, 4900],
    sam: [-4900, 4900],
    usb: [300, 2700],
    lsb: [-2700, -300]
  };
  const MIN_KHZ = 10;
  const MAX_KHZ = 30000;
  const DRAG_THRESHOLD_PX = 8;
  const LIVE_TUNE_INTERVAL_MS = 110;

  const state = {
    sndSocket: null,
    manualKHz: null,
    sessionApplied: false,
    drag: null,
    lastTuneAt: 0,
    tuneTimer: null
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function parseSocketMeta(rawUrl) {
    try {
      const url = new URL(String(rawUrl), window.location.href);
      if (url.host !== window.location.host || url.pathname !== '/api/sdr/ws') return null;
      return {
        stream: url.searchParams.get('stream') || 'SND'
      };
    } catch {
      return null;
    }
  }

  function currentMode() {
    const value = String(document.querySelector('#sdrMode, [data-sdr-mode]')?.value || 'am').toLowerCase();
    return PASSBANDS[value] ? value : 'am';
  }

  function currentDisplayedFrequency() {
    const text = document.querySelector('[data-sdr-frequency]')?.textContent || '';
    const match = text.match(/([0-9][0-9,.]*)\s*kHz/i);
    if (!match) return null;
    const value = Number(match[1].replace(/,/g, ''));
    return Number.isFinite(value) ? value : null;
  }

  function snapFrequency(kHz) {
    const step = ['usb', 'lsb'].includes(currentMode()) ? 0.1 : 1;
    return clamp(Math.round(Number(kHz) / step) * step, MIN_KHZ, MAX_KHZ);
  }

  function formatFrequency(kHz) {
    const rounded = Math.round(kHz * 10) / 10;
    return Number.isInteger(rounded)
      ? rounded.toLocaleString()
      : rounded.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  function spectrumSpanKHz() {
    const label = document.querySelector('.sdr-spectrum-label')?.textContent || '';
    const match = label.match(/([0-9]+(?:\.[0-9]+)?)\s*kHz\s+span/i);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return ['usb', 'lsb'].includes(currentMode()) ? 14.6484375 : 29.296875;
  }

  function spectrumIsLive() {
    return /kHz\s+span/i.test(document.querySelector('.sdr-spectrum-label')?.textContent || '');
  }

  function renderManualReadout() {
    if (!Number.isFinite(state.manualKHz)) return;
    const frequencyEl = document.querySelector('[data-sdr-frequency]');
    const stationEl = document.querySelector('[data-sdr-station]');
    if (frequencyEl) frequencyEl.textContent = `${formatFrequency(state.manualKHz)} kHz · ${currentMode().toUpperCase()}`;
    if (stationEl) stationEl.textContent = 'Manual tuning';
    const hint = document.querySelector('[data-sdr-tune-hint]');
    if (hint) hint.textContent = `${formatFrequency(state.manualKHz)} kHz`;
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

  function recenterRf() {
    // RF v2 already owns all Kiwi W/F details. Trigger its existing mode-change
    // listener with a disposable matching element so only RF re-centers; the
    // player's real mode control is not touched and therefore cannot overwrite
    // the manual frequency.
    const probe = document.createElement('select');
    probe.dataset.sdrMode = '';
    probe.dataset.sdrRetuneProbe = '1';
    probe.hidden = true;
    document.body.appendChild(probe);
    probe.dispatchEvent(new Event('change', { bubbles: true }));
    probe.remove();
  }

  function performTune() {
    window.clearTimeout(state.tuneTimer);
    state.tuneTimer = null;
    if (!Number.isFinite(state.manualKHz)) return;
    renderManualReadout();
    sendSndTuning();
    recenterRf();
    state.lastTuneAt = performance.now();
  }

  function tuneTo(kHz, { immediate = false } = {}) {
    if (!Number.isFinite(Number(kHz))) return;
    state.manualKHz = snapFrequency(Number(kHz));
    renderManualReadout();

    const elapsed = performance.now() - state.lastTuneAt;
    if (immediate || elapsed >= LIVE_TUNE_INTERVAL_MS) {
      performTune();
      return;
    }

    window.clearTimeout(state.tuneTimer);
    state.tuneTimer = window.setTimeout(performTune, Math.max(0, LIVE_TUNE_INTERVAL_MS - elapsed));
  }

  function resetManualTune() {
    state.manualKHz = null;
    state.drag = null;
    state.sessionApplied = false;
    window.clearTimeout(state.tuneTimer);
    state.tuneTimer = null;
    const hint = document.querySelector('[data-sdr-tune-hint]');
    if (hint) hint.textContent = 'DRAG / TAP TO TUNE';
  }

  function frequencyAtCanvasX(canvas, clientX) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const center = Number.isFinite(state.manualKHz) ? state.manualKHz : currentDisplayedFrequency();
    if (!Number.isFinite(center)) return null;
    const span = spectrumSpanKHz();
    const ratio = clamp((clientX - rect.left) / width, 0, 1);
    return center - span / 2 + ratio * span;
  }

  function attachCanvas(canvas) {
    if (!canvas || canvas.dataset.sdrTuningAttached === '1') return;
    canvas.dataset.sdrTuningAttached = '1';
    canvas.setAttribute('title', 'Drag left/right to tune. Tap a signal to jump to it.');

    canvas.addEventListener('pointerdown', (event) => {
      if (!event.isPrimary || !spectrumIsLive()) return;
      const startFrequency = Number.isFinite(state.manualKHz) ? state.manualKHz : currentDisplayedFrequency();
      if (!Number.isFinite(startFrequency)) return;
      const rect = canvas.getBoundingClientRect();
      state.drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        lastX: event.clientX,
        width: Math.max(1, rect.width),
        startFrequency,
        span: spectrumSpanKHz(),
        moved: false
      };
      try { canvas.setPointerCapture(event.pointerId); } catch {}
    });

    canvas.addEventListener('pointermove', (event) => {
      const drag = state.drag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.lastX = event.clientX;
      const dx = event.clientX - drag.startX;
      if (Math.abs(dx) >= DRAG_THRESHOLD_PX) drag.moved = true;
      if (!drag.moved) return;
      // Dial behavior: right = higher frequency, left = lower frequency.
      tuneTo(drag.startFrequency + (dx / drag.width) * drag.span);
    });

    const finishPointer = (event) => {
      const drag = state.drag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      state.drag = null;
      try { canvas.releasePointerCapture(event.pointerId); } catch {}
      if (event.type === 'pointercancel') return;

      if (drag.moved) {
        const dx = event.clientX - drag.startX;
        tuneTo(drag.startFrequency + (dx / drag.width) * drag.span, { immediate: true });
      } else {
        const target = frequencyAtCanvasX(canvas, event.clientX);
        if (Number.isFinite(target)) tuneTo(target, { immediate: true });
      }
    };

    canvas.addEventListener('pointerup', finishPointer);
    canvas.addEventListener('pointercancel', finishPointer);
  }

  function ensureTuningUi() {
    const wrap = document.querySelector('.sdr-spectrum-wrap');
    const canvas = wrap?.querySelector('[data-sdr-rf-v2-canvas]');
    if (!wrap || !canvas) return;
    attachCanvas(canvas);

    if (!document.getElementById('signal-scout-sdr-tuning-style')) {
      const style = document.createElement('style');
      style.id = 'signal-scout-sdr-tuning-style';
      style.textContent = `
        [data-sdr-rf-v2-canvas] { touch-action:pan-y; cursor:ew-resize; }
        .sdr-tune-strip { display:grid; grid-template-columns:42px 42px minmax(0,1fr) 42px 42px; gap:5px; align-items:center; margin-top:6px; }
        .sdr-tune-step { min-height:30px; border:1px solid #1b3a41; border-radius:5px; color:#a9c1c8; background:#050d10; font-family:var(--mono); font-size:9px; font-weight:850; }
        .sdr-tune-step:active { border-color:#8ac8f2; color:#e7f5ff; background:rgba(138,200,242,.09); }
        .sdr-tune-hint { overflow:hidden; text-align:center; color:#6f8b91; font-family:var(--mono); font-size:8px; font-weight:800; letter-spacing:.05em; white-space:nowrap; }
        @media (max-width:420px) {
          .sdr-tune-strip { grid-template-columns:38px 38px minmax(0,1fr) 38px 38px; gap:4px; }
          .sdr-tune-step { min-height:28px; font-size:8px; }
          .sdr-tune-hint { font-size:7px; }
        }
      `;
      document.head.appendChild(style);
    }

    if (!wrap.nextElementSibling?.matches?.('[data-sdr-tune-strip]')) {
      const strip = document.createElement('div');
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
        const current = Number.isFinite(state.manualKHz) ? state.manualKHz : currentDisplayedFrequency();
        if (!Number.isFinite(current)) return;
        tuneTo(current + Number(button.dataset.sdrTuneStep || 0), { immediate: true });
      });
      wrap.insertAdjacentElement('afterend', strip);
    }
  }

  function TuningWebSocket(url, protocols) {
    const socket = protocols === undefined
      ? new WrappedWebSocket(url)
      : new WrappedWebSocket(url, protocols);
    const meta = parseSocketMeta(url);
    if (meta?.stream === 'SND') {
      state.sndSocket = socket;
      state.sessionApplied = false;

      socket.addEventListener('open', () => {
        if (state.sndSocket !== socket || !Number.isFinite(state.manualKHz)) return;
        // Fallback for receivers that take a while to announce sample_rate.
        window.setTimeout(() => {
          if (state.sndSocket === socket && Number.isFinite(state.manualKHz)) performTune();
        }, 900);
      });

      socket.addEventListener('message', (event) => {
        if (state.sndSocket !== socket || state.sessionApplied || !Number.isFinite(state.manualKHz)) return;
        if (!(event.data instanceof ArrayBuffer) || event.data.byteLength < 3) return;
        const bytes = new Uint8Array(event.data, 0, 3);
        const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
        if (tag !== 'MSG' && tag !== 'SND') return;
        state.sessionApplied = true;
        window.setTimeout(() => {
          if (state.sndSocket === socket && Number.isFinite(state.manualKHz)) performTune();
        }, 0);
      });

      socket.addEventListener('close', () => {
        if (state.sndSocket === socket) {
          state.sndSocket = null;
          state.sessionApplied = false;
        }
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
    const toggle = event.target.closest('[data-sdr-toggle]');
    if (toggle && Number.isFinite(state.manualKHz)) {
      window.setTimeout(renderManualReadout, 0);
    }
  }, true);

  document.addEventListener('change', (event) => {
    if (!event.target?.matches?.('[data-sdr-mode]') || event.target.dataset.sdrRetuneProbe === '1') return;
    if (!Number.isFinite(state.manualKHz)) return;
    // The player's own listener runs on the real select first and may briefly
    // restore its original station frequency. Reapply the manual dial position
    // after that event finishes, then re-center the RF waterfall.
    window.setTimeout(() => performTune(), 0);
  });

  const observer = new MutationObserver(ensureTuningUi);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  ensureTuningUi();
})();
