import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const trace = readFileSync(new URL('../sdr-live-path-trace.js', import.meta.url), 'utf8');

assert.match(worker, /'\/sdr-live-path-trace\.js'/);
assert.match(worker, /sdr-live-path-trace\.js\?v=1/);
assert.match(worker, /x-freqbeacon-sdr-live-path-trace/);
assert.match(worker, /sdrTrace/);

assert.match(trace, /receiver-directory-response/);
assert.match(trace, /receiver-probe-response/);
assert.match(trace, /stage: 'final'/);
assert.match(trace, /player-ui/);
assert.match(trace, /listen-click/);
assert.match(trace, /COPY LIVE TRACE/);
assert.match(trace, /baseTrace\.rawReport\(\)/);

console.log('Live SDR path trace guard passed');
