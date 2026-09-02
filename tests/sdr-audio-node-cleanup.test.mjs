import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../worker-sdr-packet-cadence.js', import.meta.url), 'utf8');

test('effective player disconnects ended audio source nodes', () => {
  assert.match(worker, /source\.addEventListener\('ended', \(\) => \{/);
  assert.match(worker, /try \{ source\.disconnect\(\); \} catch \{\}/);
  assert.match(worker, /sdr\.scheduledSources\?\.delete\(source\)/);
});

test('receiver-switch cleanup stops and disconnects queued sources', () => {
  assert.match(worker, /try \{ scheduledSource\.stop\(\); \} catch \{\}/);
  assert.match(worker, /try \{ scheduledSource\.disconnect\(\); \} catch \{\}/);
});

test('player response exposes cleanup marker', () => {
  assert.match(worker, /x-freqbeacon-sdr-audio-cleanup/);
  assert.match(worker, /sdr-audio-node-cleanup-v1/);
  assert.match(worker, /url\.pathname === '\/sdr-player\.js'/);
});
