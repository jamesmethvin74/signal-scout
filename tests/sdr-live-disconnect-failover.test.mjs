import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const health = readFileSync(new URL('../sdr-health.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');

assert.match(health, /STABLE_SUCCESS_MS = 30 \* 1000/);
assert.match(health, /SHORT_LIVE_SESSION_MS = 30 \* 1000/);
assert.match(health, /if \(socket\.readyState === NativeWebSocket\.OPEN\) markStableSuccess\(\)/);
assert.match(health, /markFailure\(receiverId, 'disconnect'\)/);
assert.match(health, /Signal Scout disconnect/);
assert.match(health, /passive-health-v4/);
assert.doesNotMatch(health, /gotAudio = true;\s*firstAudioAt = now\(\);\s*markSuccess\(receiverId\)/);

assert.match(worker, /sdr-player-live-disconnect-failover-v1/);
assert.match(worker, /The public receiver disconnected\. Trying the next ranked receiver…/);
assert.match(worker, /x-freqbeacon-sdr-player-failover/);
assert.doesNotMatch(worker, /The public receiver disconnected\. Tap Play to reconnect\./);

console.log('stable-session SDR health and live failover guard passed');