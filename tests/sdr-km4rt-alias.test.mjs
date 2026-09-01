import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../worker-sdr-km4rt-alias-fix.js', import.meta.url), 'utf8');
const wrangler = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

test('KM4RT raw IP canonicalizes to the proven DDNS endpoint', () => {
  assert.match(worker, /64\.22\.14\.214:8073'\) return 'km4rt\.ddns\.net:8073'/);
  assert.match(worker, /encodeURIComponent\(connectionId\)/);
});

test('ranked receiver list dedupes canonical aliases', () => {
  assert.match(worker, /function normalizeReceiverList\(receivers\)/);
  assert.match(worker, /sdr\.receivers = normalizeReceiverList\(payload\.receivers\);/);
  assert.match(worker, /const seen = new Set\(\)/);
});

test('production uses the alias-fix worker and fresh player asset', () => {
  assert.match(wrangler, /"main": "worker-sdr-km4rt-alias-fix\.js"/);
  assert.match(worker, /sdr-player\.js\?v=11/);
  assert.match(worker, /x-freqbeacon-km4rt-alias/);
});
