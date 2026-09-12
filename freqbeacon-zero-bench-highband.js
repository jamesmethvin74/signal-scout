// FREQBEACON Zero qualification bench — high-band isolation test v2.
// Bench/test harness only. Uses existing preset/mode controls and cadence diagnostics.
// No direct Kiwi protocol changes, no renderer changes, no socket lifecycle changes, no /zero changes.

const HIGH2_STAGES = Object.freeze([
  { label: '20m · USB CONTROL', preset: '20m', mode: 'usb' },
  { label: 'CB 19 · AM', preset: 'cb', mode: 'am' },
  { label: '29.600 · AM', preset: '10fm', mode: 'am' },
  { label: '29.600 · USB', mode: 'usb' },
  { label: '29.600 · NBFM', mode: 'nbfm' },
  { label: 'CB 19 · AM RETURN', preset: 'cb', mode: 'am' },
  { label: '20m · USB RETURN', preset: '20m', mode: 'usb' },
  { label: 'MW · AM RETURN', preset: 'mw', mode: 'am' }
]);

const HIGH2_GOOD_RATIO = 0.70;
const HIGH2_WARN_RATIO = 0.35;
const HIGH2_WINDOW = 5;
const HIGH2_REQUIRED_GOOD = 3;
const HIGH2_RECOVERY_TIMEOUT_MS = 20000;
const HIGH2_BASELINE_TIMEOUT_MS = 90000;
const HIGH2_MEASURE_SAMPLES = 5;
const HIGH2_SETTLE_MS = 1800;
const high2Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function high2Number(text) {
  const m = String(text || '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : NaN;
}

function high2Snap() {
  const wfText = document.querySelector('[data-bench-wf-fps]')?.textContent || '';
  const parts = wfText.split('/');
  return {
    wf: high2Number(parts[0]),
    target: parts.length > 1 ? high2Number(parts[1]) : NaN,
    snd: high2Number(document.querySelector('[data-bench-snd-fps]')?.textContent),
    pair: document.querySelector('#pairProof')?.textContent?.trim() || '',
    sockets: document.querySelector('#socketProof')?.textContent?.trim() || ''
  };
}

function high2PairStable(s = high2Snap()) {
  return s.pair.includes('STABLE') && s.sockets === '1 SND · 1 W/F';
}

function high2Avg(values) {
  const a = values.filter(Number.isFinite);
  return a.length ? a.reduce((sum, value) => sum + value, 0) / a.length : NaN;
}

function high2Min(values) {
  const a = values.filter(Number.isFinite);
  return a.length ? Math.min(...a) : NaN;
}

function high2Max(values) {
  const a = values.filter(Number.isFinite);
  return a.length ? Math.max(...a) : NaN;
}

function high2Fmt(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

async function high2Load() {
  try {
    const response = await fetch('/api/zero-bench/diagnostics', { cache: 'no-store' });
    const data = await response.json();
    return { users: Number(data?.status?.users), max: Number(data?.status?.users_max) };
  } catch {
    return { users: NaN, max: NaN };
  }
}

function high2LoadText(load) {
  return Number.isFinite(load.users) && Number.isFinite(load.max) ? `${load.users}/${load.max}` : '—';
}

function high2WindowStats(samples, target) {
  const finite = samples.filter(Number.isFinite);
  const threshold = target * HIGH2_GOOD_RATIO;
  const avg = high2Avg(finite);
  const goodCount = finite.filter((value) => value >= threshold).length;
  return {
    avg,
    min: high2Min(finite),
    max: high2Max(finite),
    goodCount,
    healthy: finite.length >= HIGH2_WINDOW && avg >= threshold && goodCount >= HIGH2_REQUIRED_GOOD
  };
}

const high2Anchor = document.querySelector('#lastAction');
const high2Panel = document.createElement('section');
high2Panel.className = 'bench-auto bench-highband';
high2Panel.setAttribute('aria-label', 'High-band waterfall isolation v2');
high2Panel.innerHTML = `
  <div class="bench-auto-head">
    <div><small>HIGH-BAND ISOLATION V2</small><strong>Frequency vs mode vs elapsed-time proof</strong></div>
    <button type="button" data-high2-run>RUN HIGH-BAND TEST</button>
  </div>
  <div class="bench-auto-status" data-high2-status>Uses a 5-second rolling cadence window instead of requiring perfect consecutive seconds. Starts at 20m USB, tests 27–30 MHz in multiple modes, then returns lower.</div>
  <div class="bench-auto-results" data-high2-results hidden></div>
`;
high2Anchor?.insertAdjacentElement('beforebegin', high2Panel);

const high2RunButton = high2Panel.querySelector('[data-high2-run]');
const high2Status = high2Panel.querySelector('[data-high2-status]');
const high2Results = high2Panel.querySelector('[data-high2-results]');
let high2Running = false;

async function high2EnsureStarted() {
  const power = document.querySelector('#power');
  if (!power) throw new Error('START button not found');
  if (!high2PairStable()) {
    const label = power.querySelector('span')?.textContent?.trim() || power.textContent.trim();
    if (/START/i.test(label) && !power.disabled) power.click();
  }
  const deadline = performance.now() + 20000;
  while (performance.now() < deadline) {
    if (high2PairStable()) return;
    await high2Sleep(500);
  }
  throw new Error('Socket pair did not become stable within 20 seconds');
}

function clickHigh2Stage(stage) {
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

async function waitHealthyWindow(label, timeoutMs) {
  const started = performance.now();
  const deadline = started + timeoutMs;
  const rolling = [];
  let best = 0;
  let bestWindowAvg = 0;

  while (performance.now() < deadline) {
    const s = high2Snap();
    if (!high2PairStable(s)) {
      return { healthy: false, best, bestWindowAvg, sec: (performance.now() - started) / 1000, pairStable: false };
    }

    const target = Number.isFinite(s.target) && s.target > 0 ? s.target : 23;
    if (Number.isFinite(s.wf)) {
      best = Math.max(best, s.wf);
      rolling.push(s.wf);
      if (rolling.length > HIGH2_WINDOW) rolling.shift();
    }

    const stats = high2WindowStats(rolling, target);
    if (Number.isFinite(stats.avg)) bestWindowAvg = Math.max(bestWindowAvg, stats.avg);
    high2Status.textContent = `${label}: W/F ${high2Fmt(s.wf)} / ${high2Fmt(target, 0)} · 5s avg ${high2Fmt(stats.avg)} · good ${stats.goodCount}/${HIGH2_WINDOW} · best ${high2Fmt(best)}`;

    if (stats.healthy) {
      return {
        healthy: true,
        best,
        bestWindowAvg,
        windowAvg: stats.avg,
        windowMin: stats.min,
        windowMax: stats.max,
        goodCount: stats.goodCount,
        sec: (performance.now() - started) / 1000,
        pairStable: true
      };
    }
    await high2Sleep(1000);
  }

  return { healthy: false, best, bestWindowAvg, sec: (performance.now() - started) / 1000, pairStable: high2PairStable() };
}

async function measureHigh2Stage(stage, index) {
  high2Status.textContent = `Stage ${index + 1}/${HIGH2_STAGES.length}: ${stage.label}`;
  clickHigh2Stage(stage);
  await high2Sleep(HIGH2_SETTLE_MS);
  const loadBefore = await high2Load();
  const recovery = await waitHealthyWindow(stage.label, HIGH2_RECOVERY_TIMEOUT_MS);
  const samples = [];

  for (let i = 0; i < HIGH2_MEASURE_SAMPLES; i += 1) {
    const s = high2Snap();
    samples.push(s);
    if (!high2PairStable(s)) break;
    high2Status.textContent = `Stage ${index + 1}/${HIGH2_STAGES.length}: ${stage.label} · sample ${i + 1}/${HIGH2_MEASURE_SAMPLES} · W/F ${high2Fmt(s.wf)} / ${high2Fmt(s.target, 0)}`;
    await high2Sleep(1000);
  }

  const loadAfter = await high2Load();
  const target = samples.map((s) => s.target).find(Number.isFinite) ?? 23;
  return {
    ...stage,
    target,
    recovered: recovery.healthy,
    recoverySec: recovery.sec,
    best: recovery.best,
    recoveryWindowAvg: recovery.windowAvg ?? recovery.bestWindowAvg,
    wfAvg: high2Avg(samples.map((s) => s.wf)),
    wfMin: high2Min(samples.map((s) => s.wf)),
    wfMax: high2Max(samples.map((s) => s.wf)),
    sndAvg: high2Avg(samples.map((s) => s.snd)),
    pairStable: samples.length === HIGH2_MEASURE_SAMPLES && samples.every(high2PairStable),
    loadBefore,
    loadAfter
  };
}

function high2Classify(result) {
  if (!result.pairStable) return 'fail';
  const ratio = result.wfAvg / (result.target || 23);
  if (result.recovered && ratio >= HIGH2_GOOD_RATIO) return 'pass';
  if (ratio >= HIGH2_WARN_RATIO) return 'warn';
  return 'fail';
}

function diagnoseHigh2Pattern(results) {
  const byLabel = Object.fromEntries(results.map((r) => [r.label, r]));
  const control = byLabel['20m · USB CONTROL'];
  const cb = byLabel['CB 19 · AM'];
  const am296 = byLabel['29.600 · AM'];
  const usb296 = byLabel['29.600 · USB'];
  const fm296 = byLabel['29.600 · NBFM'];
  const back20 = byLabel['20m · USB RETURN'];
  const backMw = byLabel['MW · AM RETURN'];

  const good = (r) => r && r.wfAvg / (r.target || 23) >= HIGH2_GOOD_RATIO;
  const low = (r) => r && r.wfAvg / (r.target || 23) < HIGH2_WARN_RATIO;
  const degraded = (r) => r && r.wfAvg / (r.target || 23) < HIGH2_GOOD_RATIO;

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

function renderHigh2Results(results, baseline, baselineLoad) {
  high2Results.hidden = false;
  const rows = results.map((r) => {
    const level = high2Classify(r);
    return `<div class="auto-row ${level}"><b>${r.label}</b><span>WF ${high2Fmt(r.wfAvg)}</span><span>REC ${high2Fmt(r.recoverySec)}s</span><span>LOAD ${high2LoadText(r.loadAfter)}</span><span>${level.toUpperCase()}</span></div>`;
  }).join('');
  const pattern = diagnoseHigh2Pattern(results);
  const pairOk = results.every((r) => r.pairStable);
  const klass = pattern.includes('MIXED') ? 'warn' : 'pass';
  high2Results.innerHTML = `${rows}<div class="auto-summary ${klass}">${pattern} · baseline 5s avg ${high2Fmt(baseline.windowAvg ?? baseline.bestWindowAvg)} / 23 FPS · baseline best ${high2Fmt(baseline.best)} · load ${high2LoadText(baselineLoad)} · pair ${pairOk ? 'STABLE' : 'CHANGED'}</div>`;
  high2Status.textContent = 'High-band isolation complete. Screenshot this result block.';
}

high2RunButton?.addEventListener('click', async () => {
  if (high2Running) return;
  high2Running = true;
  high2RunButton.disabled = true;
  high2Results.hidden = true;
  high2Results.innerHTML = '';
  try {
    await high2EnsureStarted();
    clickHigh2Stage({ preset: '20m', mode: 'usb' });
    await high2Sleep(HIGH2_SETTLE_MS);
    const baselineLoad = await high2Load();
    const baseline = await waitHealthyWindow('20m USB baseline', HIGH2_BASELINE_TIMEOUT_MS);

    if (!baseline.healthy) {
      high2Results.hidden = false;
      high2Results.innerHTML = `<div class="auto-summary inconclusive">INCONCLUSIVE — 20m USB did not sustain a healthy 5-second window · best ${high2Fmt(baseline.best)} / 23 FPS · best 5s avg ${high2Fmt(baseline.bestWindowAvg)} · load ${high2LoadText(baselineLoad)} · pair ${baseline.pairStable ? 'STABLE' : 'CHANGED'}</div>`;
      high2Status.textContent = 'INCONCLUSIVE: a single high FPS sample is not enough; the control must sustain a healthy rolling window before the high-band sequence starts.';
      return;
    }

    const results = [];
    for (let i = 0; i < HIGH2_STAGES.length; i += 1) {
      const result = await measureHigh2Stage(HIGH2_STAGES[i], i);
      results.push(result);
      if (!result.pairStable) break;
    }
    renderHigh2Results(results, baseline, baselineLoad);
  } catch (error) {
    high2Status.textContent = `HIGH-BAND TEST STOPPED: ${error?.message || 'unknown error'}`;
    high2Results.hidden = false;
    high2Results.innerHTML = `<div class="auto-summary fail">FAIL — ${String(error?.message || 'unknown error')}</div>`;
  } finally {
    high2Running = false;
    high2RunButton.disabled = false;
  }
});
