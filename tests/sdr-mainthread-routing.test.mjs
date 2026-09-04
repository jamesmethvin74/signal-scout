import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const wrangler = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');

test('main-thread relief assets are routed through the Worker', () => {
  for (const path of ['/app.js', '/band-labels.js', '/card-collapse.js']) {
    assert.ok(wrangler.includes(`"${path}"`), `${path} must be in run_worker_first`);
  }
});

test('routed assets have matching relief handlers', () => {
  assert.match(worker, /url\.pathname === '\/app\.js'/);
  assert.match(worker, /url\.pathname === '\/band-labels\.js'/);
  assert.match(worker, /url\.pathname === '\/card-collapse\.js'/);
  assert.match(worker, /patchAppMainThread/);
  assert.match(worker, /patchBandLabelsMainThread/);
  assert.match(worker, /patchCardCollapseMainThread/);
});
