import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const reliability = readFileSync(new URL('../sdr-live-reliability-v2.js', import.meta.url), 'utf8');

assert.match(reliability, /status = payload\?\.resolved && payload\?\.webSocketAccepted \? 'ok' : 'failed'/);
assert.match(reliability, /status = 'unavailable'/);
assert.match(reliability, /const failed = new Set/);
assert.match(reliability, /if \(!reachable\.size && !failed\.size\)/);
assert.match(reliability, /const neutral = receivers\.filter/);
assert.match(reliability, /const definiteFailures = receivers\.filter/);
assert.match(reliability, /const ordered = \[\.\.\.verified, \.\.\.neutral, \.\.\.definiteFailures\]/);
assert.match(reliability, /preflight-failed/);

console.log('SDR definite-failure demotion guard passed');
