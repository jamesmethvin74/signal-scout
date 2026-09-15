(() => {
  'use strict';

  // Production-shell adapter only. It deliberately does not own sockets, pairing,
  // RF decoding, audio setup or waterfall rendering. Existing Zero SND tuning
  // commands pass through here so the shell can select a qualified Kiwi mode.
  const MODES = Object.freeze({
    am:   Object.freeze({ label: 'AM',   kiwi: 'am',   lowCut: -4900, highCut: 4900 }),
    sam:  Object.freeze({ label: 'SAM',  kiwi: 'sam',  lowCut: -4900, highCut: 4900 }),
    lsb:  Object.freeze({ label: 'LSB',  kiwi: 'lsb',  lowCut: -2700, highCut: -300 }),
    usb:  Object.freeze({ label: 'USB',  kiwi: 'usb',  lowCut: 300, highCut: 2700 }),
    cw:   Object.freeze({ label: 'CW',   kiwi: 'cw',   lowCut: 300, highCut: 700 }),
    nbfm: Object.freeze({ label: 'NBFM', kiwi: 'nbfm', lowCut: -6000, highCut: 6000 })
  });

  const STEP_VALUES_HZ = Object.freeze([10, 100, 1000, 5000, 10000]);
  const DEFAULT_SPAN_KHZ = 30000 / (2 ** 8);
  const MIN_KHZ = 0;
  const MAX_KHZ = 30000;

  const nativeSend = WebSocket.prototype.send;
  const socketKinds = new WeakMap();
  let sndSocket = null;
  let selectedMode = 'am';
  let baseKHz = 560;
  let fineOffsetKHz = 0;
  let stepIndex = 2;
  let knobRotation = 0;
  let pendingBand = null;
  let viewportSpanKHz = DEFAULT_SPAN_KHZ;

  const modeButtons = [...document.querySelectorAll('[data-shell-mode]')];
  const bandButtons = [...document.querySelectorAll('[data-band-khz]')];
  const frequencyBridge = document.querySelector('#frequencyValue');
  const frequencyDisplay = document.querySelector('#frequencyDisplay');
  const centerMark = document.querySelector('#centerMark');
  const canvas = document.querySelector('#rfCanvas');
  const cursor = document.querySelector('.tune-cursor');
  const power = document.querySelector('#power');
  const knob = document.querySelector('#tuningKnob');
  const stepButton = document.querySelector('#stepButton');
  const stepValue = document.querySelector('#stepValue');
  const signalValue = document.querySelector('#signalValue');
  const signalBar = document.querySelector('#signalBar');
  const dbmReadout = document.querySelector('#dbmReadout');
  const meterNeedle = document.querySelector('#meterNeedle');

  window.addEventListener('freqbeacon:zero-zoom', (event) => {
    const nextSpan = Number(event.detail?.spanKHz);
    if (Number.isFinite(nextSpan) && nextSpan > 0) viewportSpanKHz = nextSpan;
    renderFineCursor();
  });

  function clampKHz(value) {
    return Math.max(MIN_KHZ, Math.min(MAX_KHZ, value));
  }

  function modeConfig() {
    return MODES[selectedMode] || MODES.am;
  }

  function effectiveKHz() {
    return clampKHz(baseKHz + fineOffsetKHz);
  }

  function formatHz(kHz) {
    return Math.round(kHz * 1000).toLocaleString('en-US');
  }

  function formatStep(hz) {
    if (hz >= 1000) return `${hz / 1000} kHz`;
    return `${hz} Hz`;
  }

  function renderFrequency() {
    if (frequencyDisplay) frequencyDisplay.textContent = formatHz(effectiveKHz());
    renderFineCursor();
  }

  function renderMode() {
    for (const button of modeButtons) {
      const active = button.dataset.shellMode === selectedMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  function renderStep() {
    if (stepValue) stepValue.textContent = formatStep(STEP_VALUES_HZ[stepIndex]);
  }

  function rewriteTuneCommand(command, frequencyKHz) {
    const config = modeConfig();
    return String(command)
      .replace(/\bmod=[^\s]+/, `mod=${config.kiwi}`)
      .replace(/\blow_cut=-?\d+(?:\.\d+)?/, `low_cut=${config.lowCut}`)
      .replace(/\bhigh_cut=-?\d+(?:\.\d+)?/, `high_cut=${config.highCut}`)
      .replace(/\bfreq=-?\d+(?:\.\d+)?/, `freq=${clampKHz(frequencyKHz).toFixed(3)}`);
  }

  WebSocket.prototype.send = function zeroShellSend(data) {
    if (typeof data === 'string') {
      if (data.includes('SERVER DE CLIENT FREQBEACON-ZERO SND')) {
        socketKinds.set(this, 'snd');
        sndSocket = this;
      } else if (data.includes('SERVER DE CLIENT FREQBEACON-ZERO W/F')) {
        socketKinds.set(this, 'wf');
      }

      if (/^SET\s+mod=/.test(data) && /\bfreq=/.test(data) && socketKinds.get(this) === 'snd') {
        const match = data.match(/\bfreq=(-?\d+(?:\.\d+)?)/);
        if (match) {
          const parsed = Number(match[1]);
          if (Number.isFinite(parsed)) baseKHz = parsed;
        }
        renderFrequency();
        data = rewriteTuneCommand(data, effectiveKHz());

        if (pendingBand && this.readyState === WebSocket.OPEN) {
          const pending = pendingBand;
          pendingBand = null;
          window.setTimeout(() => applyBandTarget(pending.kHz, pending.mode), 850);
        }
      }
    }

    return nativeSend.call(this, data);
  };

  function socketReady() {
    return Boolean(sndSocket && sndSocket.readyState === WebSocket.OPEN);
  }

  function radioRunning() {
    return power?.getAttribute('aria-pressed') === 'true' && socketReady();
  }

  function sendEffectiveTune() {
    if (!socketReady()) return false;
    const config = modeConfig();
    nativeSend.call(
      sndSocket,
      `SET mod=${config.kiwi} low_cut=${config.lowCut} high_cut=${config.highCut} freq=${effectiveKHz().toFixed(3)}`
    );
    renderFrequency();
    return true;
  }

  function setMode(name, sendNow = true) {
    if (!MODES[name]) return;
    selectedMode = name;
    renderMode();
    if (sendNow) sendEffectiveTune();
  }

  function syncBaseFromBridge() {
    const mhz = Number(frequencyBridge?.textContent);
    if (!Number.isFinite(mhz)) return;
    baseKHz = mhz * 1000;
    renderFrequency();
  }

  function currentCenterKHz() {
    const match = String(centerMark?.textContent || '').match(/(-?\d+(?:\.\d+)?)\s*kHz/i);
    const parsed = match ? Number(match[1]) : NaN;
    return Number.isFinite(parsed) ? parsed : baseKHz;
  }

  function renderFineCursor() {
    if (!cursor || !Number.isFinite(viewportSpanKHz) || viewportSpanKHz <= 0) return;
    const center = currentCenterKHz();
    const left = center - viewportSpanKHz / 2;
    const ratio = (effectiveKHz() - left) / viewportSpanKHz;
    cursor.style.left = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  }

  function dispatchPointer(type, x, pointerId, buttons) {
    if (!canvas || typeof PointerEvent !== 'function') return false;
    const rect = canvas.getBoundingClientRect();
    const y = rect.top + Math.max(8, Math.min(rect.height - 8, rect.height * .22));
    canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: x,
      clientY: y,
      buttons
    }));
    return true;
  }

  function syntheticNeedleDelta(deltaKHz) {
    if (!radioRunning() || !canvas || !cursor || !deltaKHz) return false;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return false;

    const span = viewportSpanKHz;
    const center = currentCenterKHz();
    const left = center - span / 2;
    const rawRatio = (baseKHz - left) / span;
    const ratio = Math.max(.002, Math.min(.998, rawRatio));
    const startX = rect.left + ratio * rect.width;
    const endX = startX + (deltaKHz / span) * rect.width;
    const pointerId = 9101;

    const before = baseKHz;
    dispatchPointer('pointerdown', startX, pointerId, 1);
    dispatchPointer('pointermove', endX, pointerId, 1);
    dispatchPointer('pointerup', endX, pointerId, 0);
    syncBaseFromBridge();
    return Math.abs(baseKHz - before) > .0001;
  }

  function syntheticPanTo(targetKHz) {
    if (!radioRunning() || !canvas) return false;
    const target = clampKHz(targetKHz);
    const delta = target - baseKHz;
    if (Math.abs(delta) < .001) return true;

    if (Math.abs(delta) < 2.25) return syntheticNeedleDelta(delta);

    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return false;
    const span = viewportSpanKHz;
    const cursorX = rect.left + (parseFloat(getComputedStyle(cursor).left) || rect.width / 2);
    let startX = rect.left + Math.min(24, rect.width * .06);
    if (Math.abs(startX - cursorX) <= 36) startX = rect.right - Math.min(24, rect.width * .06);
    const endX = startX - (delta / span) * rect.width;
    const pointerId = 9102;

    dispatchPointer('pointerdown', startX, pointerId, 1);
    dispatchPointer('pointermove', endX, pointerId, 1);
    dispatchPointer('pointerup', endX, pointerId, 0);
    syncBaseFromBridge();
    return Math.abs(baseKHz - target) < 1.2;
  }

  function normalizeFineOffset() {
    if (Math.abs(fineOffsetKHz) < 1) return;
    const whole = fineOffsetKHz > 0 ? Math.floor(fineOffsetKHz) : Math.ceil(fineOffsetKHz);
    fineOffsetKHz -= whole;
    const before = baseKHz;
    if (!syntheticNeedleDelta(whole)) {
      fineOffsetKHz += whole;
      baseKHz = before;
    }
  }

  function nudgeByHz(deltaHz) {
    if (!radioRunning() || !Number.isFinite(deltaHz) || !deltaHz) return;
    fineOffsetKHz += deltaHz / 1000;
    normalizeFineOffset();
    sendEffectiveTune();
  }

  function applyBandTarget(kHz, mode) {
    if (!Number.isFinite(kHz)) return;
    fineOffsetKHz = 0;
    if (MODES[mode]) setMode(mode, false);
    renderFrequency();

    if (!radioRunning()) {
      pendingBand = { kHz, mode: selectedMode };
      return;
    }

    if (!syntheticPanTo(kHz)) {
      // If a tiny move could not be expressed by the direct manipulation layer,
      // keep the qualified dial state authoritative rather than forcing a socket-only jump.
      renderFrequency();
    }
    sendEffectiveTune();
  }

  for (const button of modeButtons) {
    button.addEventListener('click', () => setMode(button.dataset.shellMode));
  }

  for (const button of bandButtons) {
    button.addEventListener('click', () => {
      for (const peer of bandButtons) peer.classList.toggle('active', peer === button);
      const kHz = Number(button.dataset.bandKhz);
      const mode = button.dataset.bandMode || selectedMode;
      applyBandTarget(kHz, mode);
    });
  }

  for (const button of document.querySelectorAll('[data-fine]')) {
    button.addEventListener('click', () => {
      const direction = Number(button.dataset.fine);
      nudgeByHz(direction * STEP_VALUES_HZ[stepIndex]);
    });
  }

  stepButton?.addEventListener('click', () => {
    stepIndex = (stepIndex + 1) % STEP_VALUES_HZ.length;
    renderStep();
  });

  canvas?.addEventListener('pointerdown', (event) => {
    if (!event.isTrusted || Math.abs(fineOffsetKHz) < .000001) return;
    fineOffsetKHz = 0;
    renderFrequency();
  }, { capture: true });

  if (frequencyBridge) {
    new MutationObserver(syncBaseFromBridge).observe(frequencyBridge, { childList: true, characterData: true, subtree: true });
  }

  function updateSignalShell() {
    const match = String(signalValue?.textContent || '').match(/-?\d+(?:\.\d+)?/);
    const rssi = match ? Number(match[0]) : NaN;
    if (!Number.isFinite(rssi)) {
      if (dbmReadout) dbmReadout.textContent = '— dBm';
      if (meterNeedle) meterNeedle.style.setProperty('--meter-angle', '-48deg');
      return;
    }

    if (dbmReadout) dbmReadout.textContent = `${Math.round(rssi)} dBm`;
    let pct = Math.max(0, Math.min(1, (rssi + 125) / 75));
    const barPct = Number.parseFloat(signalBar?.style.width || '');
    if (Number.isFinite(barPct)) pct = Math.max(0, Math.min(1, barPct / 100));
    const angle = -48 + pct * 96;
    if (meterNeedle) meterNeedle.style.setProperty('--meter-angle', `${angle.toFixed(1)}deg`);
  }

  if (signalValue) {
    new MutationObserver(updateSignalShell).observe(signalValue, { childList: true, characterData: true, subtree: true });
  }
  if (signalBar) {
    new MutationObserver(updateSignalShell).observe(signalBar, { attributes: true, attributeFilter: ['style'] });
  }

  let knobPointerId = null;
  let lastAngle = null;
  let angleCarry = 0;

  function pointerPolar(event) {
    const rect = knob.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    return {
      angle: Math.atan2(dy, dx) * 180 / Math.PI,
      radius: Math.hypot(dx, dy),
      deadRadius: Math.min(rect.width, rect.height) * .20
    };
  }

  function normalizedAngleDelta(next, previous) {
    let delta = next - previous;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    return delta;
  }

  function paintKnob() {
    knob?.style.setProperty('--knob-rotation', `${knobRotation.toFixed(1)}deg`);
  }

  knob?.addEventListener('pointerdown', (event) => {
    if (!radioRunning()) return;
    event.preventDefault();
    knobPointerId = event.pointerId;
    const point = pointerPolar(event);
    lastAngle = point.radius <= point.deadRadius ? null : point.angle;
    angleCarry = 0;
    try { knob.setPointerCapture(event.pointerId); } catch {}
  });

  knob?.addEventListener('pointermove', (event) => {
    if (knobPointerId !== event.pointerId) return;
    event.preventDefault();
    const point = pointerPolar(event);

    // The polar angle is undefined near the center of the virtual knob. If a
    // finger crosses that area, pause tuning and re-anchor on exit instead of
    // converting a tiny center-crossing motion into a large frequency jump.
    if (point.radius <= point.deadRadius) {
      lastAngle = null;
      angleCarry = 0;
      return;
    }
    if (lastAngle === null) {
      lastAngle = point.angle;
      return;
    }

    const delta = normalizedAngleDelta(point.angle, lastAngle);
    lastAngle = point.angle;
    knobRotation += delta;
    angleCarry += delta;
    paintKnob();

    const detents = angleCarry > 0 ? Math.floor(angleCarry / 10) : Math.ceil(angleCarry / 10);
    if (detents) {
      angleCarry -= detents * 10;
      nudgeByHz(detents * STEP_VALUES_HZ[stepIndex]);
    }
  });

  function endKnob(event) {
    if (knobPointerId !== event.pointerId) return;
    event.preventDefault();
    try { knob.releasePointerCapture(event.pointerId); } catch {}
    knobPointerId = null;
    lastAngle = null;
    angleCarry = 0;
  }

  knob?.addEventListener('pointerup', endKnob);
  knob?.addEventListener('pointercancel', endKnob);
  knob?.addEventListener('wheel', (event) => {
    if (!radioRunning()) return;
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    knobRotation += direction * 10;
    paintKnob();
    nudgeByHz(direction * STEP_VALUES_HZ[stepIndex]);
  }, { passive: false });

  power?.addEventListener('click', () => {
    window.setTimeout(() => {
      if (!power || power.getAttribute('aria-pressed') !== 'true') return;
      renderFrequency();
    }, 0);
  });

  syncBaseFromBridge();
  renderMode();
  renderStep();
  updateSignalShell();
  paintKnob();
})();