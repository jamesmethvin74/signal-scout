// FREQBEACON Zero qualification bench — W/F speed selector proof.
// Bench-only diagnostic. Keeps one receiver/session/frequency/mode and changes only Kiwi wf_speed.

const previousSend = WebSocket.prototype.send;
let wfSocket = null;
let wfFrames = 0;
let wfAck = null;
let running = false;

function tagOf(data) {
  if (!(data instanceof ArrayBuffer) || data.byteLength < 3) return '';
  const bytes = new Uint8Array(data);
  return String.fromCharCode(bytes[0], bytes[1], bytes[2]);
}

function attachWf(socket) {
  if (wfSocket === socket) return;
  wfSocket = socket;
  socket.addEventListener('message', (event) => {
    const tag = tagOf(event.data);
    if (tag === 'W/F') {
      wfFrames += 1;
      return;
    }
    if (tag !== 'MSG') return;
    const bytes = new Uint8Array(event.data);
    const text = new TextDecoder().decode(bytes.subarray(4));
    const match = text.match(/(?:^|\s)wf_fps=(\d+)/);
    if (match) wfAck = Number(match[1]);
  });
}

WebSocket.prototype.send = function freqbeaconBenchWfSpeedSend(data) {
  if (typeof data === 'string' && data.includes('SERVER DE CLIENT FREQBEACON-ZERO W/F')) attachWf(this);
  return previousSend.call(this, data);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pairStable() {
  const pair = document.querySelector('#pairProof')?.textContent || '';
  const sockets = document.querySelector('#socketProof')?.textContent || '';
  return pair.includes('STABLE') && sockets.trim() === '1 SND · 1 W/F';
}

async function ensureStarted() {
  const power = document.querySelector('#power');
  if (!pairStable() && power) {
    const label = power.querySelector('span')?.textContent || power.textContent || '';
    if (/START/i.test(label) && !power.disabled) power.click();
  }
  const deadline = performance.now() + 20000;
  while (performance.now() < deadline) {
    if (pairStable() && wfSocket?.readyState === WebSocket.OPEN) return;
    await sleep(400);
  }
  throw new Error('Stable W/F socket was not available within 20 seconds');
}

async function measureStage(selector, expected, label) {
  wfAck = null;
  previousSend.call(wfSocket, `SET wf_speed=${selector}`);
  const ackDeadline = performance.now() + 4000;
  while (performance.now() < ackDeadline && wfAck == null) await sleep(100);

  statusEl.textContent = `${label}: receiver ACK ${wfAck ?? '—'} FPS · settling…`;
  await sleep(2500);
  const startFrames = wfFrames;
  const started = performance.now();
  await sleep(6000);
  const elapsed = (performance.now() - started) / 1000;
  const actual = (wfFrames - startFrames) / elapsed;
  return { label, selector, expected, ack: wfAck, actual };
}

const anchor = document.querySelector('#lastAction');
const panel = document.createElement('section');
panel.className = 'bench-wf-speed';
panel.setAttribute('aria-label', 'Waterfall speed selector proof');
panel.innerHTML = `
  <div class="bench-wf-speed-head">
    <div><small>W/F SPEED PROOF</small><strong>5 → 13 → FAST</strong></div>
    <button type="button" data-wf-speed-run>RUN SPEED TEST</button>
  </div>
  <div class="bench-wf-speed-status" data-wf-speed-status>Same receiver, frequency, mode and socket pair. Changes only Kiwi waterfall speed.</div>
  <div class="bench-wf-speed-results" data-wf-speed-results hidden></div>
`;
anchor?.insertAdjacentElement('beforebegin', panel);

const style = document.createElement('style');
style.textContent = `
  .bench-wf-speed { margin:10px 0; padding:12px; border:1px solid rgba(94,126,136,.35); background:rgba(3,11,15,.52); }
  .bench-wf-speed-head { display:flex; gap:12px; align-items:center; justify-content:space-between; }
  .bench-wf-speed-head div { display:grid; gap:3px; }
  .bench-wf-speed-head small { color:var(--cyan); letter-spacing:.12em; font-size:.68rem; }
  .bench-wf-speed-head strong { color:#d4dde0; font-size:.95rem; }
  .bench-wf-speed button { border:1px solid rgba(89,228,222,.55); background:rgba(23,91,94,.22); color:var(--cyan); padding:10px 12px; font:700 .76rem ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.06em; }
  .bench-wf-speed button:disabled { opacity:.45; }
  .bench-wf-speed-status, .bench-wf-speed-results { margin-top:10px; font:.72rem/1.5 ui-monospace,SFMono-Regular,Menlo,monospace; }
  .bench-wf-speed-status { color:#9aa9ae; }
  .bench-wf-speed-results { color:#d4dde0; }
  .bench-wf-speed-results .speed-row { padding:6px 0; border-top:1px solid rgba(94,126,136,.18); }
  .bench-wf-speed-results .good { color:var(--cyan); }
  .bench-wf-speed-results .warn { color:var(--amber); }
`;
document.head.appendChild(style);

const runButton = panel.querySelector('[data-wf-speed-run]');
const statusEl = panel.querySelector('[data-wf-speed-status]');
const resultsEl = panel.querySelector('[data-wf-speed-results]');

runButton?.addEventListener('click', async () => {
  if (running) return;
  running = true;
  runButton.disabled = true;
  resultsEl.hidden = true;
  resultsEl.innerHTML = '';
  try {
    statusEl.textContent = 'Starting one-session W/F speed proof…';
    await ensureStarted();
    const beforePair = document.querySelector('#pairProof')?.textContent || '';
    const stages = [];
    stages.push(await measureStage(2, 5, 'SLOW'));
    stages.push(await measureStage(3, 13, 'MEDIUM'));
    stages.push(await measureStage(-1, 23, 'FAST'));

    // Leave the bench in the same FAST setting used by Zero.
    previousSend.call(wfSocket, 'SET wf_speed=-1');

    const pairOk = pairStable() && (document.querySelector('#pairProof')?.textContent || '') === beforePair;
    resultsEl.hidden = false;
    resultsEl.innerHTML = stages.map((s) => {
      const ratio = s.actual / s.expected;
      const cls = ratio >= 0.8 ? 'good' : 'warn';
      return `<div class="speed-row ${cls}">${s.label}: requested ${s.expected} · ACK ${s.ack ?? '—'} · actual ${s.actual.toFixed(1)} FPS</div>`;
    }).join('') + `<div class="speed-row ${pairOk ? 'good' : 'warn'}">PAIR ${pairOk ? 'STABLE' : 'CHANGED'} · same frequency/mode throughout</div>`;
    statusEl.textContent = 'Speed proof complete. Screenshot this result block.';
  } catch (error) {
    resultsEl.hidden = false;
    resultsEl.innerHTML = `<div class="speed-row warn">STOPPED — ${String(error?.message || 'unknown error')}</div>`;
    statusEl.textContent = 'Speed proof stopped before completion.';
  } finally {
    running = false;
    runButton.disabled = false;
  }
});
