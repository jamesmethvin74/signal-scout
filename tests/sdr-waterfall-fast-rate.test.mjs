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

// Audio alone is not a successful tuner session. The real W/F renderer marks
// establishment only after a decoded waterfall frame is drawn. A receiver that
// dies before that point may advance through the existing bounded fallback set.
assert.match(worker, /function patchRfLifecycleState\(source\)/);
assert.match(worker, /freqbeaconRfEstablished = '1'/);
assert.match(worker, /freqbeaconRfEstablished = '0'/);
assert.match(worker, /function patchPlayerRfEstablishment\(source\)/);
assert.match(worker, /Receiver audio started, but RF never established\. Trying the next ranked receiver…/);
assert.match(worker, /setStatus\('Live audio', true\)/);
assert.match(worker, /x-freqbeacon-sdr-player-session', 'rf-established-sticky-v2'/);
assert.match(worker, /x-freqbeacon-rf-lifecycle', 'audio-then-rf-v1'/);

// Tuner-first amateur launches must still use ham geography/reliability rules
// even when the hidden legacy results grid is not currently in HAM view.
assert.match(worker, /function patchHamReliabilityContext\(source\)/);
assert.match(worker, /\[data-fb3-live-kind\]/);
assert.match(worker, /\[data-fb2-station\]/);
assert.match(worker, /const hamMode = hamViewActive\(url\)/);
assert.match(worker, /RF STREAM CLOSED\|RF SOCKET ERROR\|RF UNAVAILABLE/);
assert.match(worker, /x-freqbeacon-ham-context', 'tuner-aware-v1'/);

// The tuner-first page must display only the true RF canvas. The previous CSS
// accidentally forced the hidden legacy audio canvas back on, stacking two
// canvases and making the panel look stretched.
assert.match(exploreCss, /height:240px!important/);
assert.match(exploreCss, /height:210px!important/);
assert.match(worker, /freqbeacon-rf-layout-fix-v2/);
assert.match(worker, /canvas\[data-sdr-canvas\].*display:none!important/s);
assert.match(worker, /canvas\[data-sdr-rf-v2-canvas\].*height:210px!important/s);

assert.doesNotThrow(() => new Function(worker.replace(/^import .*$/gm, '').replace(/export default/g, 'void')));

console.log('stable waterfall cadence, RF establishment, ham context, and single-canvas layout guard passed');
