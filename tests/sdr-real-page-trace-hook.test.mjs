import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const brand = readFileSync(new URL('../freqbeacon-brand.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const redirect = readFileSync(new URL('../sdr-trace.html', import.meta.url), 'utf8');

assert.match(brand, /sdrTrace/);
assert.match(brand, /sdr-early-trace\.js\?v=2/);
assert.match(redirect, /\/\?sdrTrace=1/);

const brandPos = index.indexOf('freqbeacon-brand.js');
const rfPos = index.indexOf('sdr-rf-v2.js');
assert.ok(brandPos >= 0 && rfPos >= 0 && brandPos < rfPos, 'trace hook must load before RF captures WebSocket');

console.log('real-page SDR trace hook regression guard passed');
