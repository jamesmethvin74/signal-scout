import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');
const diagnostics = fs.readFileSync(new URL('../sdr-normal-session-diagnostics.js', import.meta.url), 'utf8');

test('normal SDR diagnostics are passive event observers', () => {
  assert.match(worker, /freqbeacon:snd-created/);
  assert.match(worker, /freqbeacon:snd-ready/);
  assert.match(worker, /freqbeacon:snd-audio/);
  assert.match(worker, /freqbeacon:rf-stage/);
  assert.doesNotMatch(diagnostics, /window\.WebSocket\s*=/);
  assert.doesNotMatch(diagnostics, /socket\.close\(/);
  assert.doesNotMatch(diagnostics, /socket\.send\s*=/);
});

test('normal player always exposes working report controls', () => {
  assert.match(diagnostics, /data-sdr-normal-copy/);
  assert.match(diagnostics, /data-sdr-normal-show/);
  assert.match(diagnostics, /navigator\.clipboard\.writeText/);
  assert.match(diagnostics, /document\.execCommand\('copy'\)/);
  assert.match(worker, /sdr-normal-session-diagnostics\.js\?v=1/);
});

test('reports include SND, RF, player, and asset evidence', () => {
  assert.match(diagnostics, /sndSessions/);
  assert.match(diagnostics, /rfEvents/);
  assert.match(diagnostics, /playerEvents/);
  assert.match(diagnostics, /assetCheck/);
  assert.match(diagnostics, /maxSndGapMs/);
});
