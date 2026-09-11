import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const rf = readFileSync(new URL('../sdr-rf-v2.js', import.meta.url), 'utf8');
const exploreCss = readFileSync(new URL('../freqbeacon-explore.css', import.meta.url), 'utf8');

// The proven RF source requests Kiwi's standard cadence. The Worker must not
// accelerate it back to the 23 FPS experiment that preceded receiver churn.
assert.match(rf, /send\('SET wf_speed=2'\);/);
assert.match(worker, /function patchRfStabilityRate\(source\)/);
assert.match(worker, /send\('SET wf_speed=4'\).*send\('SET wf_speed=2'\)/s);
assert.match(worker, /x-freqbeacon-rf-rate', 'stability-standard-v1'/);
assert.doesNotMatch(worker, /x-freqbeacon-rf-rate', 'fast-23fps-v1'/);

// Once a receiver has actually gone live, a socket close should stop there and
// let the listener reconnect instead of silently hopping to another SDR.
assert.match(worker, /'\/sdr-player\.js'/);
assert.match(worker, /function patchPlayerStableLiveDisconnect\(source\)/);
assert.match(worker, /The public receiver disconnected\. Tap Play to reconnect\./);
assert.match(worker, /x-freqbeacon-sdr-player-session', 'session-sticky-v1'/);

// The tuner-first page should keep the RF canvas compact instead of stretching
// it to the full start-screen height, which distorted the visual proportions.
assert.match(exploreCss, /height:240px!important/);
assert.match(exploreCss, /height:210px!important/);
assert.doesNotMatch(exploreCss, /sdr-rf-v2-spectrum[^\n]*height:clamp\(330px,50vh,530px\)/);

console.log('stable waterfall cadence, session ownership, and proportions guard passed');
