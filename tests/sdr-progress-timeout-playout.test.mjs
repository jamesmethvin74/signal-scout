import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../worker-direct-inmemory-ranking.js', import.meta.url), 'utf8');

test('normal SDR connection deadlines refresh on real handshake progress', () => {
  assert.match(source, /PLAYER_OPEN_TIMEOUT_MS = 10000/);
  assert.match(source, /PLAYER_AUDIO_TIMEOUT_MS = 10000/);
  assert.match(source, /Receiver opened but audio did not start/);
  assert.match(source, /Receiver configured but audio did not start/);
  assert.match(source, /Receiver did not open in time/);
  assert.match(source, /window\.clearTimeout\(sdr\.connectTimer\)/);
});

test('normal SDR Web Audio keeps a startup jitter cushion without repeated dead air', () => {
  assert.match(source, /PLAYER_AUDIO_LEAD_SECONDS = 0\.65/);
  assert.match(source, /PLAYER_AUDIO_RECOVERY_SECONDS = 0\.035/);
  assert.match(source, /Cloudflare-to-browser SND bunching/);
  assert.match(source, /startup cushion is paid only once/);
  assert.doesNotMatch(source, /PLAYER_AUDIO_LOW_WATER_SECONDS/);
  assert.doesNotMatch(source, /newAudioSchedule = .*0\.55.*0\.055/);
});

test('receiver changes flush already scheduled audio from the old SDR', () => {
  assert.match(source, /sdr\.scheduledSources = new Set\(\)/);
  assert.match(source, /sdr\.scheduledSources\.add\(source\)/);
  assert.match(source, /scheduledSource\.stop\(\)/);
  assert.match(source, /sdr\.scheduledSources\.clear\(\)/);
  assert.match(source, /sdr\.nextPlayTime = sdr\.audioContext\?\.currentTime \|\| 0/);
});
