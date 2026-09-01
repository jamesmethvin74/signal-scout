import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const control = fs.readFileSync(new URL('../sdr-samepage-control.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../worker-sdr-samepage-control.js', import.meta.url), 'utf8');

test('player snd-ready event clears Kiwi AR_OK gate', () => {
  assert.match(control, /window\.addEventListener\('freqbeacon:snd-ready'/);
  assert.match(control, /SET AR OK in=\$\{safeIn\} out=\$\{safeOut\}/);
  assert.match(control, /sendArOk\(socket\)/);
});

test('same-page control sends AR_OK immediately after sample_rate', () => {
  assert.match(control, /sample_rate=/);
  assert.match(control, /sendArOk\(ws, result\.sampleRate, AR_OK_OUTPUT_RATE\)/);
  assert.match(control, /arOkSentMs/);
  assert.match(control, /sdr-samepage-control-v2-ar-ok/);
});

test('AR_OK control script is cache-busted', () => {
  assert.match(worker, /sdr-samepage-control\.js\?v=2/);
  assert.match(worker, /sdr-samepage-control-v2-ar-ok/);
  assert.match(worker, /existingPattern/);
});