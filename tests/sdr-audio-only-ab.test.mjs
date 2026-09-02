import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../worker-sdr-mainthread-relief.js', import.meta.url), 'utf8');

test('audio-only A/B mode suppresses only the RF client on explicit query', () => {
  assert.match(source, /url\.searchParams\.get\('sdraudio'\) === '1'/);
  assert.match(source, /sdr-rf-v2\\\.js/);
  assert.match(source, /x-freqbeacon-sdr-audio-only/);
  assert.match(source, /sdr-audio-only-ab-v1/);
});
