import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const options = fs.readFileSync(new URL('../sdr-options-fix-v4.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

test('dynamic ReceiverBook response is authoritative and built-in catalog is fallback only', () => {
  assert.match(options, /const upstreamFetch = window\.fetch\.bind\(window\)/);
  assert.match(options, /const DYNAMIC_TIMEOUT_MS = 3000/);
  assert.match(options, /const dynamic = upstreamFetch\(input, init\)/);
  assert.match(options, /Promise\.race\(\[dynamic, timeout\]\)/);
  assert.match(options, /fallbackResponse\(url\)/);
  assert.doesNotMatch(options, /source:\s*'instant-local-options'/);
  assert.match(options, /\+listening-path-v4/);
});

test('HF listening rerank uses transmitter proximity plus corridor detour', () => {
  assert.match(options, /function rerankForListening\(receivers, url\)/);
  assert.match(options, /function stationSignalScore\(distance\)/);
  assert.match(options, /userDistance \+ txDistance - direct/);
  assert.match(options, /station \* 0\.45 \+ path \* 0\.30 \+ proximity \* 0\.15 \+ solar \* 0\.10/);
  assert.match(options, /role === 'STATION CHECK' \? 8/);
});

test('weak AM static is not treated as a successful listening receiver', () => {
  assert.match(options, /const WEAK_RSSI_DB = -109/);
  assert.match(options, /const SIGNAL_CHECK_MS = 2600/);
  assert.match(options, /const MIN_SIGNAL_SAMPLES = 6/);
  assert.match(options, /const MAX_WEAK_SWITCHES = 4/);
  assert.match(options, /frequency < 2000 \|\| !\['am', 'sam'\]\.includes\(mode\)/);
  assert.match(options, /switchFromWeakReceiver\(receiverName, rssi\)/);
  assert.match(options, /event\.isTrusted && event\.target\.closest\('\[data-sdr-choice-index\]'\)/);
  assert.match(options, /quality\.manualOverride = true/);
});

test('worker loads v4 before existing reliability layer without changing RF protocol files', () => {
  assert.match(worker, /sdr-options-fix-v4\.js\?v=1/);
  assert.match(worker, /dynamic-options-v4-before-reliability/);
  assert.doesNotMatch(worker, /sdr-options-fix\.js\?v=3/);
});

test('browser options script parses as JavaScript', () => {
  assert.doesNotThrow(() => new Function(options));
});
