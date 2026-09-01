import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../worker-no-splash.js', import.meta.url), 'utf8');
const wrangler = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

assert.match(worker, /freqbeacon-no-splash-v1/);
assert.match(worker, /freqbeacon-splash/);
assert.match(worker, /app-shell/);
assert.match(wrangler, /"main": "worker-no-splash\.js"/);

console.log('no-splash worker guard passed');
