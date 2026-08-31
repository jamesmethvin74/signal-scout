import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const worker = read('worker-runtime.js');
const wrangler = JSON.parse(read('wrangler.jsonc'));
const index = read('index.html');
const lookup = read('lookup.js');
const player = read('sdr-player.js');
const runtime = read('sdr-receiver-runtime-v3.js');
const health = read('sdr-health.js');
const rf = read('sdr-rf-v2.js');
const tuning = read('sdr-tuning-v3.js');
const brand = read('freqbeacon-brand.js');
const sw = read('freqbeacon-sw.js');

test('Cloudflare Worker is API-only and does not rewrite static runtime source', () => {
  assert.equal(wrangler.main, 'worker-runtime.js');
  assert.deepEqual(wrangler.assets.run_worker_first, ['/api/*']);
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/sdr\/'\)/);
  assert.match(worker, /env\.ASSETS\.fetch\(request\)/);
  assert.doesNotMatch(worker, /response\.text\(|replaceAll\(|patchSdr|inject.*html/i);
});

test('production HTML loads one deterministic SDR runtime graph', () => {
  for (const asset of [
    'sdr-rf-v2.js?v=7',
    'sdr-tuning-v3.js?v=3',
    'sdr-health.js?v=4',
    'sdr-receiver-runtime-v3.js?v=6',
    'sdr-connection-manager.js?v=4',
    'sdr-player.js?v=5',
    'sdr-live-reliability-v2.js?v=3'
  ]) assert.match(index, new RegExp(asset.replace(/[.?]/g, '\\$&')));

  for (const obsolete of [
    'sdr-options-fix.js',
    'sdr-receiver-options-sync.js',
    'sdr-receiver-local-catalog.js',
    'sdr-receiver-ui-v8.js'
  ]) assert.doesNotMatch(index, new RegExp(obsolete.replace('.', '\\.')));
});

test('Receiver Options and Listen Live are in-app controls with no Android intent navigation', () => {
  assert.doesNotMatch(lookup, /intent:\/\//i);
  assert.match(lookup, /<button type="button" class="listen-live-button"/);
  assert.match(lookup, /document\.createElement\('button'\)/);
  assert.match(player, /openCardReceiverOptions/);
  assert.match(player, /event\.preventDefault\(\)/);
});

test('receiver ranking is local-first and health is not implemented by global fetch or WebSocket wrappers', () => {
  assert.match(runtime, /recommend\(input\)/);
  assert.match(runtime, /refresh\(input/);
  assert.match(runtime, /receiver-runtime-seed/);
  assert.match(runtime, /bundledSeed/);
  assert.doesNotMatch(health, /window\.fetch\s*=|window\.WebSocket\s*=/);
  assert.doesNotMatch(player, /fetch\([^)]*api\/sdr\/receivers/i);
});

test('proven RF and tuning fixes live in source', () => {
  assert.match(rf, /url\.host !== window\.location\.host/);
  assert.match(rf, /persistentSpectrumDb/);
  assert.match(tuning, /state\.observer\?\.disconnect\(\)/);
});

test('PWA runtime revision is deterministic without caching SDR assets in the service worker', () => {
  assert.match(brand, /freqbeacon-sw\.js\?v=2/);
  assert.match(brand, /updateViaCache:\s*'none'/);
  assert.match(sw, /freqbeacon-canonical-v2/);
  assert.match(sw, /request\.mode !== 'navigate'/);
  assert.doesNotMatch(sw, /caches\.open|cache\.put|CacheFirst|staleWhileRevalidate/i);
});