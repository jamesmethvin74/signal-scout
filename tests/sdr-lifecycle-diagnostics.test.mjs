import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../worker-direct-inmemory-ranking.js', import.meta.url), 'utf8');
const lifecycle = fs.readFileSync(new URL('../sdr-lifecycle-diagnostics.js', import.meta.url), 'utf8');

test('production root loads lifecycle diagnostics after the player', () => {
  assert.match(worker, /sdr-lifecycle-diagnostics\.js\?v=1/);
  assert.match(worker, /sdr-live-reliability\.js\?v=1/);
  assert.match(worker, /x-freqbeacon-sdr-lifecycle/);
});

test('lifecycle recorder wraps only the captured native SND constructor', () => {
  assert.match(lifecycle, /const NativeSocket = window\.__signalScoutNativeWebSocket/);
  assert.match(lifecycle, /window\.__signalScoutNativeWebSocket = LifecycleNativeSocket/);
  assert.doesNotMatch(lifecycle, /window\.WebSocket\s*=\s*LifecycleNativeSocket/);
  assert.match(lifecycle, /meta\.stream !== 'SND'/);
});

test('lifecycle recorder distinguishes raw compressed and uncompressed SND', () => {
  assert.match(lifecycle, /flags & 0x10/);
  assert.match(lifecycle, /frames\.compressed/);
  assert.match(lifecycle, /frames\.uncompressed/);
  assert.match(lifecycle, /firstFlags/);
});

test('lifecycle recorder proves local versus remote close', () => {
  assert.match(lifecycle, /FREQBEACON local SND close/);
  assert.match(lifecycle, /localCloseAlreadyRecorded/);
  assert.match(lifecycle, /event\.code/);
  assert.match(lifecycle, /event\.reason/);
  assert.match(lifecycle, /lastSndAgeMs/);
});

test('diagnostic verifies the served native-SND player patch', () => {
  assert.match(lifecycle, /x-freqbeacon-native-snd/);
  assert.match(lifecycle, /player-patch-miss/);
  assert.match(lifecycle, /hasNativeSocketConstruction/);
});

test('diagnostics are event-driven and do not add a MutationObserver loop', () => {
  assert.doesNotMatch(lifecycle, /new MutationObserver/);
  assert.match(lifecycle, /freqbeacon:snd-ready/);
  assert.match(lifecycle, /freqbeacon:snd-audio/);
});
