import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const rf = readFileSync(new URL('../sdr-rf-v2.js', import.meta.url), 'utf8');

assert.match(rf, /send\('SET wf_speed=2'\);/);
assert.match(worker, /function patchRfWaterfallRate\(source\)/);
assert.match(worker, /send\('SET wf_speed=2'\)/);
assert.match(worker, /send\('SET wf_speed=4'\)/);
assert.match(worker, /x-freqbeacon-rf-rate', 'fast-23fps-v1'/);
assert.match(worker, /patchRfSpectrumPersistence\(patched\);\s*patched = patchRfWaterfallRate\(patched\);/s);

console.log('Kiwi FAST waterfall cadence guard passed');
