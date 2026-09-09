import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const worker = fs.readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');

test('carrier-unavailable evidence waits through RF startup instead of instant failover', () => {
  assert.match(worker, /const CARRIER_STARTUP_GRACE_MS = 12000/);
  assert.match(worker, /sdr\.carrierCheckStartedAt = Date\.now\(\)/);
  assert.match(worker, /elapsed < CARRIER_STARTUP_GRACE_MS/);
  assert.match(worker, /sdr\.carrierGraceTimer = window\.setTimeout/);
  assert.match(worker, /currentReceiver\(\)\?\.id !== expectedReceiverId/);
  assert.match(worker, /handleRfCarrier\(\{ detail: \{ \.\.\.deferredDetail, at: Date\.now\(\) \} \}\)/);
});

test('a live stream that dies immediately retries the same receiver once before ranked failover', () => {
  assert.match(worker, /const SHORT_LIVE_RETRY_MS = 8000/);
  assert.match(worker, /sdr\.liveStartedAt = Date\.now\(\)/);
  assert.match(worker, /Number\(sdr\.shortDisconnectRetries \|\| 0\) < 1/);
  assert.match(worker, /const retryIndex = sdr\.receiverIndex/);
  assert.match(worker, /Retrying the same receiver once before moving on/);
  assert.match(worker, /window\.setTimeout\(\(\) => connectSdr\(retryIndex\), 700\)/);
  assert.match(worker, /failCurrentReceiver\('The public receiver disconnected\. Trying the next ranked receiver…'\)/);
});

test('stability patch remains bounded and leaves Kiwi proxy pairing untouched', () => {
  assert.match(worker, /sdr\.shortDisconnectRetries = 0/);
  assert.match(worker, /window\.clearTimeout\(sdr\.carrierGraceTimer\)/);
  assert.match(worker, /const NEW_TSTAMP_SPACE = 1n << 62n/);
  assert.match(worker, /\/ws\/kiwi\/\$\{upstreamTimestamp\}\/\$\{stream\}/);
  assert.doesNotMatch(worker, /instant-local-options/);
});

test('worker source parses as JavaScript', () => {
  assert.doesNotThrow(() => new Function(worker.replace(/^import .*$/gm, '').replace(/export default/g, 'void')));
});
