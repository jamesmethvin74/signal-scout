import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');

assert.match(worker, /async function probeSdrReceiver\(request\)/);
assert.match(worker, /direct-worker-upstream-websocket-v1/);
assert.match(worker, /proxySafeTimestamp\(timestamp\)/);
assert.match(worker, /\/ws\/kiwi\/\$\{upstreamTimestamp\}\/\$\{stream\}/);
assert.match(worker, /Upgrade: 'websocket'/);
assert.match(worker, /Origin: `\$\{upstreamScheme\}:\/\/\$\{receiver\.upstreamHost\}`/);
assert.match(worker, /url\.pathname === '\/api\/sdr\/probe'/);

console.log('direct SDR upstream probe guard passed');
