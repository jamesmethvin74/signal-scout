import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../worker-direct-inmemory-ranking.js', import.meta.url), 'utf8');
const player = fs.readFileSync(new URL('../sdr-player.js', import.meta.url), 'utf8');

test('effective player waits for Kiwi audio_rate before acknowledging AR_OK', () => {
  assert.match(worker, /Do not synthesize AR_OK from sample_rate/);
  assert.doesNotMatch(worker, /const arInputRate/);
  assert.doesNotMatch(worker, /SET AR OK in=\\\$\{arInputRate\}/);
  assert.match(player, /if \(audioRate && sdr\.audioContext\)/);
  assert.match(player, /SET AR OK in=\$\{Number\(audioRate\)\}/);
});
