// FREQBEACON Zero qualification bench — high-band isolation test.
// Bench/test harness only. Uses existing preset/mode controls and cadence diagnostics.
// No direct Kiwi protocol changes, no renderer changes, no socket lifecycle changes, no /zero changes.

const HIGH_STAGES = Object.freeze([
  { label: '20m · USB CONTROL', preset: '20m', mode: 'usb' },
  { label: 'CB 19 · AM', preset: 'cb', mode: 'am' },
  { label: '29.600 · AM', preset: '10fm', mode: 'am' },
  { label: '29.600 · USB', mode: 'usb' },
  { label: '29.600 · NBFM', mode: 'nbfm' },
  { label: 'CB 19 · AM RETURN', preset: 'cb', mode: 'am' },
  { label: '20m · USB RETURN', preset: '20m', mode: 'usb' },
  { label: 'MW · AM RETURN', preset: 'mw', mode: 'am' }
]);

const GOOD_RATIO = 0.70;
const WARN_RATIO = 0.35;
const HEALTHY_SAMPLES = 3;
const RECOVERY_TIMEOUT_MS = 20000;
const BASELINE_TIMEOUT_MS = 90000;
const MEASURE_SAMPLES = 5;
const sleepHigh = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function highNumber(text) {
  const m = String(text || '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

function highSnap() {
  const wfText = document.querySelector('[data-bench-wf-fps]')?.textContent || '';
  const parts = wfText.split('/');
  return {
    wf: highNumber(parts[0]),
    target: parts.length > 1 ? highNumber(parts[1]) : NaN,
    snd: highNumber(document.querySelector('[data-bench-snd-fps]')?.textContent),
    pair: document.querySelector('#pairProof')?.textContent?.trim() || '',
    sockets: document.querySelector('#socketProof')?.textContent?.trim() || ''
  };
}

function highPairStable(s = highSnap()) {
  return s.pair.includes('STABLE') && s.sockets === '1 SND · 1 W/F';
}

function highAvg(values) {
  const a = values.filter(Number.isFinite);
  return a.length ? a.reduce((sum, value) => sum + value, 0) / a.length : NaN;
}

function highFmt(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

async function highLoad() {
  try {
    const response = await fetch('/api/zero-bench/diagnostics', { cache: 'no-store' });
    const data = await response.json();
    return {
      users: Number(data?.status?.users),
      max: Number(data?.status?.users_max)
    };
  } catch {
    return { users: NaN, max: NaN };
  }
}

function highLoadText(load) {
  return Number.isFinite(load.users) && Number.isFinite(load.max) ? `${load.users}/${load.max}` : '—';
}

const highAnchor = document.querySelector('#lastAction');
const highPanel = document.createElement('section');
highPanel.className = 'bench-auto bench-highband';
highPanel.setAttribute('aria-label', 'High-band waterfall isolation');
highPanel.innerHTML = `
  <div class="bench-auto-head">
    <div><small>HIGH-BAND ISOLATION</small><strong>Frequency vs mode vs elapsed-time proof</strong></div>
    <button type="button" data-high-run>RUN HIGH-BAND TEST</button>
  </div>
  <div class="bench-auto-status" data-high-status>Starts from a healthy 20m USB control, checks CB and 29.600 MHz in multiple modes, then returns to lower bands to see whether cadence recovers.</div>
  <div class="bench-auto-results" data-high-results hidden></div>
`;
highAnchor?.insertAdjacentElement('beforebegin', highPanel);

const highRunButton = highPanel.querySelector('[data-high-run]');
const highStatus = highPanel.querySelector('[data-high-status]');
const highResults = highPanel.querySelector('[data-high-results]');
let highRunning = false;

async function highEnsureStarted() {
  const power = document.querySelector('#power');
  if (!power) throw new Error('START button not found');
  if (!highPairStable()) {
    const label = power.querySelector('span')?.textContent?.trim() || power.textContent.trim();
    if (/START/i.test(label) && !power.disabled) power.click();
  }
  const deadline = performance.now() + 20000;
  while (performance.now() < deadline) {
    if (highPairStable()) return;
    await sleepHigh(500);
  }
  throw new Error('Socket pair did not become stable within 20 seconds');
}

function clickHighStage(stage) {
  if (stage.preset) {
    const preset = document.querySelector(`[data-preset="${stage.preset}"]`);
    if (!preset || preset.disabled) throw new Error(`Preset ${stage.preset} unavailable`);
    preset.click();
  }
  if (stage.mode) {
    const mode = document.querySelector(`[data-mode="${stage.mode}"]`);
    if (!mode || mode.disabled) throw new Error(`Mode ${stage.mode} unavailable`);
    mode.click();
  }
}

async function waitHealthy(label, timeoutMs) {
  const started = performance.now();
  const deadline = started + timeoutMs;
  let good = 0;
  let best = 0;
  while (performance.now() < deadline) {
    const s = highSnap();
    if (!highPairStable(s)) return { healthy: false, best, sec: (performance.now() - started) / 1000, pairStable: false };
    const target = Number.isFinite(s.target) && s.target > 0 ? s.target : 23;
    if (Number.isFinite(s.wf)) best = Math.max(best, s.wf);
    good = Number.isFinite(s.wf) && s.wf / target >= GOOD_RATIO ? good + 1 : 0;
    highStatus.textContent = `${label}: W/F ${highFmt(s.wf)} / ${highFmt(target, 0)} · healthy ${good}/${HEALTHY_SAMPLES} · best ${highFmt(best)}`;
    if (good >= HEALTHY_SAMPLES) {
      return { healthy: true, best, sec: (performance.now() - started) / 1000, pairStable: true };
    }
    await sleepHigh(1000);
  }
  return { healthy: false, best, sec: (performance.now() - started) / 1000, pairStable: highPairStable() };
}

async function measureHighStage(stage, index) {
  highStatus.textContent = `Stage ${index + 1}/${HIGH_STAGES.length}: ${stage.label}`;
  clickHighStage(stage);
  const loadBefore = await highLoad();
  const recovery = await waitHealthy(stage.label, RECOVERY_TIMEOUT_MS);
  const samples = [];
  for (let i = 0; i < MEASURE_SAMPLES; i += 1) {
    const s = highSnap();
    samples.push(s);
    if (!highPairStable(s)) break;
    highStatus.textContent = `Stage ${index + 1}/${HIGH_STAGES.length}: ${stage.label} · sample ${i + 1}/${MEASURE_SAMPLES} · W/F ${highFmt(s.wf)} / ${highFmt(s.target, 0)}`;
    await sleepHigh(1000);
  }
  const loadAfter = await highLoad();
  const target = samples.map((s) => s.target).find(Number.isFinite) ?? 23;
  return {
    ...stage,
    target,
    recovered: recovery.healthy,
    recoverySec: recovery.sec,
    best: recovery.best,
    wfAvg: highAvg(samples.map((s) => s.wf)),
    sndAvg: highAvg(samples.map((s) => s.snd)),
    pairStable: samples.length === MEASURE_SAMPLES && samples.every(highPairStable),
    loadBefore,
    loadAfter
  };
}

function highClassify(result) {
  if (!result.pairStable) return 'fail';
  const ratio = result.wfAvg / (result.target || 23);
  if (result.recovered && ratio >= GOOD_RATIO) return 'pass';
  if (ratio >= WARN_RATIO) return 'warn';
  return 'fail';
}

function diagnoseHighPattern(results) {
  const byLabel = Object.fromEntries(results.map((r) => [r.label, r]));
  const control = byLabel['20m · USB CONTROL'];
  const cb = byLabel['CB 19 · AM'];
  const am296 = byLabel['29.600 · AM'];
  const usb296 = byLabel['29.600 · USB'];
  const fm296 = byLabel['29.600 · NBFM'];
  const back20 = byLabel['20m · USB RETURN'];
  const backMw = byLabel['MW · AM RETURN'];

  const good = (r) => r && r.wfAvg / (r.target || 23) >= GOOD_RATIO;
  const low = (r) => r && r.wfAvg / (r.target || 23) < WARN_RATIO;
  const degraded = (r) => r && r.wfAvg / (r.target || 23) < GOOD_RATIO;

  if (good(control) && degraded(cb) && degraded(am296) && good(back20)) {
    return 'PATTERN: HIGH-FREQUENCY W/F DEGRADATION — cadence falls near 27–30 MHz and recovers after returning lower. Mode is not the primary trigger.';
  }
  if (good(am296) && good(usb296) && low(fm296) && good(back20)) {
    return 'PATTERN: NBFM-SPECIFIC — 29.600 MHz remains healthy in AM/USB but degrades in NBFM.';
  }
  if (degraded(am296) && degraded(usb296) && degraded(fm296) && good(back20)) {
    return 'PATTERN: 29.600-MHz FREQUENCY PATH — all three modes degrade at the same center frequency, then lower-band cadence recovers.';
  }
  if (degraded(cb) && degraded(am296) && degraded(back20) && degraded(backMw)) {
    return 'PATTERN: CUMULATIVE/RECEIVER LOAD — cadence does not recover after returning to lower frequencies.';
  }
  return 'PATTERN: MIXED — use the per-stage W/F and load values below; no single trigger dominates this run.';
}

function renderHighResults(results, baseline, baselineLoad) {
  highResults.hidden = false;
  const rows = results.map((r) => {
    const level = highClassify(r);
    return `<div class="auto-row ${level}"><b>${r.label}</b><span>WF ${highFmt(r.wfAvg)}</span><span>REC ${highFmt(r.recoverySec)}s</span><span>LOAD ${highLoadText(r.loadAfter)}</span><span>${level.toUpperCase()}</span></div>`;
  }).join('');
  const pattern = diagnoseHighPattern(results);
  const pairOk = results.every((r) => r.pairStable);
  const klass = pattern.includes('MIXED') ? 'warn' : 'pass';
  highResults.innerHTML = `${rows}<div class="auto-summary ${klass}">${pattern} · baseline ${highFmt(baseline.best)} / 23 FPS · baseline load ${highLoadText(baselineLoad)} · pair ${pairOk ? 'STABLE' : 'CHANGED'}</div>`;
  highStatus.textContent = 'High-band isolation complete. Screenshot this result block.';
}

highRunButton?.addEventListener('click', async () => {
  if (highRunning) return;
  highRunning = true;
  highRunButton.disabled = true;
  highResults.hidden = true;
  highResults.innerHTML = '';
  try {
    await highEnsureStarted();

    // Establish the baseline at 20m USB so current page state cannot bias the run.
    clickHighStage({ preset: '20m', mode: 'usb' });
    const baselineLoad = await highLoad();
    const baseline = await waitHealthy('20m USB baseline', BASELINE_TIMEOUT_MS);
    if (!baseline.healthy) {
      highResults.hidden = false;
      highResults.innerHTML = `<div class="auto-summary inconclusive">INCONCLUSIVE — 20m USB control never reached a healthy baseline · best ${highFmt(baseline.best)} / 23 FPS · load ${highLoadText(baselineLoad)} · pair ${baseline.pairStable ? 'STABLE' : 'CHANGED'}</div>`;
      highStatus.textContent = 'INCONCLUSIVE: receiver cadence was degraded before the high-band isolation sequence.';
      return;
    }

    const results = [];
    for (let i = 0; i < HIGH_STAGES.length; i += 1) {
      const result = await measureHighStage(HIGH_STAGES[i], i);
      results.push(result);
      if (!result.pairStable) break;
    }
    renderHighResults(results, baseline, baselineLoad);
  } catch (error) {
    highStatus.textContent = `HIGH-BAND TEST STOPPED: ${error?.message || 'unknown error'}`;
    highResults.hidden = false;
    highResults.innerHTML = `<div class="auto-summary fail">FAIL — ${String(error?.message || 'unknown error')}</div>`;
  } finally {
    highRunning = false;
    highRunButton.disabled = false;
  }
});
