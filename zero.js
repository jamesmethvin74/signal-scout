const $ = (selector) => document.querySelector(selector);

const els = {
  power: $('#power'), frequency: $('#frequency'), band: $('#bandLabel'),
  sndLamp: $('#sndLamp'), wfLamp: $('#wfLamp'), netLamp: $('#netLamp'),
  canvas: $('#scopeCanvas'), scopeState: $('#scopeState'), tape: $('#tape'),
  leftFreq: $('#leftFreq'), rightFreq: $('#rightFreq'), meterBar: $('#meterBar'),
  meterValue: $('#meterValue'), receiverName: $('#receiverName'), mute: $('#mute')
};

const cuts = {
  am: [-4900, 4900], sam: [-4900, 4900],
  usb: [300, 2700], lsb: [-2700, -300]
};

const state = {
  frequency: 7200,
  mode: 'lsb',
  zoom: 10,
  viewCenter: 7200,
  receiverId: 'houston',
  receivers: [{ id: 'houston', name: 'Houston, Texas' }],
  snd: null,
  wf: null,
  sndKeepalive: null,
  wfKeepalive: null,
  audioContext: null,
  gain: null,
  nextPlayTime: 0,
  sampleRate: 12000,
  sndConfigured: false,
  wfConfigured: false,
  gotAudio: false,
  gotWaterfall: false,
  muted: false,
  drag: null,
  tuneTimer: null,
  lastBins: null
};

function setLamp(el, live) { el.classList.toggle('live', Boolean(live)); }

function spanKHz() { return 30000 / (2 ** state.zoom); }

function formatMHz(kHz) {
  return (kHz / 1000).toFixed(3);
}

function updateReadout() {
  els.frequency.innerHTML = `${formatMHz(state.frequency)}<span>MHz</span>`;
  const half = spanKHz() / 2;
  els.leftFreq.textContent = formatMHz(state.viewCenter - half);
  els.rightFreq.textContent = formatMHz(state.viewCenter + half);
  const cursor = document.querySelector('.cursor');
  const offset = (state.frequency - state.viewCenter) / spanKHz();
  cursor.style.left = `${50 + offset * 100}%`;
}

function showScopeState(title, detail) {
  els.scopeState.classList.remove('hidden');
  els.scopeState.innerHTML = `<b>${title}</b><span>${detail}</span>`;
}

function hideScopeState() { els.scopeState.classList.add('hidden'); }

function resizeCanvas() {
  const rect = els.canvas.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const width = Math.max(320, Math.round(rect.width * dpr));
  const height = Math.max(220, Math.round(rect.height * dpr));
  if (els.canvas.width !== width || els.canvas.height !== height) {
    els.canvas.width = width;
    els.canvas.height = height;
    if (state.lastBins) renderRf(state.lastBins);
  }
}

function colorFor(value) {
  const t = Math.max(0, Math.min(1, value));
  const stops = [
    [0, [2, 6, 8]], [.22, [5, 26, 31]], [.45, [5, 96, 103]],
    [.67, [34, 219, 205]], [.84, [255, 190, 74]], [1, [255, 245, 222]]
  ];
  for (let i = 1; i < stops.length; i += 1) {
    if (t <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const m = (t - a) / (b - a || 1);
      return ca.map((v, c) => Math.round(v + (cb[c] - v) * m));
    }
  }
  return stops.at(-1)[1];
}

function renderRf(bins) {
  state.lastBins = bins;
  resizeCanvas();
  const canvas = els.canvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const spectrumH = Math.round(h * 0.38);
  const waterfallTop = spectrumH + 1;
  const waterfallH = h - waterfallTop;

  const db = Array.from(bins, (v) => v - 255);
  const sorted = db.filter((v) => v > -195).sort((a, b) => a - b);
  const noise = sorted[Math.floor(sorted.length * .25)] ?? -120;
  const peak = sorted[Math.floor(sorted.length * .985)] ?? -70;
  const minDb = Math.max(-150, Math.min(-88, noise - 10));
  const maxDb = Math.max(minDb + 38, Math.min(-20, peak + 5));
  const range = maxDb - minDb;

  if (!state.gotWaterfall) {
    ctx.fillStyle = '#030506';
    ctx.fillRect(0, 0, w, h);
  } else if (waterfallH > 3) {
    ctx.drawImage(canvas, 0, waterfallTop, w, waterfallH - 2, 0, waterfallTop + 2, w, waterfallH - 2);
  }

  const row = ctx.createImageData(w, 2);
  for (let x = 0; x < w; x += 1) {
    const i = Math.min(bins.length - 1, Math.floor((x / Math.max(1, w - 1)) * bins.length));
    const n = (db[i] - minDb) / range;
    const [r, g, b] = colorFor(n);
    for (let y = 0; y < 2; y += 1) {
      const p = (y * w + x) * 4;
      row.data[p] = r; row.data[p + 1] = g; row.data[p + 2] = b; row.data[p + 3] = 255;
    }
  }
  ctx.putImageData(row, 0, waterfallTop);

  ctx.fillStyle = '#030506';
  ctx.fillRect(0, 0, w, spectrumH);
  ctx.strokeStyle = 'rgba(88,245,231,.12)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= w; x += w / 8) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, spectrumH); ctx.stroke();
  }
  ctx.beginPath();
  for (let x = 0; x < w; x += 1) {
    const i = Math.min(db.length - 1, Math.floor((x / Math.max(1, w - 1)) * db.length));
    const n = Math.max(0, Math.min(1, (db[i] - minDb) / range));
    const y = spectrumH - 8 - n * (spectrumH - 18);
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#58f5e7';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = 'rgba(215,226,229,.62)';
  ctx.font = `${Math.max(10, Math.round(w / 75))}px ui-monospace, monospace`;
  ctx.textBaseline = 'top';
  const half = spanKHz() / 2;
  ctx.textAlign = 'left'; ctx.fillText(`${formatMHz(state.viewCenter - half)} MHz`, 10, 10);
  ctx.textAlign = 'center'; ctx.fillText(`${formatMHz(state.viewCenter)} MHz`, w / 2, 10);
  ctx.textAlign = 'right'; ctx.fillText(`${formatMHz(state.viewCenter + half)} MHz`, w - 10, 10);

  state.gotWaterfall = true;
  setLamp(els.wfLamp, true);
  hideScopeState();
}

async function audioContext() {
  if (state.audioContext && state.audioContext.state !== 'closed') {
    if (state.audioContext.state === 'suspended') await state.audioContext.resume();
    return state.audioContext;
  }
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioContextCtor({ latencyHint: 'interactive' });
  const gain = ctx.createGain();
  gain.gain.value = state.muted ? 0 : .78;
  gain.connect(ctx.destination);
  state.audioContext = ctx;
  state.gain = gain;
  state.nextPlayTime = ctx.currentTime + .06;
  return ctx;
}

function playPcm(bytes, littleEndian) {
  if (!state.audioContext || bytes.byteLength < 2) return;
  const count = Math.floor(bytes.byteLength / 2);
  const samples = new Float32Array(count);
  const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
  for (let i = 0; i < count; i += 1) samples[i] = view.getInt16(i * 2, littleEndian) / 32768;
  const buffer = state.audioContext.createBuffer(1, count, state.sampleRate || 12000);
  buffer.copyToChannel(samples, 0);
  const source = state.audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(state.gain);
  const now = state.audioContext.currentTime;
  if (state.nextPlayTime < now + .025 || state.nextPlayTime > now + .45) state.nextPlayTime = now + .045;
  source.start(state.nextPlayTime);
  state.nextPlayTime += count / (state.sampleRate || 12000);
}

function socketUrl(stream, ts) {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/api/zero-sdr/ws?receiver=${encodeURIComponent(state.receiverId)}&stream=${encodeURIComponent(stream)}&ts=${ts}`;
}

function send(socket, message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(message);
}

function waterfallStart(centerKHz = state.viewCenter) {
  const scale = 2 ** state.zoom;
  const totalBins = 1024 * scale;
  const maxStart = totalBins - 1024;
  return Math.max(0, Math.min(maxStart, Math.round((centerKHz / 30000) * totalBins - 512)));
}

function configureSound() {
  if (state.sndConfigured) return;
  state.sndConfigured = true;
  const [low, high] = cuts[state.mode];
  send(state.snd, 'SET ident_user=FREQBEACON ZERO');
  send(state.snd, `SET mod=${state.mode} low_cut=${low} high_cut=${high} freq=${state.frequency.toFixed(3)}`);
  send(state.snd, 'SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50');
  send(state.snd, 'SET compression=0');
  send(state.snd, 'SET squelch=0 max=0');
  send(state.snd, 'SET genattn=0');
  send(state.snd, 'SET gen=0 mix=-1');
  send(state.snd, 'SET de_emp=0');
}

function configureWaterfall() {
  if (!state.wf || state.wf.readyState !== WebSocket.OPEN) return;
  send(state.wf, 'SET ident_user=FREQBEACON ZERO');
  send(state.wf, 'SET maxdb=-20 mindb=-125');
  send(state.wf, `SET zoom=${state.zoom} start=${waterfallStart()}`);
  send(state.wf, 'SET wf_comp=0');
  send(state.wf, 'SET wf_speed=2');
  send(state.wf, 'SET interp=13');
  state.wfConfigured = true;
}

function tuneSound() {
  const [low, high] = cuts[state.mode];
  send(state.snd, `SET mod=${state.mode} low_cut=${low} high_cut=${high} freq=${state.frequency.toFixed(3)}`);
}

function recenterWaterfall(force = false) {
  const edge = spanKHz() * .34;
  if (!force && Math.abs(state.frequency - state.viewCenter) < edge) return;
  state.viewCenter = state.frequency;
  state.gotWaterfall = false;
  state.lastBins = null;
  updateReadout();
  if (state.wfConfigured) send(state.wf, `SET zoom=${state.zoom} start=${waterfallStart()}`);
}

async function bytesFrom(data) {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (typeof data === 'string') return new TextEncoder().encode(data);
  return null;
}

function textMessage(bytes) {
  return new TextDecoder().decode(bytes.subarray(4));
}

function openWaterfall(ts) {
  if (state.wf) return;
  const socket = new WebSocket(socketUrl('W/F', ts));
  socket.binaryType = 'arraybuffer';
  state.wf = socket;
  socket.onopen = () => {
    send(socket, 'SET auth t=kiwi p=#');
    window.setTimeout(configureWaterfall, 300);
    state.wfKeepalive = window.setInterval(() => send(socket, 'SET keepalive'), 5000);
  };
  socket.onmessage = async (event) => {
    const bytes = await bytesFrom(event.data);
    if (!bytes || bytes.length < 3) return;
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    if (tag === 'MSG') {
      const text = textMessage(bytes);
      if (/too_busy=1/.test(text)) showScopeState('RF BUSY', 'This receiver has no free waterfall slot.');
      if (!state.wfConfigured) configureWaterfall();
      return;
    }
    if (tag !== 'W/F' || bytes.length < 1027) return;
    renderRf(bytes.subarray(bytes.length - 1024));
  };
  socket.onerror = () => showScopeState('RF ERROR', 'The waterfall socket failed.');
  socket.onclose = () => {
    setLamp(els.wfLamp, false);
    state.wf = null;
    state.wfConfigured = false;
    window.clearInterval(state.wfKeepalive);
    state.wfKeepalive = null;
    if (els.power.getAttribute('aria-pressed') === 'true') showScopeState('RF CLOSED', 'Audio may continue; the waterfall connection ended.');
  };
}

async function connect() {
  await audioContext();
  disconnectSockets();
  state.sndConfigured = false;
  state.wfConfigured = false;
  state.gotAudio = false;
  state.gotWaterfall = false;
  state.lastBins = null;
  state.viewCenter = state.frequency;
  updateReadout();
  showScopeState('OPENING SND', 'Connecting one receiver. No automatic hopping.');
  els.power.setAttribute('aria-pressed', 'true');
  els.power.querySelector('span').textContent = 'STOP';

  const ts = String(Date.now());
  const socket = new WebSocket(socketUrl('SND', ts));
  socket.binaryType = 'arraybuffer';
  state.snd = socket;

  socket.onopen = () => {
    setLamp(els.netLamp, true);
    send(socket, 'SET auth t=kiwi p=#');
    state.sndKeepalive = window.setInterval(() => send(socket, 'SET keepalive'), 5000);
  };

  socket.onmessage = async (event) => {
    const bytes = await bytesFrom(event.data);
    if (!bytes || bytes.length < 3) return;
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    if (tag === 'MSG') {
      const text = textMessage(bytes);
      const sampleRate = Number(text.match(/(?:^|\s)sample_rate=([0-9.]+)/)?.[1]);
      const audioRate = Number(text.match(/(?:^|\s)audio_rate=([0-9.]+)/)?.[1]);
      if (Number.isFinite(sampleRate) && sampleRate > 1000) {
        state.sampleRate = sampleRate;
        configureSound();
        openWaterfall(ts);
      }
      if (Number.isFinite(audioRate) && state.audioContext) {
        send(socket, `SET AR OK in=${audioRate} out=${Math.round(state.audioContext.sampleRate)}`);
      }
      if (/too_busy=1/.test(text)) showScopeState('RECEIVER BUSY', 'This receiver has no free audio slot.');
      if (/down=1/.test(text)) showScopeState('RECEIVER DOWN', 'The selected receiver reports that it is offline.');
      return;
    }
    if (tag !== 'SND' || bytes.length < 10) return;
    const body = bytes.subarray(3);
    const flags = body[0];
    const smeter = (body[5] << 8) | body[6];
    const rssi = smeter * .1 - 127;
    els.meterValue.textContent = `${rssi.toFixed(0)} dB`;
    els.meterBar.style.width = `${Math.max(0, Math.min(100, (rssi + 125) * 1.65))}%`;
    if ((flags & 0x10) !== 0) { send(socket, 'SET compression=0'); return; }
    playPcm(body.subarray(7), (flags & 0x80) !== 0);
    if (!state.gotAudio) {
      state.gotAudio = true;
      setLamp(els.sndLamp, true);
      showScopeState('AUDIO LIVE', 'Waiting for the paired RF waterfall.');
      if (!state.wf) openWaterfall(ts);
    }
  };

  socket.onerror = () => showScopeState('SND ERROR', 'The receiver audio socket failed.');
  socket.onclose = () => {
    if (els.power.getAttribute('aria-pressed') === 'true') showScopeState('RECEIVER CLOSED', 'The selected receiver ended the session.');
    setLamp(els.sndLamp, false);
    setLamp(els.netLamp, false);
    els.power.setAttribute('aria-pressed', 'false');
    els.power.querySelector('span').textContent = 'START';
    state.snd = null;
    window.clearInterval(state.sndKeepalive);
    state.sndKeepalive = null;
  };
}

function disconnectSockets() {
  for (const socket of [state.snd, state.wf]) {
    if (!socket) continue;
    socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
    try { socket.close(1000, 'FREQBEACON ZERO stop'); } catch {}
  }
  state.snd = state.wf = null;
  state.sndConfigured = state.wfConfigured = false;
  window.clearInterval(state.sndKeepalive);
  window.clearInterval(state.wfKeepalive);
  state.sndKeepalive = state.wfKeepalive = null;
  setLamp(els.sndLamp, false); setLamp(els.wfLamp, false); setLamp(els.netLamp, false);
}

async function stop() {
  disconnectSockets();
  els.power.setAttribute('aria-pressed', 'false');
  els.power.querySelector('span').textContent = 'START';
  showScopeState('RF OFF', 'Start the receiver to open the airwaves.');
  if (state.audioContext && state.audioContext.state !== 'closed') {
    try { await state.audioContext.close(); } catch {}
  }
  state.audioContext = null; state.gain = null; state.lastBins = null;
}

function setFrequency(next, { recenter = false } = {}) {
  state.frequency = Math.max(10, Math.min(30000, Math.round(next * 100) / 100));
  updateReadout();
  window.clearTimeout(state.tuneTimer);
  state.tuneTimer = window.setTimeout(tuneSound, 25);
  if (recenter) recenterWaterfall();
}

async function loadReceivers() {
  try {
    const response = await fetch('/api/zero-sdr/receivers', { cache: 'no-store' });
    const payload = await response.json();
    if (Array.isArray(payload.receivers) && payload.receivers.length) state.receivers = payload.receivers;
  } catch {}
  const receiver = state.receivers.find((r) => r.id === state.receiverId) || state.receivers[0];
  if (receiver) { state.receiverId = receiver.id; els.receiverName.textContent = receiver.name.toUpperCase(); }
}

els.power.addEventListener('click', () => {
  if (els.power.getAttribute('aria-pressed') === 'true') stop(); else connect().catch((error) => showScopeState('START FAILED', error?.message || 'Could not start receiver.'));
});

document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => {
  state.mode = button.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b === button));
  tuneSound();
}));

document.querySelectorAll('[data-step]').forEach((button) => button.addEventListener('click', () => {
  const step = (state.mode === 'am' || state.mode === 'sam') ? 1 : .1;
  setFrequency(state.frequency + Number(button.dataset.step) * step, { recenter: true });
}));

els.tape.addEventListener('pointerdown', (event) => {
  els.tape.setPointerCapture(event.pointerId);
  state.drag = { id: event.pointerId, x: event.clientX, frequency: state.frequency };
});
els.tape.addEventListener('pointermove', (event) => {
  if (!state.drag || state.drag.id !== event.pointerId) return;
  const dx = event.clientX - state.drag.x;
  setFrequency(state.drag.frequency - dx * .02);
});
els.tape.addEventListener('pointerup', (event) => {
  if (!state.drag || state.drag.id !== event.pointerId) return;
  state.drag = null;
  recenterWaterfall();
});
els.tape.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  event.preventDefault();
  const step = (state.mode === 'am' || state.mode === 'sam') ? 1 : .1;
  setFrequency(state.frequency + (event.key === 'ArrowRight' ? step : -step), { recenter: true });
});

els.mute.addEventListener('click', () => {
  state.muted = !state.muted;
  els.mute.setAttribute('aria-pressed', String(state.muted));
  if (state.gain) state.gain.gain.value = state.muted ? 0 : .78;
});

els.receiverName.parentElement.tabIndex = 0;
els.receiverName.parentElement.setAttribute('role', 'button');
els.receiverName.parentElement.setAttribute('aria-label', 'Change test receiver');
els.receiverName.parentElement.addEventListener('click', () => {
  const index = Math.max(0, state.receivers.findIndex((r) => r.id === state.receiverId));
  const next = state.receivers[(index + 1) % state.receivers.length];
  state.receiverId = next.id;
  els.receiverName.textContent = next.name.toUpperCase();
  if (els.power.getAttribute('aria-pressed') === 'true') connect();
});

window.addEventListener('resize', resizeCanvas);
new ResizeObserver(resizeCanvas).observe(els.canvas);
loadReceivers();
updateReadout();
resizeCanvas();
