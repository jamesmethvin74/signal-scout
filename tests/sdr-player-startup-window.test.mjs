import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');
const wrangler = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

test('baseline Worker extends only the SDR player startup timeout', () => {
  assert.match(worker, /}, 30000\);/);
  assert.match(worker, /sdr-player-startup-window-v1/);
  assert.match(worker, /x-freqbeacon-sdr-player-startup/);
  assert.match(worker, /Receiver timed out\. Trying the next ranked receiver/);
});

test('sdr-player asset runs through Worker so startup patch is effective', () => {
  assert.match(wrangler, /"\/sdr-player\.js"/);
});
