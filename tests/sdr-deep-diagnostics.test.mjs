import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const worker = read('worker-v2.js');
const diagnosticWorker = read('sdr-diagnostics-worker.js');
const page = read('sdr-diagnostics.html');
const browser = read('sdr-diagnostics.js');
const wrangler = JSON.parse(read('wrangler.jsonc'));

test('deep diagnostics route is Worker-first and wired before normal SDR routes', () => {
  assert.ok(wrangler.assets.run_worker_first.includes('/api/sdr/*'));
  assert.match(worker, /handleSdrDiagnostic/);
  assert.match(worker, /url\.pathname === '\/api\/sdr\/diagnostics'/);
});

test('Worker probe accepts upstream WebSocket and inspects Kiwi protocol milestones', () => {
  assert.match(diagnosticWorker, /response\.webSocket/);
  assert.match(diagnosticWorker, /ws\.accept\(\{ allowHalfOpen:true \}\)/);
  assert.match(diagnosticWorker, /SET auth t=kiwi p=#/);
  assert.match(diagnosticWorker, /sample_rate=/);
  assert.match(diagnosticWorker, /tag === 'SND'/);
  assert.match(diagnosticWorker, /native-ui/);
  assert.match(diagnosticWorker, /external-api/);
  assert.match(diagnosticWorker, /legacy-ui/);
});

test('diagnostic page does not load the normal SDR player wrapper stack', () => {
  assert.match(page, /sdr-diagnostics\.js\?v=1/);
  assert.doesNotMatch(page, /sdr-player\.js/);
  assert.doesNotMatch(page, /sdr-rf-v2\.js/);
  assert.doesNotMatch(page, /sdr-health\.js/);
  assert.doesNotMatch(page, /sdr-tuning-v3\.js/);
  assert.match(browser, /new WebSocket\(wsUrl\)/);
  assert.match(browser, /first-snd-received/);
});
