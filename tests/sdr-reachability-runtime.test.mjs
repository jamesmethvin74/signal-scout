import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

assert.match(worker, /'\/sdr-live-reliability-v2\.js'/);
assert.match(worker, /sdr-live-reliability-v2\.js\?v=2/);
assert.match(worker, /cache-control', 'no-store, max-age=0'/);

console.log('SDR reachability runtime cache-bust guard passed');
