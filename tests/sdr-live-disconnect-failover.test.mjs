import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const health = readFileSync(new URL('../sdr-health.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');

assert.match(health, /SHORT_LIVE_SESSION_MS = 30 \* 1000/);
assert.match(health, /Number\(event\?\.code \|\| 0\) === 1006/);
assert.match(health, /markFailure\(receiverId, 'disconnect'\)/);
assert.match(health, /passive-health-v3/);
assert.match(worker, /sdr-player-live-disconnect-failover-v1/);
assert.match(worker, /The public receiver disconnected\. Trying the next ranked receiver…/);
assert.match(worker, /x-freqbeacon-sdr-player-failover/);
assert.doesNotMatch(worker, /The public receiver disconnected\. Tap Play to reconnect\./);

console.log('live SDR disconnect failover guard passed');
