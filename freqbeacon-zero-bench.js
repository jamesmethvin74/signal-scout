// FREQBEACON Zero qualification bench.
// Separate from /zero: one fixed KU4BY session, wide-range retunes and mode changes only.

const FIXED = Object.freeze({
  initialFrequencyKHz: 560,
  initialMode: 'am',
  zoom: 8,
  fullBandwidthKHz: 30000,
  waterfallBins: 1024,
  waterfallRowPx: 2,
  waterfallSpeed: -1,
  spectrumRadius: 3,
  spectrumAttack: 0.48,
  spectrumRelease: 0.16,
  audioProofFrames: 5,
  noFrameTimeoutMs: 7000,
  keepaliveMs: 15000
});

// Defaults match the current Kiwi client reference implementation.
const MODES = Object.freeze({
  am:   Object.freeze({ label: 'AM',   kiwi: 'am',   lowCut: -4900, highCut: 4900, stepKHz: 1 }),
  sam:  Object.freeze({ label: 'SAM',  kiwi: 'sam',  lowCut: -4900, highCut: 4900, stepKHz: 1 }),
  lsb:  Object.freeze({ label: 'LSB',  kiwi: 'lsb',  lowCut: -2700, highCut: -300, stepKHz: 0.1 }),
  usb:  Object.freeze({ label: 'USB',  kiwi: 'usb',  lowCut: 300, highCut: 2700, stepKHz: 0.1 }),
  cw:   Object.freeze({ label: 'CW',   kiwi: 'cw',   lowCut: 300, highCut: 700, stepKHz: 0.05 }),
  nbfm: Object.freeze({ label: 'NBFM', kiwi: 'nbfm', lowCut: -6000, highCut: 6000, stepKHz: 1 })
});

const PRESETS = Object.freeze({
  lw:   Object.freeze({ label: 'LW · WWVB', kHz: 60, mode: 'am' }),
  mw:   Object.freeze({ label: 'MW · LOCAL AM', kHz: 560, mode: 'am' }),
  sw:   Object.freeze({ label: 'SW · BROADCAST', kHz: 9955, mode: 'am' }),
  '80m': Object.freeze({ label: '80m · HAM VOICE', kHz: 3900, mode: 'lsb' }),
  '40m': Object.freeze({ label: '40m · HAM VOICE', kHz: 7200, mode: 'lsb' }),
  '20m': Object.freeze({ label: '20m · HAM VOICE', kHz: 14200, mode: 'usb' }),
  air:  Object.freeze({ label: 'HF AIR · HFGCS', kHz: 11175, mode: 'usb' }),
  cb:   Object.freeze({ label: 'CB 19', kHz: 27185, mode: 'am' }),
  '10fm': Object.freeze({ label: '10m · FM CALLING', kHz: 29600, mode: 'nbfm' })
});

const els = {
  power: document.querySelector('#power'),
  mute: document.querySelector('#mute'),
  canvas: document.querySelector('#rfCanvas'),
  cursor: document.querySelector('.tune-cursor'),
  message: document.querySelector('#scopeMessage'),
  sndLamp: document.querySelector('#sndLamp'),
  wfLamp: document.querySelector('#wfLamp'),
  sessionLabel: document.querySelector('#sessionLabel'),
  receiverIdentity: document.querySelector('#receiverIdentity'),
  kiwiVersion: document.querySelector('#kiwiVersion'),
  frequencyValue: document.querySelector('#frequencyValue'),
  modeValue: document.querySelector('#modeValue'),
  filterReadout: document.querySelector('#filterReadout'),
  modeButtons: [...document.querySelectorAll('[data-mode]')],
  presetButtons: [...document.querySelectorAll('[data-preset]')],
  pairProof: document.querySelector('#pairProof'),
  retuneCount: document.querySelector('#retuneCount'),
  modeCount: document.querySelector('#modeCount'),
  socketProof: document.querySelector('#socketProof'),
  lastAction: document.querySelector('#lastAction'),
  signalValue: document.querySelector('#signalValue'),
  signalBar: document.querySelector('#signalBar'),
  sndFrames: document.querySelector('#sndFrames'),
  wfFrames: document.querySelector('#wfFrames'),
  uptime: document.querySelector('#uptime'),
  leftEdge: document.querySelector('#leftEdge'),
  centerMark: document.querySelector('#centerMark'),
  rightEdge: document.querySelector('#rightEdge')
};

if (!els.canvas || !els.power) throw new Error('FREQBEACON Zero bench could not attach');

const state = {
  generation: 0,
  stopping: false,
  starting: false,
  sessionTs: null,
  snd: null,
  wf: null,
  sndFrames: 0,
  wfFrames: 0,
  sndConfigured: false,
  wfConfigured: false,
  audioProven: false,
  rfProven: false,
  audioContext: null,
  gain: null,
  audioSampleRate: 12000,
  nextAudioAt: 0,
  keepaliveTimers: new Set(),
  watchdogTimers: new Set(),
  uptimeTimer: null,
  startedAt: 0,
  muted: false,
  rfFloor: -112,
  rfCeiling: -62,
  rfRangeReady: false,
  tunedKHz: FIXED.initialFrequencyKHz,
  viewportCenterKHz: FIXED.initialFrequencyKHz,
  mode: FIXED.initialMode,
  spectrumDb: null,
  spectrumScratch: null,
  pointerId: null,
  lastTuneAt: 0,
  retunes: 0,
  modeSwitches: 0,
  sndOpenCount: 0,
  wfOpenCount: 0,
  activePreset: 'mw'
};

const ctx = els.canvas.getContext('2d', { alpha: false });

function modeConfig(name = state.mode) {
  return MODES[name] || MODES.am;
}

function formatMHz(kHz) {
  return `${(kHz / 1000).toFixed(3)} MHz`;
}

function formatFrequencyReadout(kHz) {
  const step = modeConfig().stepKHz;
  return (kHz / 1000).toFixed(step < 1 ? 4 : 3);
}

function formatCut(hz) {
  const kHz = hz / 1000;
  const sign = kHz > 0 ? '+' : '';
  return `${sign}${Number.isInteger(kHz) ? kHz.toFixed(0) : kHz.toFixed(1)}`;
}

function formatStep(kHz) {
  if (kHz >= 1) return `${kHz.toFixed(0)} kHz`;
  return `${Math.round(kHz * 1000)} Hz`;
}

function visibleSpanKHz() {
  return FIXED.fullBandwidthKHz / (2 ** FIXED.zoom);
}

function clampCenter(kHz) {
  const half = visibleSpanKHz() / 2;
  return Math.max(half, Math.min(FIXED.fullBandwidthKHz - half, kHz));
}

function viewportEdges() {
  const half = visibleSpanKHz() / 2;
  return {
    left: state.viewportCenterKHz - half,
    right: state.viewportCenterKHz + half
  };
}

function updateModeUi() {
  const config = modeConfig();
  els.modeValue.textContent = config.label;
  els.filterReadout.textContent = `${config.label} · ${formatCut(config.lowCut)} / ${formatCut(config.highCut)} kHz · STEP ${formatStep(config.stepKHz)}`;
  for (const button of els.modeButtons) {
    const active = button.dataset.mode === state.mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function updatePresetUi() {
  for (const button of els.presetButtons) {
    button.classList.toggle('active', button.dataset.preset === state.activePreset);
  }
}

function updateTuningUi() {
  const { left, right } = viewportEdges();
  els.leftEdge.textContent = formatMHz(left);
  els.rightEdge.textContent = formatMHz(right);
  els.centerMark.textContent = `VIEW ${state.viewportCenterKHz.toFixed(3)} kHz`;
  els.frequencyValue.textContent = formatFrequencyReadout(state.tunedKHz);
  els.frequencyValue.parentElement?.setAttribute('aria-label', `${state.tunedKHz.toFixed(3)} kilohertz`);

  const pct = ((state.tunedKHz - left) / (right - left)) * 100;
  els.cursor.style.left = `${Math.max(0, Math.min(100, pct))}%`;
  updateModeUi();
  updatePresetUi();
}

function pairStable() {
  return Boolean(
    state.sessionTs &&
    state.audioProven &&
    state.rfProven &&
    state.sndOpenCount === 1 &&
    state.wfOpenCount === 1
  );
}

function updateProofUi() {
  els.retuneCount.textContent = String(state.retunes);
  els.modeCount.textContent = String(state.modeSwitches);
  els.socketProof.textContent = `${state.sndOpenCount} SND · ${state.wfOpenCount} W/F`;
  const pair = state.sessionTs ? state.sessionTs.slice(-6) : '—';
  els.pairProof.textContent = pairStable() ? `${pair} · STABLE` : pair;
  els.pairProof.classList.toggle('live', pairStable());
  els.socketProof.classList.toggle('live', pairStable());
}

function setBenchEnabled(enabled) {
  for (const button of [...els.modeButtons, ...els.presetButtons]) button.disabled = !enabled;
}

function setLamp(el, live) {
  el.classList.toggle('live', Boolean(live));
}

function setMessage(title, detail, error = false) {
  els.message.classList.remove('hidden');
  els.message.classList.toggle('error', error);
  els.message.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>`;
}

function hideMessage() {
  els.message.classList.add('hidden');
  els.message.classList.remove('error');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function clearWaterfallHistory() {
  const wfTop = 218;
  ctx.fillStyle = '#04101c';
  ctx.fillRect(0, wfTop, els.canvas.width, els.canvas.height - wfTop);
}

function drawIdleScope() {
  const w = els.canvas.width;
  const h = els.canvas.height;
  const spectrumH = 176;
  const scaleTop = 176;
  const scaleH = 42;
  const wfTop = scaleTop + scaleH;

  ctx.fillStyle = '#06121a';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(103, 174, 190, .14)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x + .5, 0);
    ctx.lineTo(x + .5, h);
    ctx.stroke();
  }
  for (let y = 36; y < spectrumH; y += 35) {
    ctx.beginPath();
    ctx.moveTo(0, y + .5);
    ctx.lineTo(w, y + .5);
    ctx.stroke();
  }
  ctx.fillStyle = '#060a0c';
  ctx.fillRect(0, scaleTop, w, scaleH);
  ctx.fillStyle = '#04101c';
  ctx.fillRect(0, wfTop, w, h - wfTop);
  drawFrequencyScale(scaleTop, scaleH);
}

function drawFrequencyScale(top, height) {
  const w = els.canvas.width;
  const span = visibleSpanKHz();
  const { left } = viewportEdges();

  ctx.fillStyle = '#060a0c';
  ctx.fillRect(0, top, w, height);
  ctx.strokeStyle = 'rgba(114, 144, 154, .42)';
  ctx.fillStyle = 'rgba(177, 198, 204, .78)';
  ctx.font = '16px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'top';

  for (let i = 0; i <= 8; i += 1) {
    const x = (i / 8) * w;
    const frequency = left + (i / 8) * span;
    const major = i % 2 === 0;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + .5, top);
    ctx.lineTo(Math.round(x) + .5, top + (major ? 13 : 8));
    ctx.stroke();
    if (major) {
      ctx.textAlign = i === 0 ? 'left' : i === 8 ? 'right' : 'center';
      ctx.fillText((frequency / 1000).toFixed(4), Math.max(2, Math.min(w - 2, x)), top + 17);
    }
  }
}

function updateRfRange(bins) {
  const values = Array.from(bins, (value) => value - 255).sort((a, b) => a - b);
  const noiseSample = values[Math.floor(values.length * .50)] ?? -105;
  const peakSample = values[Math.floor(values.length * .997)] ?? -65;
  const targetFloor = Math.max(-150, Math.min(-78, noiseSample - 13));
  const targetCeiling = Math.max(targetFloor + 48, Math.min(-20, peakSample + 7));

  if (!state.rfRangeReady) {
    state.rfFloor = targetFloor;
    state.rfCeiling = targetCeiling;
    state.rfRangeReady = true;
    return;
  }

  state.rfFloor += (targetFloor - state.rfFloor) * .035;
  state.rfCeiling += (targetCeiling - state.rfCeiling) * .065;
  if (state.rfCeiling - state.rfFloor < 48) state.rfCeiling = state.rfFloor + 48;
}

const WATERFALL_STOPS = Object.freeze([
  [0.00, [2, 8, 24]],
  [0.12, [5, 28, 86]],
  [0.28, [7, 103, 166]],
  [0.43, [18, 185, 212]],
  [0.58, [24, 208, 178]],
  [0.70, [84, 216, 124]],
  [0.82, [216, 219, 56]],
  [0.92, [233, 143, 38]],
  [1.00, [255, 58, 34]]
]);

function colorForDb(db) {
  const range = Math.max(48, state.rfCeiling - state.rfFloor);
  const n = Math.max(0, Math.min(1, (db - state.rfFloor) / range));
  for (let i = 1; i < WATERFALL_STOPS.length; i += 1) {
    const [at, color] = WATERFALL_STOPS[i];
    const [prevAt, prev] = WATERFALL_STOPS[i - 1];
    if (n <= at) {
      const t = (n - prevAt) / Math.max(.0001, at - prevAt);
      return [
        Math.round(prev[0] + (color[0] - prev[0]) * t),
        Math.round(prev[1] + (color[1] - prev[1]) * t),
        Math.round(prev[2] + (color[2] - prev[2]) * t)
      ];
    }
  }
  return WATERFALL_STOPS[WATERFALL_STOPS.length - 1][1];
}

function smoothSpectrum(bins) {
  if (!state.spectrumDb || state.spectrumDb.length !== bins.length) {
    state.spectrumDb = new Float32Array(bins.length);
    state.spectrumScratch = new Float32Array(bins.length);
    for (let i = 0; i < bins.length; i += 1) state.spectrumDb[i] = bins[i] - 255;
  }

  const radius = FIXED.spectrumRadius;
  for (let i = 0; i < bins.length; i += 1) {
    let weighted = 0;
    let weightTotal = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(bins.length - 1, i + radius); j += 1) {
      const weight = radius + 1 - Math.abs(i - j);
      weighted += (bins[j] - 255) * weight;
      weightTotal += weight;
    }
    state.spectrumScratch[i] = weighted / weightTotal;
  }

  for (let i = 0; i < bins.length; i += 1) {
    const delta = state.spectrumScratch[i] - state.spectrumDb[i];
    const alpha = delta >= 0 ? FIXED.spectrumAttack : FIXED.spectrumRelease;
    state.spectrumDb[i] += delta * alpha;
  }
  return state.spectrumDb;
}

function shapeSpectrumLevel(n) {
  const knee = 0.68;
  if (n >= knee) return n;
  return knee * Math.pow(n / knee, 1.65);
}

function renderRf(bins) {
  const w = els.canvas.width;
  const h = els.canvas.height;
  const spectrumH = 176;
  const scaleTop = 176;
  const scaleH = 42;
  const wfTop = scaleTop + scaleH;
  const wfH = h - wfTop;
  const rowPx = FIXED.waterfallRowPx;

  updateRfRange(bins);
  const spectrum = smoothSpectrum(bins);

  if (state.wfFrames > 1) {
    ctx.drawImage(els.canvas, 0, wfTop, w, wfH - rowPx, 0, wfTop + rowPx, w, wfH - rowPx);
  } else {
    ctx.fillStyle = '#04101c';
    ctx.fillRect(0, wfTop, w, wfH);
  }

  const row = ctx.createImageData(w, rowPx);
  for (let x = 0; x < w; x += 1) {
    const db = bins[x] - 255;
    const [r, g, b] = colorForDb(db);
    for (let y = 0; y < rowPx; y += 1) {
      const p = (y * w + x) * 4;
      row.data[p] = r;
      row.data[p + 1] = g;
      row.data[p + 2] = b;
      row.data[p + 3] = 255;
    }
  }
  ctx.putImageData(row, 0, wfTop);

  ctx.fillStyle = '#071a24';
  ctx.fillRect(0, 0, w, spectrumH);
  ctx.strokeStyle = 'rgba(121, 192, 207, .13)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += 128) {
    ctx.beginPath();
    ctx.moveTo(x + .5, 0);
    ctx.lineTo(x + .5, spectrumH);
    ctx.stroke();
  }
  for (let y = 35; y < spectrumH; y += 35) {
    ctx.beginPath();
    ctx.moveTo(0, y + .5);
    ctx.lineTo(w, y + .5);
    ctx.stroke();
  }

  const range = Math.max(48, state.rfCeiling - state.rfFloor);
  const points = new Float32Array(w);
  for (let x = 0; x < w; x += 1) {
    const db = spectrum[x];
    const n = Math.max(0, Math.min(1, (db - state.rfFloor) / range));
    const shaped = shapeSpectrumLevel(n);
    points[x] = spectrumH - 10 - shaped * (spectrumH - 24);
  }

  const fill = ctx.createLinearGradient(0, 16, 0, spectrumH);
  fill.addColorStop(0, 'rgba(60, 219, 232, .20)');
  fill.addColorStop(1, 'rgba(9, 73, 94, .03)');
  ctx.beginPath();
  ctx.moveTo(0, spectrumH);
  for (let x = 0; x < w; x += 1) ctx.lineTo(x, points[x]);
  ctx.lineTo(w, spectrumH);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.beginPath();
  for (let x = 0; x < w; x += 1) {
    if (x === 0) ctx.moveTo(x, points[x]);
    else ctx.lineTo(x, points[x]);
  }
  ctx.strokeStyle = 'rgba(55, 221, 235, .24)';
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.beginPath();
  for (let x = 0; x < w; x += 1) {
    if (x === 0) ctx.moveTo(x, points[x]);
    else ctx.lineTo(x, points[x]);
  }
  ctx.strokeStyle = '#dffcff';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  drawFrequencyScale(scaleTop, scaleH);
}

function clearTimers() {
  for (const id of state.keepaliveTimers) window.clearInterval(id);
  for (const id of state.watchdogTimers) window.clearTimeout(id);
  state.keepaliveTimers.clear();
  state.watchdogTimers.clear();
  if (state.uptimeTimer) window.clearInterval(state.uptimeTimer);
  state.uptimeTimer = null;
}

function watchdog(callback, ms = FIXED.noFrameTimeoutMs) {
  const id = window.setTimeout(() => {
    state.watchdogTimers.delete(id);
    callback();
  }, ms);
  state.watchdogTimers.add(id);
  return id;
}

function cancelWatchdog(id) {
  if (!id) return;
  window.clearTimeout(id);
  state.watchdogTimers.delete(id);
}

function send(socket, command) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(command);
}

function addKeepalive(socket) {
  const id = window.setInterval(() => send(socket, 'SET keepalive'), FIXED.keepaliveMs);
  state.keepaliveTimers.add(id);
}

async function ensureAudioContext() {
  if (state.audioContext && state.audioContext.state !== 'closed') {
    if (state.audioContext.state === 'suspended') await state.audioContext.resume();
    return;
  }
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) throw new Error('WEB AUDIO NOT SUPPORTED');
  state.audioContext = new AudioContextCtor({ latencyHint: 'interactive' });
  state.gain = state.audioContext.createGain();
  state.gain.gain.value = state.muted ? 0 : .82;
  state.gain.connect(state.audioContext.destination);
  state.nextAudioAt = state.audioContext.currentTime + .08;
  if (state.audioContext.state === 'suspended') await state.audioContext.resume();
}

function schedulePcm(bytes, flags) {
  if (!state.audioContext || !state.gain || bytes.byteLength < 2) return;
  const littleEndian = (flags & 0x80) !== 0;
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const samples = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  for (let i = 0; i < sampleCount; i += 1) samples[i] = view.getInt16(i * 2, littleEndian) / 32768;

  const buffer = state.audioContext.createBuffer(1, sampleCount, state.audioSampleRate);
  buffer.copyToChannel(samples, 0);
  const source = state.audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(state.gain);
  const now = state.audioContext.currentTime;
  if (state.nextAudioAt < now + .025 || state.nextAudioAt > now + .60) state.nextAudioAt = now + .06;
  source.start(state.nextAudioAt);
  state.nextAudioAt += sampleCount / state.audioSampleRate;
}

function bytesFromEvent(data) {
  if (data instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(data));
  if (data instanceof Blob) return data.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  if (typeof data === 'string') return Promise.resolve(new TextEncoder().encode(data));
  return Promise.resolve(null);
}

function tagOf(bytes) {
  if (!bytes || bytes.length < 3) return '';
  return String.fromCharCode(bytes[0], bytes[1], bytes[2]);
}

function messageText(bytes) {
  return new TextDecoder().decode(bytes.subarray(4));
}

function badPasswordCode(text) {
  const match = text.match(/(?:^|\s)badp=(\d+)/);
  return match ? Number(match[1]) : null;
}

function handleCommonMessage(text, streamName) {
  const badp = badPasswordCode(text);
  if (badp !== null && badp !== 0) {
    fatalStop('AUTH FAILED', `${streamName} authentication rejected (code ${badp}).`);
    return false;
  }
  if (/(?:^|\s)too_busy=1(?:\s|$)/.test(text)) {
    fatalStop('RECEIVER BUSY', `${streamName} has no free channel.`);
    return false;
  }
  if (/(?:^|\s)down=1(?:\s|$)/.test(text)) {
    fatalStop('RECEIVER DOWN', 'The selected Kiwi reports that it is offline.');
    return false;
  }
  return true;
}

function sendTune() {
  if (!state.snd || state.snd.readyState !== WebSocket.OPEN) return;
  const config = modeConfig();
  send(state.snd, `SET mod=${config.kiwi} low_cut=${config.lowCut} high_cut=${config.highCut} freq=${state.tunedKHz.toFixed(3)}`);
}

function sendCenter() {
  if (!state.wf || state.wf.readyState !== WebSocket.OPEN) return;
  send(state.wf, `SET zoom=${FIXED.zoom} cf=${state.viewportCenterKHz.toFixed(3)}`);
}

function configureSnd() {
  if (state.sndConfigured || !state.snd) return;
  state.sndConfigured = true;
  send(state.snd, 'SERVER DE CLIENT FREQBEACON-ZERO SND');
  send(state.snd, 'SET ident_user=FREQBEACON ZERO BENCH');
  send(state.snd, `SET AR OK in=${Math.round(state.audioSampleRate)} out=${Math.round(state.audioContext.sampleRate)}`);
  sendTune();
  send(state.snd, 'SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50');
  send(state.snd, 'SET compression=0');
  send(state.snd, 'SET squelch=0 max=0');
}

function configureWf() {
  if (state.wfConfigured || !state.wf) return;
  state.wfConfigured = true;
  send(state.wf, 'SERVER DE CLIENT FREQBEACON-ZERO W/F');
  send(state.wf, 'SET ident_user=FREQBEACON ZERO BENCH');
  send(state.wf, 'SET send_dB=1');
  sendCenter();
  send(state.wf, 'SET maxdb=-35 mindb=-125');
  send(state.wf, 'SET wf_comp=0');
  send(state.wf, 'SET interp=13');
  send(state.wf, 'SET window_func=2');
  send(state.wf, `SET wf_speed=${FIXED.waterfallSpeed}`);
}

function socketUrl(stream) {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/api/zero/ws?stream=${encodeURIComponent(stream)}&ts=${encodeURIComponent(state.sessionTs)}`;
}

function setSignal(rssi) {
  if (!Number.isFinite(rssi)) return;
  els.signalValue.textContent = `${rssi.toFixed(0)} dB`;
  const pct = Math.max(0, Math.min(100, ((rssi + 125) / 75) * 100));
  els.signalBar.style.width = `${pct}%`;
}

function openSnd(generation) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl('SND'));
    socket.binaryType = 'arraybuffer';
    state.snd = socket;
    let frameWatchdog = null;
    let settled = false;

    socket.onopen = () => {
      if (generation !== state.generation) return;
      state.sndOpenCount += 1;
      updateProofUi();
      send(socket, 'SET auth t=kiwi p=');
      addKeepalive(socket);
      setMessage('SND CONNECTED', 'Authenticating and waiting for real audio frames.');
      frameWatchdog = watchdog(() => fatalStop('NO AUDIO FRAMES', 'SND opened but no uncompressed receiver audio arrived.'));
    };

    socket.onmessage = async (event) => {
      if (generation !== state.generation) return;
      const bytes = await bytesFromEvent(event.data);
      const tag = tagOf(bytes);

      if (tag === 'MSG') {
        const text = messageText(bytes);
        if (!handleCommonMessage(text, 'SND')) return;
        const rateMatch = text.match(/(?:^|\s)sample_rate=([0-9.]+)/);
        if (rateMatch) {
          const rate = Number(rateMatch[1]);
          if (Number.isFinite(rate) && rate > 1000 && rate < 100000) {
            state.audioSampleRate = rate;
            configureSnd();
          }
        }
        return;
      }

      if (tag !== 'SND' || bytes.length < 12) return;
      const flags = bytes[3];
      if ((flags & 0x10) !== 0) {
        send(socket, 'SET compression=0');
        return;
      }
      const stereo = (flags & 0x08) !== 0;
      const payloadOffset = stereo ? 20 : 10;
      if (bytes.length <= payloadOffset + 1) return;

      const smeter = (bytes[8] << 8) | bytes[9];
      setSignal(smeter * .1 - 127);
      schedulePcm(bytes.subarray(payloadOffset), flags);
      state.sndFrames += 1;
      els.sndFrames.textContent = String(state.sndFrames);

      if (!state.audioProven) {
        state.audioProven = true;
        cancelWatchdog(frameWatchdog);
        frameWatchdog = null;
        setLamp(els.sndLamp, true);
      }

      if (state.sndFrames >= FIXED.audioProofFrames && !state.wf) openWf(generation);
      if (!settled && state.sndFrames >= FIXED.audioProofFrames) {
        settled = true;
        resolve();
      }
    };

    socket.onerror = () => {
      if (generation !== state.generation || state.stopping) return;
      if (!settled) reject(new Error('SND ERROR'));
      fatalStop('SND ERROR', 'The receiver audio socket failed.');
    };

    socket.onclose = (event) => {
      cancelWatchdog(frameWatchdog);
      if (generation !== state.generation || state.stopping) return;
      const suffix = event.reason ? ` · ${event.reason}` : ` · code ${event.code}`;
      if (!settled) reject(new Error(`SND CLOSED${suffix}`));
      fatalStop('SND CLOSED', `The selected receiver ended the audio session${suffix}.`);
    };
  });
}

function openWf(generation) {
  if (state.wf || generation !== state.generation || state.stopping) return;
  setMessage('AUDIO LIVE', 'Opening the paired real RF waterfall on the same Kiwi session.');
  const socket = new WebSocket(socketUrl('W/F'));
  socket.binaryType = 'arraybuffer';
  state.wf = socket;
  let frameWatchdog = null;

  socket.onopen = () => {
    if (generation !== state.generation) return;
    state.wfOpenCount += 1;
    updateProofUi();
    send(socket, 'SET auth t=kiwi p=');
    configureWf();
    addKeepalive(socket);
    frameWatchdog = watchdog(() => fatalStop('NO W/F FRAMES', 'W/F opened but no real 1024-bin RF frames arrived.'));
  };

  socket.onmessage = async (event) => {
    if (generation !== state.generation) return;
    const bytes = await bytesFromEvent(event.data);
    const tag = tagOf(bytes);
    if (tag === 'MSG') {
      handleCommonMessage(messageText(bytes), 'W/F');
      return;
    }
    if (tag !== 'W/F' || bytes.length < 16 + FIXED.waterfallBins) return;

    const bins = bytes.subarray(16, 16 + FIXED.waterfallBins);
    state.wfFrames += 1;
    els.wfFrames.textContent = String(state.wfFrames);
    renderRf(bins);

    if (!state.rfProven) {
      state.rfProven = true;
      cancelWatchdog(frameWatchdog);
      frameWatchdog = null;
      setLamp(els.wfLamp, true);
      hideMessage();
      setBenchEnabled(true);
      updateProofUi();
      els.lastAction.textContent = `LIVE · Pair ${state.sessionTs.slice(-6)} established once. Choose any preset; SND/W/F must remain open.`;
    }
  };

  socket.onerror = () => {
    if (generation !== state.generation || state.stopping) return;
    fatalStop('W/F ERROR', 'The paired RF socket failed.');
  };

  socket.onclose = (event) => {
    cancelWatchdog(frameWatchdog);
    if (generation !== state.generation || state.stopping) return;
    const suffix = event.reason ? ` · ${event.reason}` : ` · code ${event.code}`;
    fatalStop('W/F CLOSED', `The paired RF stream ended${suffix}.`);
  };
}

async function loadBootstrap(generation) {
  const response = await fetch('/api/zero/bootstrap', { cache: 'no-store' });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`BOOTSTRAP INVALID (${response.status})`);
  }
  if (generation !== state.generation) throw new Error('SESSION SUPERSEDED');
  if (!response.ok || !payload?.ok) throw new Error(payload?.error || `BOOTSTRAP FAILED (${response.status})`);

  state.sessionTs = String(payload.sessionTs);
  els.receiverIdentity.textContent = `${payload.receiver.name} · ${payload.receiver.place}`.toUpperCase();
  els.kiwiVersion.textContent = Number.isFinite(payload.kiwi?.major) && Number.isFinite(payload.kiwi?.minor)
    ? `KIWI · ${payload.kiwi.major}.${payload.kiwi.minor}`
    : 'KIWI · LIVE';
  els.sessionLabel.textContent = `PAIR ${state.sessionTs.slice(-6)}`;
  updateProofUi();
}

function resetCounters() {
  state.sndFrames = 0;
  state.wfFrames = 0;
  state.audioProven = false;
  state.rfProven = false;
  state.sndConfigured = false;
  state.wfConfigured = false;
  state.rfFloor = -112;
  state.rfCeiling = -62;
  state.rfRangeReady = false;
  state.tunedKHz = FIXED.initialFrequencyKHz;
  state.viewportCenterKHz = FIXED.initialFrequencyKHz;
  state.mode = FIXED.initialMode;
  state.spectrumDb = null;
  state.spectrumScratch = null;
  state.pointerId = null;
  state.retunes = 0;
  state.modeSwitches = 0;
  state.sndOpenCount = 0;
  state.wfOpenCount = 0;
  state.activePreset = 'mw';
  els.sndFrames.textContent = '0';
  els.wfFrames.textContent = '0';
  els.uptime.textContent = '00:00';
  els.signalValue.textContent = '— dB';
  els.signalBar.style.width = '0';
  setLamp(els.sndLamp, false);
  setLamp(els.wfLamp, false);
  setBenchEnabled(false);
  updateTuningUi();
  updateProofUi();
}

function startUptime() {
  state.startedAt = Date.now();
  state.uptimeTimer = window.setInterval(() => {
    const total = Math.floor((Date.now() - state.startedAt) / 1000);
    const minutes = Math.floor(total / 60).toString().padStart(2, '0');
    const seconds = (total % 60).toString().padStart(2, '0');
    els.uptime.textContent = `${minutes}:${seconds}`;
  }, 1000);
}

function setMode(nextMode, { sendNow = true, count = true, announce = true } = {}) {
  if (!MODES[nextMode]) return;
  const previous = state.mode;
  state.mode = nextMode;
  if (previous !== nextMode && count) state.modeSwitches += 1;
  updateTuningUi();
  updateProofUi();
  if (sendNow) sendTune();
  if (announce && previous !== nextMode) {
    els.lastAction.textContent = `MODE ${MODES[previous].label} → ${MODES[nextMode].label} · Pair ${state.sessionTs?.slice(-6) || '—'} unchanged.`;
  }
}

function applyPreset(key) {
  const preset = PRESETS[key];
  if (!preset || !pairStable()) return;

  const previousKHz = state.tunedKHz;
  const previousCenterKHz = state.viewportCenterKHz;
  const previousMode = state.mode;
  const bandJump = Math.abs(previousCenterKHz - preset.kHz) > visibleSpanKHz() / 2;
  if (Math.abs(previousKHz - preset.kHz) >= 0.0005) state.retunes += 1;

  state.tunedKHz = preset.kHz;
  state.viewportCenterKHz = clampCenter(preset.kHz);
  state.activePreset = key;
  setMode(preset.mode, { sendNow: false, count: true, announce: false });
  if (bandJump) {
    clearWaterfallHistory();
    state.rfRangeReady = false;
    state.spectrumDb = null;
    state.spectrumScratch = null;
  }
  updateTuningUi();
  updateProofUi();
  sendTune();
  sendCenter();

  const from = formatMHz(previousKHz);
  const to = formatMHz(preset.kHz);
  const modeText = previousMode === preset.mode
    ? MODES[preset.mode].label
    : `${MODES[previousMode].label} → ${MODES[preset.mode].label}`;
  const historyText = bandJump ? ' · RF history reset for new span' : '';
  els.lastAction.textContent = `${preset.label} · ${from} → ${to} · ${modeText}${historyText} · Pair ${state.sessionTs.slice(-6)} unchanged.`;
}

function frequencyFromPointer(event) {
  const rect = els.canvas.getBoundingClientRect();
  if (!rect.width) return state.tunedKHz;
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const { left, right } = viewportEdges();
  return left + ratio * (right - left);
}

function tuneTo(rawKHz) {
  if (!pairStable()) return;
  const { left, right } = viewportEdges();
  const config = modeConfig();
  const clamped = Math.max(left, Math.min(right, rawKHz));
  const snapped = Math.round(clamped / config.stepKHz) * config.stepKHz;
  if (Math.abs(snapped - state.tunedKHz) < 0.0005) return;
  state.tunedKHz = snapped;
  state.activePreset = '';
  state.retunes += 1;
  updateTuningUi();
  updateProofUi();
  sendTune();
  els.lastAction.textContent = `FINE TUNE · ${formatMHz(state.tunedKHz)} · ${config.label} · Pair ${state.sessionTs.slice(-6)} unchanged.`;
}

function tuneFromPointer(event, force = false) {
  const now = performance.now();
  if (!force && now - state.lastTuneAt < 40) return;
  state.lastTuneAt = now;
  tuneTo(frequencyFromPointer(event));
}

async function start() {
  if (state.starting || els.power.getAttribute('aria-pressed') === 'true') return;
  state.starting = true;
  state.stopping = false;
  state.generation += 1;
  const generation = state.generation;

  clearTimers();
  closeSockets();
  resetCounters();
  drawIdleScope();

  els.power.disabled = true;
  els.power.setAttribute('aria-pressed', 'true');
  els.power.querySelector('span').textContent = 'STARTING';
  els.lastAction.textContent = 'Opening one fixed KU4BY SND session. W/F will open only after real audio is proven.';
  setMessage('OPENING RECEIVER', 'Getting a fresh Kiwi session timestamp from the fixed qualification receiver.');

  try {
    await ensureAudioContext();
    await loadBootstrap(generation);
    startUptime();
    els.power.disabled = false;
    els.power.querySelector('span').textContent = 'STOP';
    await openSnd(generation);
  } catch (error) {
    if (generation === state.generation && !state.stopping) {
      await fatalStop('START FAILED', error?.message || 'Could not start the receiver session.');
    }
  } finally {
    if (generation === state.generation) {
      state.starting = false;
      els.power.disabled = false;
    }
  }
}

function closeSockets() {
  for (const socket of [state.snd, state.wf]) {
    if (!socket) continue;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try { socket.close(1000, 'FREQBEACON ZERO BENCH stop'); } catch {}
  }
  state.snd = null;
  state.wf = null;
}

async function stop({ preserveMessage = false } = {}) {
  state.stopping = true;
  state.generation += 1;
  clearTimers();
  closeSockets();
  setLamp(els.sndLamp, false);
  setLamp(els.wfLamp, false);
  setBenchEnabled(false);

  if (state.audioContext && state.audioContext.state !== 'closed') {
    try { await state.audioContext.close(); } catch {}
  }

  state.audioContext = null;
  state.gain = null;
  state.sessionTs = null;
  state.starting = false;
  state.pointerId = null;
  els.power.disabled = false;
  els.power.setAttribute('aria-pressed', 'false');
  els.power.querySelector('span').textContent = 'START';
  els.sessionLabel.textContent = 'PAIR —';
  updateProofUi();

  if (!preserveMessage) {
    setMessage('BENCH OFF', 'Press START to open one fixed Kiwi receiver session.');
    drawIdleScope();
    els.lastAction.textContent = 'Bench stopped. Start again for a new single-session qualification run.';
  }
  state.stopping = false;
}

async function fatalStop(title, detail) {
  if (state.stopping) return;
  setMessage(title, detail, true);
  els.lastAction.textContent = `${title} · qualification run stopped; no failover or retry was attempted.`;
  await stop({ preserveMessage: true });
}

els.power.addEventListener('click', () => {
  if (els.power.getAttribute('aria-pressed') === 'true' && !state.starting) stop();
  else if (!state.starting) start();
});

els.mute.addEventListener('click', () => {
  state.muted = !state.muted;
  els.mute.setAttribute('aria-pressed', String(state.muted));
  els.mute.textContent = state.muted ? 'UNMUTE' : 'MUTE';
  if (state.gain) state.gain.gain.value = state.muted ? 0 : .82;
});

for (const button of els.modeButtons) {
  button.addEventListener('click', () => {
    if (!pairStable()) return;
    setMode(button.dataset.mode);
  });
}

for (const button of els.presetButtons) {
  button.addEventListener('click', () => applyPreset(button.dataset.preset));
}

els.canvas.addEventListener('pointerdown', (event) => {
  if (!pairStable()) return;
  event.preventDefault();
  state.pointerId = event.pointerId;
  try { els.canvas.setPointerCapture(event.pointerId); } catch {}
  tuneFromPointer(event, true);
});

els.canvas.addEventListener('pointermove', (event) => {
  if (state.pointerId !== event.pointerId) return;
  event.preventDefault();
  tuneFromPointer(event);
});

function endPointer(event) {
  if (state.pointerId !== event.pointerId) return;
  event.preventDefault();
  tuneFromPointer(event, true);
  try { els.canvas.releasePointerCapture(event.pointerId); } catch {}
  state.pointerId = null;
}

els.canvas.addEventListener('pointerup', endPointer);
els.canvas.addEventListener('pointercancel', (event) => {
  if (state.pointerId === event.pointerId) state.pointerId = null;
});

window.addEventListener('pagehide', () => {
  state.stopping = true;
  clearTimers();
  closeSockets();
});

setBenchEnabled(false);
updateTuningUi();
updateProofUi();
drawIdleScope();
