import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const diag = fs.readFileSync(new URL('../sdr-lifecycle-diagnostics-v3.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../worker-sdr-km4rt-alias-fix.js', import.meta.url), 'utf8');

test('SDR lifecycle diagnostics are passive and cannot mutate WebSocket instances', () => {
  assert.match(diag, /passive-addEventListener-only/);
  assert.doesNotMatch(diag, /socket\.send\s*=/);
  assert.doesNotMatch(diag, /socket\.close\s*=/);
  assert.doesNotMatch(diag, /window\.WebSocket\s*=/);
  assert.match(diag, /socket\.addEventListener\('open'/);
  assert.match(diag, /socket\.addEventListener\('message'/);
});

test('production HTML cache-busts the passive diagnostic recorder', () => {
  assert.match(worker, /sdr-lifecycle-diagnostics-v3\.js\?v=2/);
  assert.match(worker, /passive-addEventListener-only/);
});
