import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const outerWorker = read('worker-direct-inmemory-ranking.js');
const rfSource = read('sdr-rf-v2.js');

const legacyRfStart = "      socket.addEventListener('open', () => startWaterfall(meta, socket), { once: true });";

test('RF patch target still exists in the served source', () => {
  assert.ok(rfSource.includes(legacyRfStart), 'SND-open waterfall hook changed; Worker patch would miss');
});

test('outer Worker delays W/F until SND session is established', () => {
  assert.match(outerWorker, /function patchRf\(response\)/);
  assert.match(outerWorker, /sample_rate=\[0-9\.\]\+/);
  assert.match(outerWorker, /tag === 'SND'/);
  assert.match(outerWorker, /startRfOnce\(\)/);
  assert.match(outerWorker, /x-freqbeacon-rf-snd-first/);
});

test('health watchdog is no longer shortened to 2.2 seconds', () => {
  assert.doesNotMatch(outerWorker, /FAST_FAIL_MS = 2200/);
  assert.match(outerWorker, /native 5\.5s/);
});

test('browser receives cache-busted RF and health assets', () => {
  assert.match(outerWorker, /sdr-rf-v2\.js\?v=9/);
  assert.match(outerWorker, /sdr-health\.js\?v=9/);
});
