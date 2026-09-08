import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const options = readFileSync(new URL('../sdr-options-fix.js', import.meta.url), 'utf8');
const reliability = readFileSync(new URL('../sdr-live-reliability-v2.js', import.meta.url), 'utf8');

assert.match(worker, /function applySdrReliabilityFetchOrder\(html\)/);
assert.match(worker, /sdr-options-fix\.js\?v=3<\/script>\\n  <script src=\"sdr-live-reliability-v2\.js\?v=2/);
assert.match(worker, /x-freqbeacon-sdr-reliability-order/);
assert.match(worker, /options-before-reliability-v1/);

// The later receiver-ui dynamic load is harmless only because options-fix is idempotent.
assert.match(options, /__freqbeaconInstantReceiverOptionsV1/);

// Reliability must remain the layer that filters active broadcast cooldowns
// and then preflights the survivors.
assert.match(reliability, /cooldownUntil/);
assert.match(reliability, /preferReachableReceivers/);
assert.match(reliability, /\/api\/sdr\/probe/);

console.log('SDR reliability fetch-order guard passed');
