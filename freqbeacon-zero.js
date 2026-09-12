const FIXED = Object.freeze({
  frequencyKHz: 5000,
  mode: 'am',
  lowCut: -5000,
  highCut: 5000,
  zoom: 10,
  fullBandwidthKHz: 30000,
  waterfallBins: 1024,
  audioProofFrames: 5,
  noFrameTimeoutMs: 7000,
  keepaliveMs: 15000
});

const els = {
  power: document.querySelector('#power'),
  mute: document.querySelector('#mute'),
  canvas: document.querySelector('#rfCanvas'),
  message: document.querySelector('#scopeMessage'),
  sndLamp: document.querySelector('#sndLamp'),
  wfLamp: document.querySelector('#wfLamp'),
  sessionLabel: document.querySelector('#sessionLabel'),
  receiverIdentity: document.querySelector('#receiverIdentity'),
  kiwiVersion: document.querySelector('#kiwiVersion'),
  signalValue: document.querySelector('#signalValue'),
  signalBar: document.querySelector('#signalBar'),
  sndFrames: document.querySelector('#sndFrames'),
  wfFrames: document.querySelector('#wfFrames'),
  uptime: document.querySelector('#uptime'),
  leftEdge: document.querySelector('#leftEdge'),
  rightEdge: document.querySelector('#rightEdge')
};

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
  muted: false
};

const ctx = els.canvas.getContext('2d', { alpha: false });

function formatMHz(kHz) {
  return `${(kHz / 1000).toFixed(3)} MHz`;
}

function visibleSpanKHz() {
  return FIXED.fullBandwidthKHz / (2 ** FIXED.zoom);
}

function updateEdges() {
  const half = visibleSpanKHz() / 2;
  els.leftEdge.textContent = formatMHz(FIXED.frequencyKHz - half);
  els.rightEdge.textContent = formatMHz(FIXED.frequencyKHz + half);
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

function drawIdleScope() {
  const w = els.canvas.width;
  const h = els.canvas.height;
  ctx.fillStyle = '#020405';
  ctx.fillRect(0, 0, w, h);

  const spectrumH = 176;
  const scaleTop = 176;
  const scaleH = 42;
  const wfTop = scaleTop + scaleH;

  ctx.strokeStyle = 'rgba(93, 137, 150, .16)';
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
  ctx.fillStyle = '#020405';
  ctx.fillRect(0, wfTop, w, h - wfTop);
  drawFrequencyScale(scaleTop, scaleH);
}

function drawFrequencyScale(top, height) {
  const w = els.canvas.width;
  const span = visibleSpanKHz();
  const left = FIXED.frequencyKHz - span / 2;

  ctx.fillStyle = '#060a0c';
  ctx.fillRect(0, top, w, height);
  ctx.strokeStyle = 'rgba(114, 144, 154, .42)';
  ctx.fillStyle = 'rgba(157, 178, 184, .72)';
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

function waterfallStart() {
  const totalBins = FIXED.waterfallBins * (2 ** FIXED.zoom);
  const raw = (FIXED.frequencyKHz / FIXED.fullBandwidthKHz) * totalBins - FIXED.waterfallBins / 2;
  return Math.max(0, Math.min(totalBins - FIXED.waterfallBins, Math.round(raw)));
}

function colorForDb(db) {
  const min = -125;
  const max = -35;
  const n = Math.max(0, Math.min(1, (db - min) / (max - min)));

  if (n < .23) {
    const t = n / .23;
    return [2, Math.round(7 + 17 * t), Math.round(10 + 26 * t)];
  }
  if (n < .52) {
    const t = (n - .23) / .29;
    return [Math.round(4 + 4 * t), Math.round(24 + 90 * t), Math.round(36 + 96 * t)];
  }
  if (n < .75) {
    const t = (n - .52) / .23;
    return [Math.round(8 + 54 * t), Math.round(114 + 117 * t), Math.round(132 + 92 * t)];
  }
  if (n < .90) {
    const t = (n - .75) / .15;
    return [Math.round(62 + 193 * t), Math.round(231 - 42 * t), Math.round(224 - 137 * t)];
  }
  const t = (n - .90) / .10;
  return [255, Math.round(189 + 57 * t), Math.round(87 + 148 * t)];
}

function renderRf(bins) {
  const w = els.canvas.width;
  const h = els.canvas.height;
  const spectrumH = 176;
  const scaleTop = 176;
  const scaleH = 42;
  const wfTop = scaleTop + scaleH;
  const wfH = h - wfTop;

  if (state.wfFrames > 1) {
    ctx.drawImage(els.canvas, 0, wfTop, w, wfH - 2, 0, wfTop + 2, w, wfH - 2);
  } else {
    ctx.fillStyle = '#020405';
    ctx.fillRect(0, wfTop, w, wfH);
  }

  const row = ctx.createImageData(w, 2);
  for (let x = 0; x < w; x += 1) {
    const db = bins[x] - 255;
    const [r, g, b] = colorForDb(db);
    for (let y = 0; y < 2; y += 1) {
      const p = (y * w + x) * 4;
      row.data[p] = r;
      row.data[p + 1] = g;
      row.data[p + 2] = b;
      row.data[p + 3] = 255;
    }
  }
  ctx.putImageData(row, 0, wfTop);

  ctx.fillStyle = '#020607';
  ctx.fillRect(0, 0, w, spectrumH);

  ctx.strokeStyle = 'rgba(86, 240, 226, .11)';
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

  ctx.beginPath();
  for (let x = 0; x < w; x += 1) {
    const db = bins[x] - 255;
    const n = Math.max(0, Math.min(1, (db + 125) / 90));
    const y = spectrumH - 8 - n * (spectrumH - 18);
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#56f0e2';
  ctx.lineWidth = 2;
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
  return id;
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

  for (let i = 0; i < sampleCount; i += 1) {
    samples[i] = view.getInt16(i * 2, littleEndian) / 32768;
  }

  const buffer = state.audioContext.createBuffer(1, sampleCount, state.audioSampleRate);
  buffer.copyToChannel(samples, 0);

  const source = state.audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(state.gain);

  const now = state.audioContext.currentTime;
  if (state.nextAudioAt < now + .025 || state.nextAudioAt > now + .60) {
    state.nextAudioAt = now + .06;
  }

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

function configureSnd() {
  if (state.sndConfigured || !state.snd) return;
  state.sndConfigured = true;

  send(state.snd, 'SERVER DE CLIENT FREQBEACON-ZERO SND');
  send(state.snd, 'SET ident_user=FREQBEACON ZERO');
  send(state.snd, `SET AR OK in=${Math.round(state.audioSampleRate)} out=${Math.round(state.audioContext.sampleRate)}`);
  send(state.snd, `SET mod=${FIXED.mode} low_cut=${FIXED.lowCut} high_cut=${FIXED.highCut} freq=${FIXED.frequencyKHz.toFixed(3)}`);
  send(state.snd, 'SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50');
  send(state.snd, 'SET compression=0');
  send(state.snd, 'SET squelch=0 max=0');
}

function configureWf() {
  if (state.wfConfigured || !state.wf) return;
  state.wfConfigured = true;

  send(state.wf, 'SERVER DE CLIENT FREQBEACON-ZERO W/F');
  send(state.wf, 'SET ident_user=FREQBEACON ZERO');
  send(state.wf, 'SET send_dB=1');
  send(state.wf, `SET zoom=${FIXED.zoom} start=${waterfallStart()}`);
  send(state.wf, 'SET maxdb=-35 mindb=-125');
  send(state.wf, 'SET wf_comp=0');
  send(state.wf, 'SET interp=13');
  send(state.wf, 'SET window_func=2');
  send(state.wf, 'SET wf_speed=3');
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

      if (state.sndFrames >= FIXED.audioProofFrames && !state.wf) {
        openWf(generation);
      }

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
      const text = messageText(bytes);
      handleCommonMessage(text, 'W/F');
      return;
    }

    if (tag !== 'W/F' || bytes.length < 16 + FIXED.waterfallBins) return;

    // Current Kiwi uncompressed W/F packets carry a 16-byte header followed by 1024 dB bins.
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
  els.kiwiVersion.textContent =
    Number.isFinite(payload.kiwi?.major) && Number.isFinite(payload.kiwi?.minor)
      ? `KIWI · ${payload.kiwi.major}.${payload.kiwi.minor}`
      : 'KIWI · LIVE';
  els.sessionLabel.textContent = `PAIR ${state.sessionTs.slice(-6)}`;
}

function resetCounters() {
  state.sndFrames = 0;
  state.wfFrames = 0;
  state.audioProven = false;
  state.rfProven = false;
  state.sndConfigured = false;
  state.wfConfigured = false;
  els.sndFrames.textContent = '0';
  els.wfFrames.textContent = '0';
  els.uptime.textContent = '00:00';
  els.signalValue.textContent = '— dB';
  els.signalBar.style.width = '0';
  setLamp(els.sndLamp, false);
  setLamp(els.wfLamp, false);
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
  setMessage('OPENING RECEIVER', 'Getting a fresh Kiwi session timestamp from the selected receiver.');

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
    try { socket.close(1000, 'FREQBEACON ZERO stop'); } catch {}
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

  if (state.audioContext && state.audioContext.state !== 'closed') {
    try { await state.audioContext.close(); } catch {}
  }

  state.audioContext = null;
  state.gain = null;
  state.sessionTs = null;
  state.starting = false;
  els.power.disabled = false;
  els.power.setAttribute('aria-pressed', 'false');
  els.power.querySelector('span').textContent = 'START';
  els.sessionLabel.textContent = 'PAIR —';

  if (!preserveMessage) {
    setMessage('RF OFF', 'Press START to open one Kiwi receiver session.');
    drawIdleScope();
  }

  state.stopping = false;
}

async function fatalStop(title, detail) {
  if (state.stopping) return;
  setMessage(title, detail, true);
  await stop({ preserveMessage: true });
}

els.power.addEventListener('click', () => {
  if (els.power.getAttribute('aria-pressed') === 'true' && !state.starting) {
    stop();
  } else if (!state.starting) {
    start();
  }
});

els.mute.addEventListener('click', () => {
  state.muted = !state.muted;
  els.mute.setAttribute('aria-pressed', String(state.muted));
  els.mute.textContent = state.muted ? 'UNMUTE' : 'MUTE';
  if (state.gain) state.gain.gain.value = state.muted ? 0 : .82;
});

window.addEventListener('pagehide', () => {
  state.stopping = true;
  clearTimers();
  closeSockets();
});

updateEdges();
drawIdleScope();
