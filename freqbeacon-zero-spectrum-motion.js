// FREQBEACON Zero — display-rate interpolation for the live spectrum trace.
// Real Kiwi W/F frames remain the only RF source. The waterfall is untouched.

const CFG = Object.freeze({
  bins: 1024,
  spectrumH: 176,
  spectrumRadius: 3,
  spectrumAttack: 0.48,
  spectrumRelease: 0.16,
  minFrameMs: 32,
  maxFrameMs: 78
});

const canvas = document.querySelector('#rfCanvas');
if (!canvas) throw new Error('FREQBEACON Zero spectrum motion could not attach');

const ctx = canvas.getContext('2d', { alpha: false });
const seenSockets = new WeakSet();

const motion = {
  floor: -112,
  ceiling: -62,
  rangeReady: false,
  filtered: null,
  scratch: null,
  display: null,
  from: null,
  to: null,
  lastRealFrameAt: 0,
  frameIntervalMs: 58,
  animStart: 0,
  animDurationMs: 58,
  raf: 0
};

function updateRange(bins) {
  const values = Array.from(bins, (value) => value - 255).sort((a, b) => a - b);
  const noiseSample = values[Math.floor(values.length * .50)] ?? -105;
  const peakSample = values[Math.floor(values.length * .997)] ?? -65;
  const targetFloor = Math.max(-150, Math.min(-78, noiseSample - 13));
  const targetCeiling = Math.max(targetFloor + 48, Math.min(-20, peakSample + 7));

  if (!motion.rangeReady) {
    motion.floor = targetFloor;
    motion.ceiling = targetCeiling;
    motion.rangeReady = true;
    return;
  }

  motion.floor += (targetFloor - motion.floor) * .035;
  motion.ceiling += (targetCeiling - motion.ceiling) * .065;
  if (motion.ceiling - motion.floor < 48) motion.ceiling = motion.floor + 48;
}

function smoothRealFrame(bins) {
  if (!motion.filtered || motion.filtered.length !== bins.length) {
    motion.filtered = new Float32Array(bins.length);
    motion.scratch = new Float32Array(bins.length);
    for (let i = 0; i < bins.length; i += 1) motion.filtered[i] = bins[i] - 255;
  }

  const radius = CFG.spectrumRadius;
  for (let i = 0; i < bins.length; i += 1) {
    let weighted = 0;
    let weightTotal = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(bins.length - 1, i + radius); j += 1) {
      const weight = radius + 1 - Math.abs(i - j);
      weighted += (bins[j] - 255) * weight;
      weightTotal += weight;
    }
    motion.scratch[i] = weighted / weightTotal;
  }

  for (let i = 0; i < bins.length; i += 1) {
    const delta = motion.scratch[i] - motion.filtered[i];
    const alpha = delta >= 0 ? CFG.spectrumAttack : CFG.spectrumRelease;
    motion.filtered[i] += delta * alpha;
  }
  return motion.filtered;
}

function shapeSpectrumLevel(n) {
  const knee = 0.68;
  if (n >= knee) return n;
  return knee * Math.pow(n / knee, 1.65);
}

function drawSpectrum(values) {
  if (!values || canvas.classList.contains('zero-dragging')) return;

  const w = canvas.width;
  const spectrumH = CFG.spectrumH;
  const range = Math.max(48, motion.ceiling - motion.floor);

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

  const points = new Float32Array(w);
  for (let x = 0; x < w; x += 1) {
    const db = values[x];
    const n = Math.max(0, Math.min(1, (db - motion.floor) / range));
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
}

function ensureArrays(length) {
  if (motion.display && motion.display.length === length) return;
  motion.display = new Float32Array(length);
  motion.from = new Float32Array(length);
  motion.to = new Float32Array(length);
}

function animate(now) {
  motion.raf = 0;
  if (!motion.display || !motion.to) return;

  if (canvas.classList.contains('zero-dragging')) {
    motion.raf = requestAnimationFrame(animate);
    return;
  }

  const t = Math.max(0, Math.min(1, (now - motion.animStart) / Math.max(1, motion.animDurationMs)));
  for (let i = 0; i < motion.display.length; i += 1) {
    motion.display[i] = motion.from[i] + (motion.to[i] - motion.from[i]) * t;
  }
  drawSpectrum(motion.display);

  if (t < 1) motion.raf = requestAnimationFrame(animate);
}

function scheduleAnimation() {
  if (!motion.raf) motion.raf = requestAnimationFrame(animate);
}

function ingestBins(bins) {
  const now = performance.now();
  if (motion.lastRealFrameAt) {
    const observed = Math.max(CFG.minFrameMs, Math.min(120, now - motion.lastRealFrameAt));
    motion.frameIntervalMs = motion.frameIntervalMs * .8 + observed * .2;
  }
  motion.lastRealFrameAt = now;

  updateRange(bins);
  const target = smoothRealFrame(bins);
  ensureArrays(target.length);

  if (!motion.animStart) {
    motion.display.set(target);
    motion.from.set(target);
    motion.to.set(target);
    motion.animStart = now;
    drawSpectrum(motion.display);
    return;
  }

  // Core Zero just painted the newest real frame. Restore the current interpolated
  // trace immediately so there is no visible step before the next display refresh.
  drawSpectrum(motion.display);
  motion.from.set(motion.display);
  motion.to.set(target);
  motion.animStart = now;
  motion.animDurationMs = Math.max(
    CFG.minFrameMs,
    Math.min(CFG.maxFrameMs, motion.frameIntervalMs * .92)
  );
  scheduleAnimation();
}

function handleWfMessage(event) {
  const data = event.data;
  if (!(data instanceof ArrayBuffer)) return;
  const bytes = new Uint8Array(data);
  if (bytes.length < 16 + CFG.bins) return;
  if (bytes[0] !== 87 || bytes[1] !== 47 || bytes[2] !== 70) return; // W/F
  ingestBins(bytes.subarray(16, 16 + CFG.bins));
}

const previousSend = WebSocket.prototype.send;
WebSocket.prototype.send = function freqbeaconZeroSpectrumSend(data) {
  if (
    typeof data === 'string' &&
    data.includes('SERVER DE CLIENT FREQBEACON-ZERO W/F') &&
    !seenSockets.has(this)
  ) {
    seenSockets.add(this);
    this.addEventListener('message', handleWfMessage);
  }
  return previousSend.call(this, data);
};

window.addEventListener('pagehide', () => {
  if (motion.raf) cancelAnimationFrame(motion.raf);
  motion.raf = 0;
});
