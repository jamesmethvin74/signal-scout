import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const index = read('index.html');
const tracePage = read('sdr-trace.html');
const trace = read('sdr-early-trace.js');

test('normal app does not load the diagnostic trace', () => {
  assert.doesNotMatch(index, /sdr-early-trace\.js/);
  assert.doesNotMatch(index, /sdr-trace\.html/);
});

test('diagnostic trace is installed before the production index is written', () => {
  const sourceFetch = tracePage.indexOf("xhr.open('GET', '/index.html?source=sdr-trace-v1', false)");
  const traceLoad = tracePage.indexOf('sdr-early-trace.js?v=1');
  const indexWrite = tracePage.indexOf('document.write(`${head}</head><body>${body}</body>`)');
  assert.ok(sourceFetch >= 0);
  assert.ok(traceLoad > sourceFetch);
  assert.ok(indexWrite > traceLoad);
});

test('trace observes only FREQBEACON SND and W/F sockets without transport control', () => {
  assert.match(trace, /url\.pathname !== '\/api\/sdr\/ws'/);
  assert.match(trace, /\['SND', 'W\/F'\]\.includes\(stream\)/);
  assert.match(trace, /const NativeWebSocket = window\.WebSocket/);
  assert.match(trace, /socket\.addEventListener\('message'/);
  assert.doesNotMatch(trace, /socket\.send\s*\(/);
  assert.doesNotMatch(trace, /socket\.close\s*\(/);
  assert.doesNotMatch(trace, /MutationObserver/);
});

test('trace storage and active instrumentation are capped', () => {
  assert.match(trace, /MAX_SOCKETS = 12/);
  assert.match(trace, /MAX_MESSAGES_PER_SOCKET = 3200/);
  assert.match(trace, /MAX_HANDLERS_PER_SOCKET = 1800/);
  assert.match(trace, /MAX_LONG_TASKS = 800/);
  assert.match(trace, /MAX_HEARTBEATS = 900/);
  assert.match(trace, /record\.stream === 'W\/F' \|\| record\.messageCount % 8 === 0/);
});

test('trace correlates stream gaps with long tasks and handler occupancy', () => {
  assert.match(trace, /significantGapsOverlappingLongTask/);
  assert.match(trace, /longTaskOverlapPct/);
  assert.match(trace, /p95HandlerMs/);
  assert.match(trace, /maxHandlerMs/);
  assert.match(trace, /inputDelayMs/);
});
