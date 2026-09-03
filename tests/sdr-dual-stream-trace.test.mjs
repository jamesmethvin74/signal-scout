import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');
const trace = fs.readFileSync(new URL('../sdr-dual-stream-trace.js', import.meta.url), 'utf8');

test('dual-stream trace is opt-in only', () => {
  assert.match(worker, /url\.searchParams\.get\('sdrtrace'\) === '1'/);
  assert.match(worker, /sdr-dual-stream-trace\.js\?v=1/);
  assert.match(worker, /x-freqbeacon-sdr-dual-trace/);
});

test('trace does not use DOM mutation observers or close SDR sockets', () => {
  assert.doesNotMatch(trace, /MutationObserver/);
  assert.doesNotMatch(trace, /socket\.close\(/);
  assert.doesNotMatch(trace, /SET auth|SET keepalive|SET mod=/);
});

test('trace measures SND, waterfall and browser heartbeat gaps', () => {
  assert.match(trace, /stream !== 'SND' && stream !== 'W\/F'/);
  assert.match(trace, /missingSequenceFrames/);
  assert.match(trace, /maxGapMs/);
  assert.match(trace, /maxDriftMs/);
  assert.match(trace, /Copy SDR trace/);
});
