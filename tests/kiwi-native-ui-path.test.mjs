import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');

test('Kiwi proxy uses native UI websocket class, not kiwirecorder external API', () => {
  assert.match(source, /\/ws\/kiwi\/\$\{upstreamTimestamp\}\/\$\{stream\}/);
  assert.doesNotMatch(source, /receiver\.upstreamHost\}\/\$\{upstreamTimestamp\}\/\$\{stream\}/);
  assert.match(source, /NEW_TSTAMP_SPACE/);
  assert.match(source, /FREQBEACON\/1\.0 interactive KiwiSDR client/);
});
