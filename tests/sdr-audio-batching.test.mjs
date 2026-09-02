import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../worker-sdr-packet-cadence.js', import.meta.url), 'utf8');

test('effective SDR player batches PCM frames before Web Audio scheduling', () => {
  assert.match(worker, /const AUDIO_BATCH_FRAMES = 8;/);
  assert.match(worker, /function queueAudioFrame\(samples\)/);
  assert.match(worker, /queueAudioFrame\(decodePcm\(audioBytes, littleEndian\)\)/);
  assert.match(worker, /sdr\.audioFrameQueue\.length = 0;/);
  assert.match(worker, /context\.currentTime \+ 0\.35/);
});

test('receiver changes discard partial audio batches', () => {
  assert.match(worker, /sdr\.audioFrameQueue = \[\];/);
  assert.match(worker, /sdr\.audioBatchStarted = false;/);
});

test('served player exposes batching patch status', () => {
  assert.match(worker, /x-freqbeacon-sdr-audio-batching/);
  assert.match(worker, /sdr-audio-batching-v1/);
  assert.match(worker, /audio-batching-patch-miss/);
});
