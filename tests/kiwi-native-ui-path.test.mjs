import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');

test('Kiwi proxy uses the external-client websocket class and honors operator limits', () => {
  assert.doesNotMatch(source, /\/ws\/kiwi\/\$\{upstreamTimestamp\}\/\$\{stream\}/);
  assert.match(source, /receiver\.upstreamHost\}\/\$\{upstreamTimestamp\}\/\$\{stream\}/);
  assert.match(source, /NEW_TSTAMP_SPACE/);
  assert.match(source, /FREQBEACON\/1\.0 external KiwiSDR client/);
  assert.match(source, /Never route around that control/);
});
