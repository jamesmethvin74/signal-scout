import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../worker-direct-inmemory-ranking.js', import.meta.url), 'utf8');
const wrangler = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

test('player SND socket uses captured native browser WebSocket', () => {
  assert.match(worker, /const NativeSocket = window\.__signalScoutNativeWebSocket \|\| window\.WebSocket/);
  assert.match(worker, /socket = new NativeSocket\(socketUrl\)/);
  assert.match(worker, /freqbeacon:snd-created/);
  assert.match(worker, /freqbeacon:snd-ready/);
  assert.match(worker, /freqbeacon:snd-audio/);
});

test('RF, tuning, and health no longer own SND WebSocket construction', () => {
  assert.match(worker, /oldAssignment = '  window\.WebSocket = RfSessionWebSocket;'/);
  assert.match(worker, /oldAssignment = '  window\.WebSocket = TuningWebSocket;'/);
  assert.match(worker, /oldAssignment = '  window\.WebSocket = HealthAwareWebSocket;'/);
  assert.match(worker, /window\.addEventListener\('freqbeacon:snd-ready'/);
  assert.match(worker, /window\.addEventListener\('freqbeacon:snd-created'/);
});

test('tuning asset is Worker-first so its wrapper-removal patch is actually served', () => {
  assert.match(wrangler, /"\/sdr-tuning\.js"/);
  assert.match(worker, /url\.pathname === '\/sdr-tuning\.js'/);
});

test('root cache-busts every SND-related runtime asset', () => {
  assert.match(worker, /sdr-player\.js\?v=10/);
  assert.match(worker, /sdr-health\.js\?v=10/);
  assert.match(worker, /sdr-rf-v2\.js\?v=10/);
  assert.match(worker, /sdr-tuning\.js\?v=2/);
});
