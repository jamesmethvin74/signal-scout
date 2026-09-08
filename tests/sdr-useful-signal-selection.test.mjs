import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const worker = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const reliability = fs.readFileSync(new URL('../sdr-live-reliability-v2.js', import.meta.url), 'utf8');

test('production HTML does not inject a client-side receiver-ranking override', () => {
  assert.doesNotMatch(worker, /sdr-options-fix(?:-v\d+)?\.js/);
  assert.doesNotMatch(worker, /applySdrReliabilityFetchOrder/);
  assert.match(worker, /server-ranking-known-good-control-v1/);
});

test('normal broadcast reliability does not preflight or reorder via probe sockets', () => {
  assert.doesNotMatch(reliability, /PROBE_LIMIT|PROBE_TIMEOUT_MS|probeReceiver|preferReachableReceivers|\/api\/sdr\/probe/);
  assert.match(reliability, /available = payload\.receivers\.filter/);
  assert.match(reliability, /cooldownUntil/);
});

test('automatic chooser clicking remains ham RF-only', () => {
  assert.match(reliability, /function tryNextHamRfReceiver/);
  assert.match(reliability, /if \(!hamViewActive\(\) \|\| rfFallback\.busy \|\| !rfFailureText\(messageText\)\) return/);
  assert.match(reliability, /receiverButton\?\.click\(\)/);
  assert.doesNotMatch(reliability, /WEAK_RSSI_DB|weak-signal-switch|switchFromWeakReceiver/);
});

test('known-good reliability script still parses', () => {
  assert.doesNotThrow(() => new Function(reliability));
});
