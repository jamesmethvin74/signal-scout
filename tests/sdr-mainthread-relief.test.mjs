import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync(new URL('../worker-sdr-mainthread-relief.js', import.meta.url), 'utf8');
const wrangler = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

assert.match(worker, /let renderGeneration = 0/);
assert.match(worker, /scheduleFormatterCache/);
assert.match(worker, /window\.innerWidth <= 700 \? 20 : 60/);
assert.match(worker, /window\.setTimeout\(appendBatch, 0\)/);
assert.match(worker, /Watch only cards added to the grid/);
assert.match(worker, /observer\.observe\(grid, \{ childList: true \}\)/);
assert.match(worker, /app\.js\?v=2/);
assert.match(worker, /band-labels\.js\?v=3/);
assert.match(worker, /card-collapse\.js\?v=2/);
assert.match(wrangler, /"main": "worker-sdr-mainthread-relief\.js"/);
assert.match(wrangler, /"\/app\.js"/);
assert.match(wrangler, /"\/band-labels\.js"/);
assert.match(wrangler, /"\/card-collapse\.js"/);

console.log('SDR main-thread relief guard passed');
