import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');

assert.match(worker, /sdr-player-disable-hidden-legacy-spectrum-v1/);
assert.match(worker, /document\.querySelector\('\[data-sdr-rf-v2-canvas\]'\)/);
assert.match(worker, /legacy-spectrum-patch-miss/);
assert.match(worker, /x-freqbeacon-sdr-player-visualizer/);

console.log('hidden legacy SDR spectrum guard passed');
