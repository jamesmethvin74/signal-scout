import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../worker-sdr-diagnostic-control-v3.js', import.meta.url), 'utf8');
const wrangler = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

test('production Worker guarantees visible SDR diagnostic control', () => {
  assert.match(worker, /freqbeacon-sdr-diagnostic-control-v3/);
  assert.match(worker, /sdr-lifecycle-diagnostics-v2\.js\?v=3/);
  assert.match(worker, /Copy SDR diagnostic/);
  assert.match(worker, /setInterval\(\(\) => \{/);
  assert.match(worker, /sdr-receiver-ui\.js\?v=4/);
});

test('diagnostic assets are Worker-first and cache independent', () => {
  assert.match(wrangler, /"main": "worker-sdr-diagnostic-control-v3\.js"/);
  assert.match(wrangler, /"\/sdr-receiver-ui\.js"/);
  assert.match(wrangler, /"\/sdr-lifecycle-diagnostics-v2\.js"/);
});
