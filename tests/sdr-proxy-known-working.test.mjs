import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');
const seed = fs.readFileSync(new URL('../sdr-directory-seed.js', import.meta.url), 'utf8');
const probe = fs.readFileSync(new URL('../sdr-transport-probe-worker.js', import.meta.url), 'utf8');

test('KM4RT uses the deployment-bundled DDNS endpoint that worked before cleanup', () => {
  assert.match(seed, /id:'km4rt\.ddns\.net:8073'[\s\S]*url:'http:\/\/km4rt\.ddns\.net:8073'/);
  assert.doesNotMatch(worker, /FAST_RECEIVER_ENDPOINTS|64\.22\.14\.214/);
  assert.match(worker, /const seed = SEED_DIRECTORY\.get\(receiverId\);\s*if \(seed\) return seed;/);
});

test('SDR websocket proxy preserves the proven upstream handshake', () => {
  assert.match(worker, /Upgrade: 'websocket'/);
  assert.match(worker, /Origin: `\$\{upstreamScheme\}:\/\/\$\{receiver\.upstreamHost\}`/);
  assert.match(worker, /return upstreamResponse;/);
  assert.match(worker, /NEW_TSTAMP_SPACE/);
});

test('transport probe follows the same seeded DDNS resolver and no raw-IP override', () => {
  assert.doesNotMatch(probe, /FAST_RECEIVER_ENDPOINTS|64\.22\.14\.214/);
  assert.match(probe, /for \(const seed of SDR_DIRECTORY_SEED\)/);
});
