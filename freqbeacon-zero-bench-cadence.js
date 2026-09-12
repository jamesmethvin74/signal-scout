// FREQBEACON Zero qualification bench — cadence diagnostics only.
// Observes the existing SND/W/F sockets. Does not tune, reconnect, render RF or alter protocol commands.

const previousSend = WebSocket.prototype.send;
const seenSnd = new WeakSet();
const seenWf = new WeakSet();

const state = {
  sndFrames: 0,
  wfFrames: 0,
  lastSndFrames: 0,
  lastWfFrames: 0,
  lastSampleAt: performance.now(),
  serverWfFps: null,
  wfLastAt: 0,
  wfGapMs: 0,
  rafFrames: 0,
  rafLastAt: 0,
  rafMaxGapMs: 0,
  raf: 0,
  timer: 0
};

const anchor = document.querySelector('.bench-proof');
const panel = document.createElement('div');
panel.className = 'bench-proof bench-cadence-proof';
panel.setAttribute('aria-label', 'Live cadence diagnostics');
panel.innerHTML = `
  <span><small>W/F FPS</small><b data-bench-wf-fps>—</b></span>
  <span><small>SND FPS</small><b data-bench-snd-fps>—</b></span>
  <span><small>UI FPS</small><b data-bench-ui-fps>—</b></span>
  <span><small>MAIN GAP</small><b data-bench-main-gap>— ms</b></span>
`;
anchor?.insertAdjacentElement('afterend', panel);

const style = document.createElement('style');
style.textContent = `
  .bench-cadence-proof { margin-top: 7px; }
  .bench-cadence-proof b.cadence-good { color: var(--cyan); }
  .bench-cadence-proof b.cadence-warn { color: var(--amber); }
  .bench-cadence-proof b.cadence-bad { color: var(--danger); }
`;
document.head.appendChild(style);

const els = {
  wfFps: panel.querySelector('[data-bench-wf-fps]'),
  sndFps: panel.querySelector('[data-bench-snd-fps]'),
  uiFps: panel.querySelector('[data-bench-ui-fps]'),
  mainGap: panel.querySelector('[data-bench-main-gap]')
};

function tagOf(data) {
  if (!(data instanceof ArrayBuffer) || data.byteLength < 3) return '';
  const bytes = new Uint8Array(data);
  return String.fromCharCode(bytes[0], bytes[1], bytes[2]);
}

function parseWfTarget(data) {
  if (!(data instanceof ArrayBuffer) || data.byteLength < 5) return;
  const bytes = new Uint8Array(data);
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2]) !== 'MSG') return;
  const text = new TextDecoder().decode(bytes.subarray(4));
  const match = text.match(/(?:^|\s)wf_fps=(\d+)/);
  if (match) state.serverWfFps = Number(match[1]);
}

function attachSnd(socket) {
  if (seenSnd.has(socket)) return;
  seenSnd.add(socket);
  socket.addEventListener('message', (event) => {
    if (tagOf(event.data) === 'SND') state.sndFrames += 1;
  });
}

function attachWf(socket) {
  if (seenWf.has(socket)) return;
  seenWf.add(socket);
  socket.addEventListener('message', (event) => {
    const tag = tagOf(event.data);
    if (tag === 'MSG') {
      parseWfTarget(event.data);
      return;
    }
    if (tag !== 'W/F') return;
    const now = performance.now();
    if (state.wfLastAt) {
      const gap = now - state.wfLastAt;
      state.wfGapMs = state.wfGapMs ? state.wfGapMs * 0.8 + gap * 0.2 : gap;
    }
    state.wfLastAt = now;
    state.wfFrames += 1;
  });
}

WebSocket.prototype.send = function freqbeaconBenchCadenceSend(data) {
  if (typeof data === 'string') {
    if (data.includes('SERVER DE CLIENT FREQBEACON-ZERO SND')) attachSnd(this);
    if (data.includes('SERVER DE CLIENT FREQBEACON-ZERO W/F')) attachWf(this);
  }
  return previousSend.call(this, data);
};

function paintClass(el, level) {
  el.classList.remove('cadence-good', 'cadence-warn', 'cadence-bad');
  if (level) el.classList.add(`cadence-${level}`);
}

function uiFrame(now) {
  if (state.rafLastAt) state.rafMaxGapMs = Math.max(state.rafMaxGapMs, now - state.rafLastAt);
  state.rafLastAt = now;
  state.rafFrames += 1;
  state.raf = requestAnimationFrame(uiFrame);
}

function updateReadout() {
  const now = performance.now();
  const elapsed = Math.max(0.25, (now - state.lastSampleAt) / 1000);
  const wfFps = (state.wfFrames - state.lastWfFrames) / elapsed;
  const sndFps = (state.sndFrames - state.lastSndFrames) / elapsed;
  const uiFps = state.rafFrames / elapsed;
  const target = state.serverWfFps;

  els.wfFps.textContent = `${wfFps.toFixed(1)}${Number.isFinite(target) ? ` / ${target}` : ''}`;
  els.sndFps.textContent = sndFps.toFixed(1);
  els.uiFps.textContent = uiFps.toFixed(0);
  els.mainGap.textContent = `${state.rafMaxGapMs.toFixed(0)} ms`;

  const wfRatio = Number.isFinite(target) && target > 0 ? wfFps / target : null;
  paintClass(els.wfFps, wfRatio == null ? null : wfRatio >= 0.7 ? 'good' : wfRatio >= 0.3 ? 'warn' : 'bad');
  paintClass(els.uiFps, uiFps >= 45 ? 'good' : uiFps >= 24 ? 'warn' : 'bad');
  paintClass(els.mainGap, state.rafMaxGapMs <= 80 ? 'good' : state.rafMaxGapMs <= 180 ? 'warn' : 'bad');

  state.lastSndFrames = state.sndFrames;
  state.lastWfFrames = state.wfFrames;
  state.lastSampleAt = now;
  state.rafFrames = 0;
  state.rafMaxGapMs = 0;
}

state.raf = requestAnimationFrame(uiFrame);
state.timer = window.setInterval(updateReadout, 1000);

window.addEventListener('pagehide', () => {
  if (state.raf) cancelAnimationFrame(state.raf);
  if (state.timer) clearInterval(state.timer);
  state.raf = 0;
  state.timer = 0;
});
