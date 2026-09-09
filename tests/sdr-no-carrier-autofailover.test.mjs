import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const worker = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const playerWorker = fs.readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');

test('connected SDR sessions are not rejected by automatic carrier interpretation', () => {
  assert.doesNotMatch(worker, /patchRfCarrierSignal/);
  assert.doesNotMatch(worker, /freqbeacon:rf-carrier/);
  assert.doesNotMatch(playerWorker, /PLAYER_CARRIER_MARKER/);
  assert.doesNotMatch(playerWorker, /carrierAutoAllowed/);
  assert.doesNotMatch(playerWorker, /No usable carrier was heard at the tuned frequency/);
  assert.doesNotMatch(playerWorker, /CARRIER_STARTUP_GRACE_MS/);
  assert.doesNotMatch(playerWorker, /SHORT_LIVE_RETRY_MS/);
});

test('known-good receiver connection lifecycle and Kiwi transport remain intact', () => {
  assert.match(playerWorker, /known-good-connect-lifecycle-v1/);
  assert.match(playerWorker, /const NEW_TSTAMP_SPACE = 1n << 62n/);
  assert.match(playerWorker, /\/ws\/kiwi\/\$\{upstreamTimestamp\}\/\$\{stream\}/);
  assert.match(playerWorker, /stream=SND/);
  assert.doesNotMatch(playerWorker, /instant-local-options/);
});

test('worker sources still parse as JavaScript', () => {
  assert.doesNotThrow(() => new Function(worker.replace(/^import .*$/gm, '').replace(/export default/g, 'void')));
  assert.doesNotThrow(() => new Function(playerWorker.replace(/^import .*$/gm, '').replace(/export default/g, 'void')));
});
