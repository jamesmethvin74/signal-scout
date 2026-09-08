import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const receiverUi = readFileSync(new URL('../sdr-receiver-ui.js', import.meta.url), 'utf8');
const programGuide = readFileSync(new URL('../program-guide.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

test('card Receiver Options no longer installs a client-side receiver ranking override', () => {
  assert.doesNotMatch(receiverUi, /sdr-options-fix\.js/);
  assert.doesNotMatch(receiverUi, /window\.fetch\s*=/);
  assert.doesNotMatch(receiverUi, /instant-local-options/);
  assert.match(receiverUi, /\.card-receiver-options/);
  assert.match(receiverUi, /sdr-card-options-context/);
  assert.match(receiverUi, /#sdrPlayer:not\(\[hidden\]\) \[data-sdr-close\]/);
  assert.match(receiverUi, /button\.click\(\)/);
});

test('WBCQ official no-listing response is not mislabeled as an on-now service', () => {
  assert.match(programGuide, /function isOfficialWbcqGap\(station, data\)/);
  assert.match(programGuide, /data\?\.status === 'unverified'/);
  assert.match(programGuide, /WBCQ official program guide/);
  assert.match(programGuide, /status:'unscheduled'/);
  assert.match(programGuide, /NOT SCHEDULED NOW · WBCQ GUIDE/);
  assert.match(programGuide, /No current WBCQ listing on this frequency/);
  assert.match(programGuide, /Check receiver anyway/);
  assert.match(programGuide, /broadcastAuthority = 'unscheduled'/);
});

test('program guide v3 is cache-busted through the effective Worker HTML response', () => {
  assert.match(worker, /program-guide\.js\?v=3/);
  assert.match(worker, /x-freqbeacon-program-guide', 'v3'/);
});

test('modified browser scripts still parse', () => {
  assert.doesNotThrow(() => new Function(receiverUi));
  assert.doesNotThrow(() => new Function(programGuide));
});

console.log('server ranking and WBCQ authority guards passed');
