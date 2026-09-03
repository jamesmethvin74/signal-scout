import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');

test('baseline main-thread relief batches mobile signal-card rendering', () => {
  assert.match(worker, /const batchSize = window\.innerWidth <= 700 \? 20 : 60/);
  assert.match(worker, /window\.setTimeout\(appendBatch, 0\)/);
  assert.match(worker, /let renderGeneration = 0/);
});

test('baseline main-thread relief caches schedule formatters', () => {
  assert.match(worker, /const scheduleFormatterCache = new Map\(\)/);
  assert.match(worker, /scheduleFormatterCache\.get\(timeZone\)/);
  assert.match(worker, /scheduleFormatterCache\.set\(timeZone, formatters\)/);
});

test('card observers no longer watch decorated subtrees', () => {
  assert.match(worker, /observer\.observe\(grid, \{ childList: true \}\)/);
  assert.match(worker, /\.observe\(grid, \{ childList: true \}\)/);
  assert.match(worker, /decorate\(root = document\)/);
});

test('SDR transport remains on the native Kiwi route', () => {
  assert.match(worker, /\/ws\/kiwi\/\$\{upstreamTimestamp\}\/\$\{stream\}/);
  assert.match(worker, /if \(url\.pathname === '\/api\/sdr\/ws'\) return proxySdrWebSocket\(request\)/);
});
