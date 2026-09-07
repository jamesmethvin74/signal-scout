import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

assert.match(worker, /'\/sdr-early-trace\.js'/);
assert.match(worker, /sdr-early-trace\.js\?v=3/);
assert.match(worker, /applySdrTraceRuntime\(html, url\)/);
assert.match(worker, /url\.host !== window\.location\.host/);
assert.match(worker, /early-stream-timing-v2/);
assert.match(worker, /x-freqbeacon-sdr-trace/);

console.log('SDR trace WSS host-match guard passed');
