import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../sdr-health.js', import.meta.url), 'utf8');

test('SDR health never owns connection timeout or socket lifetime', () => {
  assert.doesNotMatch(source, /FAST_FAIL_MS/);
  assert.doesNotMatch(source, /socket\.close\(4000/);
  assert.doesNotMatch(source, /connection timeout/);
  assert.match(source, /The player owns\n    \/\/ connection lifetime/);
});

test('SDR health still records explicit failures and successful SND', () => {
  assert.match(source, /markSuccess\(receiverId\)/);
  assert.match(source, /markFailure\(receiverId, inspection\.state\)/);
  assert.match(source, /PassiveHealthWebSocket/);
  assert.match(source, /passive-health-v2/);
});
