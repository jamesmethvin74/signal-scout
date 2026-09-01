import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const control = fs.readFileSync('sdr-samepage-control.js', 'utf8');
const worker = fs.readFileSync('worker-sdr-samepage-control.js', 'utf8');
const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8');

test('same-page control is isolated from the player socket', () => {
  assert.match(control, /new Ctor\(url\)/);
  assert.doesNotMatch(control, /window\.WebSocket\s*=/);
  assert.doesNotMatch(control, /socket\.send\s*=/);
  assert.doesNotMatch(control, /socket\.close\s*=/);
  assert.match(control, /sameReference/);
  assert.match(control, /samePageControl/);
});

test('same-page control runs from the real app shell', () => {
  assert.match(worker, /sdr-samepage-control\.js\?v=1/);
  assert.match(worker, /worker-sdr-reliability-ranking\.js/);
  assert.match(wrangler, /"main": "worker-sdr-samepage-control\.js"/);
  assert.match(wrangler, /"\/sdr-samepage-control\.js"/);
});
