import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const recorder = fs.readFileSync(new URL('../sdr-lifecycle-diagnostics-v3.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../worker-sdr-diagnostic-control-v3.js', import.meta.url), 'utf8');
const receiverUi = fs.readFileSync(new URL('../sdr-receiver-ui.js', import.meta.url), 'utf8');

test('recorder attaches to the player-owned SND socket event', () => {
  assert.match(recorder, /freqbeacon:snd-created/);
  assert.match(recorder, /attachSocket\(event\.detail\)/);
  assert.match(recorder, /socketSessions\.set\(socket, session\)/);
  assert.doesNotMatch(recorder, /window\.__signalScoutNativeWebSocket\s*=/);
});

test('diagnostic UI offers Android-safe share and download paths', () => {
  assert.match(worker, /Share report/);
  assert.match(worker, /Download JSON/);
  assert.match(worker, /navigator\.share/);
  assert.match(worker, /freqbeacon-sdr-diagnostic\.json/);
  assert.match(worker, /sdr-lifecycle-diagnostics-v3\.js\?v=1/);
});

test('receiver UI no longer loads a second lifecycle recorder', () => {
  assert.doesNotMatch(receiverUi, /sdr-lifecycle-diagnostics/);
});
