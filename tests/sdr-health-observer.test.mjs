import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../sdr-health.js', import.meta.url), 'utf8');

test('SDR health never owns socket lifetime', () => {
  assert.match(source, /signalScout:sdrHealth:v2/);
  assert.doesNotMatch(source, /FAST_FAIL_MS/);
  assert.doesNotMatch(source, /socket\.close\(/);
  assert.doesNotMatch(source, /setTimeout\(/);
});

test('only receiver-confirmed states can record failures', () => {
  assert.match(source, /too_busy=1/);
  assert.match(source, /down=1/);
  assert.doesNotMatch(source, /addEventListener\('error'.*markFailure/s);
  assert.doesNotMatch(source, /addEventListener\('close'.*markFailure/s);
});
