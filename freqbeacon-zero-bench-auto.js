// FREQBEACON Zero qualification bench — automatic range/mode qualification.
// UI/test harness only: uses the existing bench controls and reads the existing cadence diagnostics.
// Does not open sockets, send Kiwi protocol commands directly, render RF, or alter /zero.

const TEST_STAGES = Object.freeze([
  { label: 'LW · AM', preset: 'lw' },
  { label: 'MW · AM', preset: 'mw' },
  { label: 'MW · SAM', preset: 'mw', mode: 'sam' },
  { label: 'SW · AM', preset: 'sw' },
  { label: '80m · LSB', preset: '80m' },
  { label: '40m · CW', preset: '40m', mode: 'cw' },
  { label: '20m · USB', preset: '20m' },
  { label: 'HF AIR · USB', preset: 'air' },
  { label: 'CB 19 · AM', preset: 'cb' },
  { label: '10m · NBFM', preset: '10fm' }
]);

const SAMPLE_COUNT = 5;
const SAMPLE_INTERVAL_MS = 1000;
const SETTLE_MS = 1800;
const WARMUP_TIMEOUT_MS = 90000;
const WARMUP_GOOD_SAMPLES = 3;
const GOOD_RATIO = 0.70;
const WARN_RATIO = 0.35;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function numberFrom(text) {
  const match = String(text || '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : NaN;
}

function cadenceEls() {
  return {
    wf: document.querySelector('[data-bench-wf-fps]'),
    snd: document.querySelector('[data-bench-snd-fps]'),
    ui: document.querySelector('[data-bench-ui-fps]'),
    gap: document.querySelector('[data-bench-main-gap]')
  };
}

function cadenceSnapshot() {
  const c = cadenceEls();
  const wfText = c.wf?.textContent || '';
  const parts = wfText.split('/');
  return {
    wf: numberFrom(parts[0]),
    target: parts.length > 1 ? numberFrom(parts[1]) : NaN,
    snd: numberFrom(c.snd?.textContent),
    ui: numberFrom(c.ui?.textContent),
    gap: numberFrom(c.gap?.textContent),
    pair: document.querySelector('#pairProof')?.textContent?.trim() || '',
    sockets: document.querySelector('#socketProof')?.textContent?.trim() || ''
  };
}

function stablePair(snapshot = cadenceSnapshot()) {
  return snapshot.pair.includes('STABLE') && snapshot.sockets === '1 SND · 1 W/F';
}

function avg(values) {
  const usable = values.filter(Number.isFinite);
  if (!usable.length) return NaN;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

function min(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? Math.min(...usable) : NaN;
}

function max(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? Math.max(...usable) : NaN;
}

function fmt(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function classify(result) {
  if (!result.pairStable) return 'fail';
  const target = Number.isFinite(result.target) && result.target > 0 ? result.target : 23;
  const ratio = result.wfAvg / target;
  if (!Number.isFinite(ratio)) return 'fail';
  if (ratio >= GOOD_RATIO) return 'pass';
  if (ratio >= WARN_RATIO) return 'warn';
  return 'fail';
}

const anchor = document.querySelector('#lastAction');
const panel = document.createElement('section');
panel.className = 'bench-auto';
panel.setAttribute('aria-label', 'Automatic band and mode qualification');
panel.innerHTML = `
  <div class="bench-auto-head">
    <div>
      <small>AUTO QUALIFICATION</small>
      <strong>Full-range stability run</strong>
    </div>
    <button type="button" data-auto-run>RUN AUTO TEST</button>
  </div>
  <div class="bench-auto-status" data-auto-status>Starts the bench if needed, waits for W/F cadence to stabilize, then tests 10 band/mode stages on the same socket pair.</div>
  <div class="bench-auto-results" data-auto-results hidden></div>
`;
anchor?.insertAdjacentElement('beforebegin', panel);

const style = document.createElement('style');
style.textContent = `
  .bench-auto { margin: 10px 0; padding: 12px; border: 1px solid rgba(94,126,136,.35); background: rgba(3,11,15,.52); }
  .bench-auto-head { display:flex; gap:12px; align-items:center; justify-content:space-between; }
  .bench-auto-head div { display:grid; gap:3px; }
  .bench-auto-head small { color:var(--cyan); letter-spacing:.12em; font-size:.68rem; }
  .bench-auto-head strong { color:#d4dde0; font-size:.95rem; }
  .bench-auto button { border:1px solid rgba(89,228,222,.55); background:rgba(23,91,94,.22); color:var(--cyan); padding:10px 12px; font:700 .76rem ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.06em; }
  .bench-auto button:disabled { opacity:.45; }
  .bench-auto-status { margin-top:10px; color:#9aa9ae; font: .72rem/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; }
  .bench-auto-results { margin-top:10px; display:grid; gap:4px; font: .70rem/1.35 ui-monospace,SFMono-Regular,Menlo,monospace; }
  .bench-auto-results .auto-row { display:grid; grid-template-columns:minmax(110px,1.2fr) .8fr .8fr .7fr; gap:6px; padding:6px 0; border-top:1px solid rgba(94,126,136,.18); }
  .bench-auto-results .auto-row b { color:#d2dcdf; font-weight:600; }
  .bench-auto-results .pass { color:var(--cyan); }
  .bench-auto-results .warn { color:var(--amber); }
  .bench-auto-results .fail { color:var(--danger); }
  .bench-auto-results .auto-summary { margin-top:7px; padding-top:8px; border-top:1px solid rgba(94,126,136,.38); font-weight:700; }
`;
document.head.appendChild(style);

const runButton = panel.querySelector('[data-auto-run]');
const statusEl = panel.querySelector('[data-auto-status]');
const resultsEl = panel.querySelector('[data-auto-results]');
let running = false;

async function ensureBenchStarted() {
  const power = document.querySelector('#power');
  if (!power) throw new Error('START button not found');
  if (!stablePair()) {
    const label = power.querySelector('span')?.textContent?.trim() || power.textContent.trim();
    if (/START/i.test(label) && !power.disabled) power.click();
  }

  const deadline = performance.now() + 20000;
  while (performance.now() < deadline) {
    if (stablePair()) return;
    await sleep(500);
  }
  throw new Error('Socket pair did not become stable within 20 seconds');
}

async function waitForCadenceWarmup() {
  statusEl.textContent = 'Warming up W/F cadence… waiting for at least 70% of the Kiwi target for 3 consecutive samples.';
  const deadline = performance.now() + WARMUP_TIMEOUT_MS;
  let good = 0;
  let best = 0;
  while (performance.now() < deadline) {
    const snap = cadenceSnapshot();
    if (!stablePair(snap)) throw new Error('Socket pair changed during cadence warm-up');
    if (Number.isFinite(snap.wf)) best = Math.max(best, snap.wf);
    const target = Number.isFinite(snap.target) && snap.target > 0 ? snap.target : 23;
    if (Number.isFinite(snap.wf) && snap.wf / target >= GOOD_RATIO) good += 1;
    else good = 0;
    statusEl.textContent = `Warming up W/F cadence… ${fmt(snap.wf)} / ${fmt(target, 0)} FPS · best ${fmt(best)} · ${good}/${WARMUP_GOOD_SAMPLES} good samples`;
    if (good >= WARMUP_GOOD_SAMPLES) return { warmed: true, best };
    await sleep(1000);
  }
  return { warmed: false, best };
}

async function runStage(stage, index) {
  statusEl.textContent = `Stage ${index + 1}/${TEST_STAGES.length}: ${stage.label} — retuning, then measuring cadence…`;
  const presetButton = document.querySelector(`[data-preset="${stage.preset}"]`);
  if (!presetButton || presetButton.disabled) throw new Error(`Preset ${stage.preset} unavailable`);
  presetButton.click();
  await sleep(500);

  if (stage.mode) {
    const modeButton = document.querySelector(`[data-mode="${stage.mode}"]`);
    if (!modeButton || modeButton.disabled) throw new Error(`Mode ${stage.mode} unavailable`);
    modeButton.click();
  }

  await sleep(SETTLE_MS);

  const samples = [];
  for (let i = 0; i < SAMPLE_COUNT; i += 1) {
    const snap = cadenceSnapshot();
    samples.push(snap);
    if (!stablePair(snap)) break;
    statusEl.textContent = `Stage ${index + 1}/${TEST_STAGES.length}: ${stage.label} — sample ${i + 1}/${SAMPLE_COUNT} · W/F ${fmt(snap.wf)} / ${fmt(snap.target, 0)} · SND ${fmt(snap.snd)}`;
    await sleep(SAMPLE_INTERVAL_MS);
  }

  const wf = samples.map((s) => s.wf);
  const snd = samples.map((s) => s.snd);
  const ui = samples.map((s) => s.ui);
  const gap = samples.map((s) => s.gap);
  const target = samples.map((s) => s.target).find(Number.isFinite) ?? 23;
  return {
    ...stage,
    target,
    wfAvg: avg(wf),
    wfMin: min(wf),
    wfMax: max(wf),
    sndAvg: avg(snd),
    uiAvg: avg(ui),
    gapMax: max(gap),
    pairStable: samples.length === SAMPLE_COUNT && samples.every(stablePair)
  };
}

function renderResults(results, warmup) {
  resultsEl.hidden = false;
  const rows = results.map((result) => {
    const level = classify(result);
    return `<div class="auto-row ${level}"><b>${result.label}</b><span>WF ${fmt(result.wfAvg)} (${fmt(result.wfMin)}–${fmt(result.wfMax)})</span><span>SND ${fmt(result.sndAvg)}</span><span>${level.toUpperCase()}</span></div>`;
  }).join('');

  const levels = results.map(classify);
  const pairOk = results.every((result) => result.pairStable);
  const overall = !pairOk || levels.includes('fail') ? 'fail' : levels.includes('warn') || !warmup.warmed ? 'warn' : 'pass';
  const title = overall === 'pass' ? 'PASS — full-range session stayed healthy' : overall === 'warn' ? 'PASS WITH CADENCE WARNINGS' : 'FAIL — session/cadence problem detected';
  const target = results.map((r) => r.target).find(Number.isFinite) ?? 23;
  const overallWf = avg(results.map((r) => r.wfAvg));

  resultsEl.innerHTML = `${rows}<div class="auto-summary ${overall}">${title} · average W/F ${fmt(overallWf)} / ${fmt(target, 0)} FPS · pair ${pairOk ? 'STABLE' : 'CHANGED'} · warm-up best ${fmt(warmup.best)}</div>`;
  return { overall, title, overallWf, pairOk };
}

runButton?.addEventListener('click', async () => {
  if (running) return;
  running = true;
  runButton.disabled = true;
  resultsEl.hidden = true;
  resultsEl.innerHTML = '';
  try {
    statusEl.textContent = 'Starting qualification bench…';
    await ensureBenchStarted();
    const warmup = await waitForCadenceWarmup();
    const results = [];
    for (let i = 0; i < TEST_STAGES.length; i += 1) {
      results.push(await runStage(TEST_STAGES[i], i));
      if (!results[results.length - 1].pairStable) break;
    }
    const summary = renderResults(results, warmup);
    statusEl.textContent = `${summary.title}. Screenshot this result block if you want me to review the run.`;
  } catch (error) {
    statusEl.textContent = `AUTO TEST STOPPED: ${error?.message || 'unknown error'}`;
    resultsEl.hidden = false;
    resultsEl.innerHTML = `<div class="auto-summary fail">FAIL — ${String(error?.message || 'unknown error')}</div>`;
  } finally {
    running = false;
    runButton.disabled = false;
  }
});
