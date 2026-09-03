import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');

test('served SDR player batches PCM before Web Audio scheduling', () => {
  assert.match(worker, /const AUDIO_BATCH_FRAMES = 8/);
  assert.match(worker, /const AUDIO_TARGET_LEAD_SECONDS = 0\.18/);
  assert.match(worker, /function queueAudio\(samples\)/);
  assert.match(worker, /queueAudio\(decodePcm\(audioBytes, littleEndian\)\)/);
});

test('finished sources disconnect and receiver changes discard partial audio', () => {
  assert.match(worker, /source\.addEventListener\('ended'/);
  assert.match(worker, /source\.disconnect\(\)/);
  assert.match(worker, /sdr\.audioFrameQueue = \[\]/);
});

test('served player exposes audio patch marker', () => {
  assert.match(worker, /x-freqbeacon-sdr-player-audio/);
  assert.match(worker, /sdr-player-audio-chunking-v1/);
  assert.match(worker, /audio-chunking-patch-miss/);
});
