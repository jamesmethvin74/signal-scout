// FREQBEACON Zero — direct-manipulation tuning surface.
// This module only controls the already-open Zero SND/W/F sockets and RF canvas.

function initialFrequencyKHz(defaultKHz = 560) {
  const params = new URLSearchParams(window.location.search);
  if (params.get('from') !== 'lookup') return defaultKHz;
  const requested = Number(params.get('frequency') || params.get('freq'));
  return Number.isFinite(requested) && requested >= 30 && requested <= 30000 ? requested : defaultKHz;
}

const CFG = Object.freeze({
  initialKHz: initialFrequencyKHz(),
  initialZoom: 8,
  minZoom: 5,
  maxZoom: 12,
  fullBandwidthKHz: 30000,
  stepKHz: 1,
  spectrumH: 176,
  scaleTop: 176,
  scaleH: 42,
  wfTop: 218,
  networkThrottleMs: 45
});

const BANDS = Object.freeze([
  { start: 530, end: 1700, label: 'MW BROADCAST', kind: 'broadcast' },
  { start: 1800, end: 2000, label: '160 m HAM', kind: 'ham' },
  { start: 2300, end: 2495, label: '120 m BROADCAST', kind: 'broadcast' },
  { start: 3200, end: 3400, label: '90 m BROADCAST', kind: 'broadcast' },
  { start: 3500, end: 4000, label: '80 m HAM', kind: 'ham' },
  { start: 3900, end: 4000, label: '75 m BROADCAST', kind: 'broadcast' },
  { start: 4750, end: 5060, label: '60 m BROADCAST', kind: 'broadcast' },
  { start: 5330.5, end: 5406.5, label: '60 m HAM', kind: 'ham' },
  { start: 5900, end: 6200, label: '49 m BROADCAST', kind: 'broadcast' },
  { start: 7000, end: 7300, label: '40 m HAM', kind: 'ham' },
  { start: 7200, end: 7600, label: '41 m BROADCAST', kind: 'broadcast' },
  { start: 9400, end: 9900, label: '31 m BROADCAST', kind: 'broadcast' },
  { start: 10100, end: 10150, label: '30 m HAM', kind: 'ham' },
  { start: 11600, end: 12100, label: '25 m BROADCAST', kind: 'broadcast' },
  { start: 14000, end: 14350, label: '20 m HAM', kind: 'ham' },
  { start: 15100, end: 15800, label: '19 m BROADCAST', kind: 'broadcast' },
  { start: 17480, end: 17900, label: '16 m BROADCAST', kind: 'broadcast' },
  { start: 18068, end: 18168, label: '17 m HAM', kind: 'ham' },
  { start: 21000, end: 21450, label: '15 m HAM', kind: 'ham' },
  { start: 21450, end: 21850, label: '13 m BROADCAST', kind: 'broadcast' },
  { start: 25600, end: 26100, label: '11 m BROADCAST', kind: 'broadcast' },
  { start: 28000, end: 29700, label: '10 m HAM', kind: 'ham' }
]);

const canvas = document.querySelector('#rfCanvas');
const scope = document.querySelector('.scope');
const cursor = document.querySelector('.tune-cursor');
const frequencyValue = document.querySelector('#frequencyValue');
const leftEdge = document.querySelector('#leftEdge');
const centerMark = document.querySelector('#centerMark');
const rightEdge = document.querySelector('#rightEdge');
const power = document.querySelector('#power');

if (!canvas || !scope || !cursor || !frequencyValue) {
  throw new Error('FREQBEACON Zero dial controls could not attach');
}

const baseCtx = canvas.getContext('2d', { alpha: false });
const overlay = document.createElement('canvas');
overlay.className = 'zero-band-overlay';
overlay.width = 1024;
overlay.height = 70;
overlay.setAttribute('aria-hidden', 'true');
scope.appendChild(overlay);
const overlayCtx = overlay.getContext('2d');

const zoomControls = document.createElement('div');
zoomControls.className = 'zero-zoom-controls';
zoomControls.setAttribute('role', 'group');
zoomControls.setAttribute('aria-label', 'Spectrum zoom');
zoomControls.innerHTML = `
  <button type="button" data-zero-zoom="-1" aria-label="Zoom spectrum out" title="Zoom spectrum out">−</button>
  <span data-zero-zoom-span aria-live="polite">117k</span>
  <button type="button" data-zero-zoom="1" aria-label="Zoom spectrum in" title="Zoom spectrum in">+</button>`;
scope.appendChild(zoomControls);
const zoomOutButton = zoomControls.querySelector('[data-zero-zoom="-1"]');
const zoomInButton = zoomControls.querySelector('[data-zero-zoom="1"]');
const zoomSpan = zoomControls.querySelector('[data-zero-zoom-span]');

const style = document.createElement('style');
style.textContent = `
  .zero-band-overlay {
    position: absolute;
    z-index: 3;
    left: 0;
    top: 27.4074%;
    width: 100%;
    height: 12.9630%;
    pointer-events: none;
  }
  .tune-cursor { z-index: 4; }
  .scope-message { z-index: 5; }
  .zero-zoom-controls {
    position: absolute;
    z-index: 8;
    top: 6px;
    left: 6px;
    display: grid;
    grid-template-columns: 25px auto 25px;
    align-items: center;
    gap: 1px;
    padding: 2px;
    border: 1px solid rgba(245,189,105,.30);
    border-radius: 5px;
    background: rgba(8,12,14,.82);
    box-shadow: 0 2px 7px rgba(0,0,0,.42), inset 0 1px rgba(255,255,255,.045);
    backdrop-filter: blur(5px);
  }
  .zero-zoom-controls button {
    width: 25px;
    height: 24px;
    padding: 0;
    border: 1px solid #493d2a;
    border-radius: 4px;
    color: #f7d59a;
    background: linear-gradient(180deg, rgba(255,255,255,.08), rgba(0,0,0,.16)), #24231f;
    box-shadow: inset 0 1px rgba(255,255,255,.055);
    font: 600 16px/1 system-ui, sans-serif;
    cursor: pointer;
    touch-action: manipulation;
  }
  .zero-zoom-controls button:active:not(:disabled) {
    color: #fff0c9;
    border-color: #8a6837;
    background: #342c20;
    transform: translateY(1px);
  }
  .zero-zoom-controls button:disabled { opacity: .28; cursor: default; }
  .zero-zoom-controls span {
    min-width: 34px;
    padding: 0 2px;
    color: #d8c39b;
    text-align: center;
    font: 700 8px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0;
    white-space: nowrap;
  }
  #rfCanvas { cursor: grab; }
  #rfCanvas.zero-dragging { cursor: grabbing; }
  @media (pointer: coarse) { #rfCanvas { cursor: default; } }
`;
document.head.appendChild(style);

const sockets = { snd: null, wf: null };
const nativeSend = WebSocket.prototype.send;
WebSocket.prototype.send = function trackedZeroSend(data) {
  let outgoing = data;
  if (typeof data === 'string') {
    if (data.includes('SERVER DE CLIENT FREQBEACON-ZERO SND')) sockets.snd = this;
    if (data.includes('SERVER DE CLIENT FREQBEACON-ZERO W/F')) sockets.wf = this;
    if (sockets.wf === this && /^SET zoom=\d+\s+cf=/.test(data)) {
      outgoing = `SET zoom=${dial.zoom} cf=${dial.centerKHz.toFixed(3)}`;
    }
  }
  return nativeSend.call(this, outgoing);
};

const dial = {
  tunedKHz: CFG.initialKHz,
  centerKHz: CFG.initialKHz,
  zoom: CFG.initialZoom,
  pointerId: null,
  mode: null,
  startX: 0,
  lastX: 0,
  startCenterKHz: CFG.initialKHz,
  startTunedKHz: CFG.initialKHz,
  startedAt: 0,
  lastNetworkAt: 0
};

function spanKHz() {
  return CFG.fullBandwidthKHz / (2 ** dial.zoom);
}

function edges() {
  const half = spanKHz() / 2;
  return { left: dial.centerKHz - half, right: dial.centerKHz + half };
}

function clampCenter(value) {
  const half = spanKHz() / 2;
  return Math.max(half, Math.min(CFG.fullBandwidthKHz - half, value));
}

function socketReady(socket) {
  return socket && socket.readyState === WebSocket.OPEN;
}

function formatSpan(value) {
  if (value >= 100) return `${value.toFixed(0)}k`;
  if (value >= 10) return `${value.toFixed(1)}k`;
  return `${value.toFixed(2)}k`;
}

function updateZoomControls() {
  if (zoomSpan) {
    zoomSpan.textContent = formatSpan(spanKHz());
    zoomSpan.setAttribute('aria-label', `${spanKHz().toFixed(2)} kilohertz visible span`);
  }
  if (zoomOutButton) zoomOutButton.disabled = dial.zoom <= CFG.minZoom;
  if (zoomInButton) zoomInButton.disabled = dial.zoom >= CFG.maxZoom;
}

function sendTune() {
  if (!socketReady(sockets.snd)) return;
  nativeSend.call(sockets.snd, `SET mod=am low_cut=-5000 high_cut=5000 freq=${dial.tunedKHz.toFixed(3)}`);
}

function sendCenter() {
  if (!socketReady(sockets.wf)) return;
  nativeSend.call(sockets.wf, `SET zoom=${dial.zoom} cf=${dial.centerKHz.toFixed(3)}`);
}

function sendState(force = false) {
  const now = performance.now();
  if (!force && now - dial.lastNetworkAt < CFG.networkThrottleMs) return;
  dial.lastNetworkAt = now;
  sendTune();
  sendCenter();
}

function visibleBands() {
  const { left, right } = edges();
  return BANDS.filter((band) => band.end > left && band.start < right);
}

function drawBandOverlay() {
  const ctx = overlayCtx;
  const w = overlay.width;
  const labelH = 28;
  const scaleY = labelH;
  const scaleH = 42;
  const bandH = 12;
  const { left, right } = edges();
  const span = right - left;

  ctx.clearRect(0, 0, w, overlay.height);
  ctx.fillStyle = '#060a0c';
  ctx.fillRect(0, scaleY, w, scaleH);
  ctx.fillStyle = '#060a0c';
  ctx.fillRect(0, scaleY, w, bandH);

  const bands = visibleBands();
  for (const band of bands) {
    const x1 = Math.max(0, ((Math.max(left, band.start) - left) / span) * w);
    const x2 = Math.min(w, ((Math.min(right, band.end) - left) / span) * w);
    if (x2 <= x1) continue;
    ctx.fillStyle = band.kind === 'ham' ? '#159a78' : '#df872b';
    ctx.fillRect(x1, scaleY, Math.max(1, x2 - x1), bandH);
  }

  const labels = [...bands]
    .sort((a, b) => {
      const aw = Math.min(right, a.end) - Math.max(left, a.start);
      const bw = Math.min(right, b.end) - Math.max(left, b.start);
      return bw - aw;
    })
    .slice(0, 2);

  ctx.font = '700 16px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  labels.forEach((band, index) => {
    const x = Math.max(8, ((Math.max(left, band.start) - left) / span) * w + 8);
    ctx.fillStyle = band.kind === 'ham' ? '#75e2bd' : '#ffc46f';
    ctx.fillText(band.label, Math.min(w - 160, x), index * 13);
  });

  ctx.strokeStyle = 'rgba(114, 144, 154, .45)';
  ctx.fillStyle = 'rgba(185, 204, 210, .82)';
  ctx.font = '19px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textBaseline = 'top';
  for (let i = 0; i <= 8; i += 1) {
    const x = (i / 8) * w;
    const major = i % 2 === 0;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + .5, scaleY + bandH);
    ctx.lineTo(Math.round(x) + .5, scaleY + bandH + (major ? 10 : 6));
    ctx.stroke();
    if (major) {
      const frequency = left + (i / 8) * span;
      ctx.textAlign = i === 0 ? 'left' : i === 8 ? 'right' : 'center';
      ctx.fillText((frequency / 1000).toFixed(4), Math.max(2, Math.min(w - 2, x)), scaleY + bandH + 11);
    }
  }
}

function updateUi() {
  const { left, right } = edges();
  frequencyValue.textContent = (dial.tunedKHz / 1000).toFixed(3);
  frequencyValue.parentElement?.setAttribute('aria-label', `${dial.tunedKHz.toFixed(3)} kilohertz`);
  leftEdge.textContent = `${(left / 1000).toFixed(3)} MHz`;
  centerMark.textContent = `VIEW ${dial.centerKHz.toFixed(3)} kHz`;
  rightEdge.textContent = `${(right / 1000).toFixed(3)} MHz`;
  const ratio = (dial.tunedKHz - left) / (right - left);
  cursor.style.left = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  drawBandOverlay();
  updateZoomControls();
}

function pointerFrequency(event) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return dial.tunedKHz;
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const { left, right } = edges();
  return left + ratio * (right - left);
}

function cursorClientX() {
  const rect = canvas.getBoundingClientRect();
  const { left, right } = edges();
  const ratio = Math.max(0, Math.min(1, (dial.tunedKHz - left) / (right - left)));
  return rect.left + ratio * rect.width;
}

function tuneToPointer(event) {
  const raw = pointerFrequency(event);
  const { left, right } = edges();
  dial.tunedKHz = Math.round(Math.max(left, Math.min(right, raw)) / CFG.stepKHz) * CFG.stepKHz;
  updateUi();
  sendTune();
}

function shiftRegion(top, height, pixelShift, fillStyle) {
  const w = canvas.width;
  const amount = Math.abs(pixelShift);
  if (!amount || amount >= w) return;
  if (pixelShift > 0) {
    baseCtx.drawImage(canvas, 0, top, w - amount, height, amount, top, w - amount, height);
    baseCtx.fillStyle = fillStyle;
    baseCtx.fillRect(0, top, amount, height);
  } else {
    baseCtx.drawImage(canvas, amount, top, w - amount, height, 0, top, w - amount, height);
    baseCtx.fillStyle = fillStyle;
    baseCtx.fillRect(w - amount, top, amount, height);
  }
}

function shiftRfVisual(clientDx) {
  if (!clientDx) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const px = Math.round(clientDx * (canvas.width / rect.width));
  if (!px || Math.abs(px) >= canvas.width) return;
  shiftRegion(0, CFG.spectrumH, px, '#071a24');
  shiftRegion(CFG.wfTop, canvas.height - CFG.wfTop, px, '#04101c');
}

function snapshotRfView() {
  const snapshot = document.createElement('canvas');
  snapshot.width = canvas.width;
  snapshot.height = canvas.height;
  snapshot.getContext('2d', { alpha: false })?.drawImage(canvas, 0, 0);
  const { left, right } = edges();
  return { snapshot, left, right };
}

function reprojectRegion(oldView, newView, top, height, fillStyle) {
  baseCtx.fillStyle = fillStyle;
  baseCtx.fillRect(0, top, canvas.width, height);

  const overlapLeft = Math.max(oldView.left, newView.left);
  const overlapRight = Math.min(oldView.right, newView.right);
  if (!(overlapRight > overlapLeft)) return;

  const oldSpan = oldView.right - oldView.left;
  const newSpan = newView.right - newView.left;
  if (!(oldSpan > 0) || !(newSpan > 0)) return;

  const sx = ((overlapLeft - oldView.left) / oldSpan) * canvas.width;
  const sw = ((overlapRight - overlapLeft) / oldSpan) * canvas.width;
  const dx = ((overlapLeft - newView.left) / newSpan) * canvas.width;
  const dw = ((overlapRight - overlapLeft) / newSpan) * canvas.width;
  if (sw < 1 || dw < 1) return;

  baseCtx.drawImage(
    oldView.snapshot,
    sx, top, sw, height,
    dx, top, dw, height
  );
}

function preserveRfForZoom(oldView) {
  const newView = edges();
  reprojectRegion(oldView, newView, 0, CFG.spectrumH, '#071a24');
  reprojectRegion(oldView, newView, CFG.wfTop, canvas.height - CFG.wfTop, '#04101c');
}

function zoomBy(step) {
  const next = Math.max(CFG.minZoom, Math.min(CFG.maxZoom, dial.zoom + Number(step || 0)));
  if (next === dial.zoom) return;

  const oldView = snapshotRfView();
  dial.zoom = next;
  dial.centerKHz = clampCenter(dial.tunedKHz);
  dial.startCenterKHz = dial.centerKHz;
  dial.startTunedKHz = dial.tunedKHz;
  preserveRfForZoom(oldView);
  updateUi();
  sendCenter();
  window.dispatchEvent(new CustomEvent('freqbeacon:zero-zoom', {
    detail: { zoom: dial.zoom, spanKHz: spanKHz(), centerKHz: dial.centerKHz }
  }));
}

function panToPointer(event, force = false) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const dx = event.clientX - dial.startX;
  const deltaKHz = -(dx / rect.width) * spanKHz();
  const nextCenter = clampCenter(dial.startCenterKHz + deltaKHz);
  const appliedDelta = nextCenter - dial.startCenterKHz;
  dial.centerKHz = nextCenter;
  dial.tunedKHz = Math.round((dial.startTunedKHz + appliedDelta) / CFG.stepKHz) * CFG.stepKHz;

  const incrementalDx = event.clientX - dial.lastX;
  dial.lastX = event.clientX;
  shiftRfVisual(incrementalDx);
  updateUi();
  sendState(force);
}

function beginGesture(event) {
  if (!socketReady(sockets.snd)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  dial.pointerId = event.pointerId;
  dial.startX = event.clientX;
  dial.lastX = event.clientX;
  dial.startCenterKHz = dial.centerKHz;
  dial.startTunedKHz = dial.tunedKHz;
  dial.startedAt = performance.now();
  dial.lastNetworkAt = 0;
  dial.mode = Math.abs(event.clientX - cursorClientX()) <= 30 ? 'needle' : 'surface';
  canvas.classList.add('zero-dragging');
  try { canvas.setPointerCapture(event.pointerId); } catch {}
}

function moveGesture(event) {
  if (dial.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  if (dial.mode === 'needle') {
    tuneToPointer(event);
    return;
  }

  if (dial.mode === 'surface') {
    if (Math.abs(event.clientX - dial.startX) < 7) return;
    dial.mode = 'pan';
  }
  if (dial.mode === 'pan') panToPointer(event);
}

function endGesture(event) {
  if (dial.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopImmediatePropagation();

  if (dial.mode === 'needle') {
    tuneToPointer(event);
  } else if (dial.mode === 'pan') {
    panToPointer(event, true);
  } else if (dial.mode === 'surface') {
    const moved = Math.abs(event.clientX - dial.startX);
    const elapsed = performance.now() - dial.startedAt;
    if (moved < 7 && elapsed < 500) tuneToPointer(event);
  }

  try { canvas.releasePointerCapture(event.pointerId); } catch {}
  dial.pointerId = null;
  dial.mode = null;
  canvas.classList.remove('zero-dragging');
}

function cancelGesture(event) {
  if (dial.pointerId !== event.pointerId) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  dial.pointerId = null;
  dial.mode = null;
  canvas.classList.remove('zero-dragging');
}

zoomControls.addEventListener('pointerdown', (event) => event.stopPropagation());
zoomControls.addEventListener('click', (event) => {
  const button = event.target.closest('[data-zero-zoom]');
  if (!button || button.disabled) return;
  event.preventDefault();
  event.stopPropagation();
  zoomBy(Number(button.dataset.zeroZoom));
});

canvas.addEventListener('pointerdown', beginGesture, { capture: true });
canvas.addEventListener('pointermove', moveGesture, { capture: true });
canvas.addEventListener('pointerup', endGesture, { capture: true });
canvas.addEventListener('pointercancel', cancelGesture, { capture: true });

power?.addEventListener('click', () => {
  window.setTimeout(() => {
    if (power.getAttribute('aria-pressed') === 'true' && power.querySelector('span')?.textContent === 'STARTING') {
      dial.tunedKHz = CFG.initialKHz;
      dial.centerKHz = CFG.initialKHz;
      dial.zoom = CFG.initialZoom;
      updateUi();
    }
  }, 0);
});

updateUi();
