// FREQBEACON Zero qualification bench — automatic qualification v2.
// Test harness only. Uses existing controls/diagnostics; does not alter RF protocol, renderer, sockets or /zero.

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

const BASELINE_TIMEOUT_MS = 90000;
const BASELINE_GOOD_SAMPLES = 3;
const STAGE_RECOVERY_TIMEOUT_MS = 20000;
const STAGE_GOOD_SAMPLES = 2;
const MEASURE_SAMPLES = 5;
const GOOD_RATIO = 0.70;
const WARN_RATIO = 0.35;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function numberFrom(text) {
  const m = String(text || '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

function snap() {
  const wfText = document.querySelector('[data-bench-wf-fps]')?.textContent || '';
  const parts = wfText.split('/');
  return {
    wf: numberFrom(parts[0]),
    target: parts.length > 1 ? numberFrom(parts[1]) : NaN,
    snd: numberFrom(document.querySelector('[data-bench-snd-fps]')?.textContent),
    ui: numberFrom(document.querySelector('[data-bench-ui-fps]')?.textContent),
    gap: numberFrom(document.querySelector('[data-bench-main-gap]')?.textContent),
    pair: document.querySelector('#pairProof')?.textContent?.trim() || '',
    sockets: document.querySelector('#socketProof')?.textContent?.trim() || ''
  };
}

function stablePair(s = snap()) {
  return s.pair.includes('STABLE') && s.sockets === '1 SND · 1 W/F';
}

function avg(values) {
  const a = values.filter(Number.isFinite);
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
}
function min(values) { const a = values.filter(Number.isFinite); return a.length ? Math.min(...a) : NaN; }
function max(values) { const a = values.filter(Number.isFinite); return a.length ? Math.max(...a) : NaN; }
function fmt(v, d = 1) { return Number.isFinite(v) ? v.toFixed(d) : '—'; }

async function loadSnapshot() {
  try {
    const r = await fetch('/api/zero-bench/diagnostics', { cache: 'no-store' });
    const j = await r.json();
    const status = j?.status || {};
    return {
      users: Number(status.users),
      usersMax: Number(status.users_max),
      observedAt: j?.observedAt || null
    };
  } catch {
    return { users: NaN, usersMax: NaN, observedAt: null };
  }
}

function loadText(load) {
  return Number.isFinite(load.users) && Number.isFinite(load.usersMax)
    ? `${load.users}/${load.usersMax} users`
    : 'load unavailable';
}

const anchor = document.querySelector('#lastAction');
const panel = document.createElement('section');
panel.className = 'bench-auto';
panel.setAttribute('aria-label', 'Automatic band and mode qualification');
panel.innerHTML = `
  <div class="bench-auto-head">
    <div><small>AUTO QUALIFICATION V2</small><strong>Baseline → retune recovery → measurement</strong></div>
    <button type="button" data-auto-run>RUN AUTO TEST</button>
  </div>
  <div class="bench-auto-status" data-auto-status>Requires a healthy W/F baseline before any band changes. If baseline never stabilizes, the run stops as INCONCLUSIVE instead of falsely blaming retuning.</div>
  <div class="bench-auto-results" data-auto-results hidden></div>
`;
anchor?.insertAdjacentElement('beforebegin', panel);

const style = document.createElement('style');
style.textContent = `
  .bench-auto { margin:10px 0; padding:12px; border:1px solid rgba(94,126,136,.35); background:rgba(3,11,15,.52); }
  .bench-auto-head { display:flex; gap:12px; align-items:center; justify-content:space-between; }
  .bench-auto-head div { display:grid; gap:3px; }
  .bench-auto-head small { color:var(--cyan); letter-spacing:.12em; font-size:.68rem; }
  .bench-auto-head strong { color:#d4dde0; font-size:.95rem; }
  .bench-auto button { border:1px solid rgba(89,228,222,.55); background:rgba(23,91,94,.22); color:var(--cyan); padding:10px 12px; font:700 .76rem ui-monospace,SFMono-Regular,Menlo,monospace; letter-spacing:.06em; }
  .bench-auto button:disabled { opacity:.45; }
  .bench-auto-status { margin-top:10px; color:#9aa9ae; font:.72rem/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; }
  .bench-auto-results { margin-top:10px; display:grid; gap:4px; font:.70rem/1.35 ui-monospace,SFMono-Regular,Menlo,monospace; }
  .bench-auto-results .auto-row { display:grid; grid-template-columns:minmax(108px,1.05fr) .75fr .72fr .82fr .65fr; gap:6px; padding:6px 0; border-top:1px solid rgba(94,126,136,.18); }
  .bench-auto-results .auto-row b { color:#d2dcdf; font-weight:600; }
  .bench-auto-results .pass { color:var(--cyan); }
  .bench-auto-results .warn { color:var(--amber); }
  .bench-auto-results .fail { color:var(--danger); }
  .bench-auto-results .inconclusive { color:#b7c0c3; }
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

async function waitForHealthyBaseline() {
  const loadStart = await loadSnapshot();
  const deadline = performance.now() + BASELINE_TIMEOUT_MS;
  let good = 0;
  let best = 0;
  while (performance.now() < deadline) {
    const s = snap();
    if (!stablePair(s)) throw new Error('Socket pair changed during baseline warm-up');
    if (Number.isFinite(s.wf)) best = Math.max(best, s.wf);
    const target = Number.isFinite(s.target) && s.target > 0 ? s.target : 23;
    good = Number.isFinite(s.wf) && s.wf / target >= GOOD_RATIO ? good + 1 : 0;
    statusEl.textContent = `Baseline warm-up: ${fmt(s.wf)} / ${fmt(target,0)} FPS · best ${fmt(best)} · ${good}/${BASELINE_GOOD_SAMPLES} healthy · ${loadText(loadStart)}`;
    if (good >= BASELINE_GOOD_SAMPLES) {
      return { healthy: true, best, target, loadStart, loadReady: await loadSnapshot() };
    }
    await sleep(1000);
  }
  return { healthy: false, best, target: snap().target || 23, loadStart, loadReady: await loadSnapshot() };
}

async function waitForRecovery(stageLabel) {
  const started = performance.now();
  const deadline = started + STAGE_RECOVERY_TIMEOUT_MS;
  let good = 0;
  let best = 0;
  while (performance.now() < deadline) {
    const s = snap();
    if (!stablePair(s)) return { recovered:false, recoveryMs:performance.now()-started, best, pairStable:false };
    const target = Number.isFinite(s.target) && s.target > 0 ? s.target : 23;
    if (Number.isFinite(s.wf)) best = Math.max(best, s.wf);
    good = Number.isFinite(s.wf) && s.wf / target >= GOOD_RATIO ? good + 1 : 0;
    statusEl.textContent = `${stageLabel}: waiting for W/F recovery · ${fmt(s.wf)} / ${fmt(target,0)} · ${good}/${STAGE_GOOD_SAMPLES}`;
    if (good >= STAGE_GOOD_SAMPLES) return { recovered:true, recoveryMs:performance.now()-started, best, pairStable:true };
    await sleep(1000);
  }
  return { recovered:false, recoveryMs:performance.now()-started, best, pairStable:stablePair() };
}

async function runStage(stage, index) {
  const preset = document.querySelector(`[data-preset="${stage.preset}"]`);
  if (!preset || preset.disabled) throw new Error(`Preset ${stage.preset} unavailable`);
  statusEl.textContent = `Stage ${index+1}/${TEST_STAGES.length}: ${stage.label} — retuning…`;
  preset.click();
  await sleep(450);
  if (stage.mode) {
    const mode = document.querySelector(`[data-mode="${stage.mode}"]`);
    if (!mode || mode.disabled) throw new Error(`Mode ${stage.mode} unavailable`);
    mode.click();
  }

  const loadBefore = await loadSnapshot();
  const recovery = await waitForRecovery(stage.label);
  const samples = [];
  for (let i = 0; i < MEASURE_SAMPLES; i += 1) {
    const s = snap();
    samples.push(s);
    if (!stablePair(s)) break;
    statusEl.textContent = `Stage ${index+1}/${TEST_STAGES.length}: ${stage.label} · sample ${i+1}/${MEASURE_SAMPLES} · W/F ${fmt(s.wf)} / ${fmt(s.target,0)} · SND ${fmt(s.snd)}`;
    await sleep(1000);
  }
  const loadAfter = await loadSnapshot();
  const wf = samples.map((s) => s.wf);
  const target = samples.map((s) => s.target).find(Number.isFinite) ?? 23;
  return {
    ...stage,
    target,
    recovered: recovery.recovered,
    recoverySec: recovery.recoveryMs / 1000,
    wfAvg: avg(wf), wfMin: min(wf), wfMax: max(wf),
    sndAvg: avg(samples.map((s) => s.snd)),
    pairStable: samples.length === MEASURE_SAMPLES && samples.every(stablePair),
    loadBefore, loadAfter
  };
}

function classify(r) {
  if (!r.pairStable) return 'fail';
  const ratio = r.wfAvg / (r.target || 23);
  if (!r.recovered) return ratio >= WARN_RATIO ? 'warn' : 'fail';
  if (ratio >= GOOD_RATIO && r.recoverySec <= 10) return 'pass';
  if (ratio >= WARN_RATIO) return 'warn';
  return 'fail';
}

function renderInconclusive(baseline) {
  resultsEl.hidden = false;
  resultsEl.innerHTML = `<div class="auto-summary inconclusive">INCONCLUSIVE — W/F baseline never reached 70% of target before any retunes · best ${fmt(baseline.best)} / ${fmt(baseline.target,0)} FPS · load ${loadText(baseline.loadStart)} → ${loadText(baseline.loadReady)} · pair ${stablePair() ? 'STABLE' : 'CHANGED'}</div>`;
  statusEl.textContent = 'INCONCLUSIVE: receiver cadence was already degraded before the first band change. No retune verdict was assigned.';
}

function renderResults(results, baseline) {
  resultsEl.hidden = false;
  const rows = results.map((r) => {
    const level = classify(r);
    const load = Number.isFinite(r.loadAfter.users) ? `${r.loadAfter.users}/${r.loadAfter.usersMax}` : '—';
    return `<div class="auto-row ${level}"><b>${r.label}</b><span>WF ${fmt(r.wfAvg)}</span><span>REC ${fmt(r.recoverySec)}s</span><span>LOAD ${load}</span><span>${level.toUpperCase()}</span></div>`;
  }).join('');
  const levels = results.map(classify);
  const pairOk = results.every((r) => r.pairStable);
  const overall = !pairOk || levels.includes('fail') ? 'fail' : levels.includes('warn') ? 'warn' : 'pass';
  const title = overall === 'pass' ? 'PASS — full-range retune recovery healthy' : overall === 'warn' ? 'PASS WITH W/F RECOVERY WARNINGS' : 'FAIL — W/F recovery/session problem detected';
  const target = results.map((r) => r.target).find(Number.isFinite) ?? baseline.target ?? 23;
  const overallWf = avg(results.map((r) => r.wfAvg));
  resultsEl.innerHTML = `${rows}<div class="auto-summary ${overall}">${title} · average W/F ${fmt(overallWf)} / ${fmt(target,0)} FPS · pair ${pairOk ? 'STABLE' : 'CHANGED'} · baseline best ${fmt(baseline.best)} · baseline load ${loadText(baseline.loadStart)} → ${loadText(baseline.loadReady)}</div>`;
  statusEl.textContent = `${title}. Screenshot this result block.`;
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
    const baseline = await waitForHealthyBaseline();
    if (!baseline.healthy) {
      renderInconclusive(baseline);
      return;
    }
    const results = [];
    for (let i = 0; i < TEST_STAGES.length; i += 1) {
      const result = await runStage(TEST_STAGES[i], i);
      results.push(result);
      if (!result.pairStable) break;
    }
    renderResults(results, baseline);
  } catch (error) {
    statusEl.textContent = `AUTO TEST STOPPED: ${error?.message || 'unknown error'}`;
    resultsEl.hidden = false;
    resultsEl.innerHTML = `<div class="auto-summary fail">FAIL — ${String(error?.message || 'unknown error')}</div>`;
  } finally {
    running = false;
    runButton.disabled = false;
  }
});
