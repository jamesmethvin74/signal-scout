import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const reliability = readFileSync(new URL('../sdr-live-reliability-v2.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');

assert.match(reliability, /const PROBE_LIMIT = 3;/);
assert.match(reliability, /const PROBE_TIMEOUT_MS = 1800;/);
assert.match(reliability, /const PROBE_FAILURE_CACHE_MS = 5 \* 60 \* 1000;/);
assert.match(reliability, /\/api\/sdr\/probe\?receiver=/);
assert.match(reliability, /Promise\.all\(candidates\.map\(probeReceiver\)\)/);
assert.match(reliability, /distanceMiles\(receiver\) <= 1800/);
assert.match(reliability, /if \(!reachable\.size\)/);
assert.match(reliability, /recommended: index === 0/);
assert.match(reliability, /connectionHealth: reachable\.has\(receiver\.id\)/);
assert.doesNotMatch(reliability, /km4rt|tipton/i);

assert.match(worker, /url\.pathname === '\/api\/sdr\/probe'/);
assert.match(worker, /webSocketAccepted/);
assert.match(worker, /proxySafeTimestamp/);

console.log('SDR reachability preflight guard passed');
