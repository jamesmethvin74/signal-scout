import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../worker-direct-inmemory-ranking.js', import.meta.url), 'utf8');

test('SDR startup buffer is not reused as an underrun penalty', () => {
  assert.match(source, /PLAYER_AUDIO_LEAD_SECONDS = 0\.65/);
  assert.match(source, /PLAYER_AUDIO_RECOVERY_SECONDS = 0\.035/);
  assert.match(source, /650 ms startup cushion is paid only once/);
  assert.match(source, /sdr\.nextPlayTime = now \+ \$\{PLAYER_AUDIO_RECOVERY_SECONDS\}/);
  assert.doesNotMatch(source, /PLAYER_AUDIO_LOW_WATER_SECONDS/);
});
