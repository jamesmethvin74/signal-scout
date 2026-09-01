import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const diagnostics = await readFile(new URL('../sdr-lifecycle-diagnostics-v2.js', import.meta.url), 'utf8');
const receiverUi = await readFile(new URL('../sdr-receiver-ui.js', import.meta.url), 'utf8');

test('v2 diagnostic control is always rendered and captures local and remote close evidence', () => {
  assert.match(diagnostics, /Copy SDR diagnostic/);
  assert.match(diagnostics, /ensureUi\(\);/);
  assert.match(diagnostics, /session\.localClose/);
  assert.match(diagnostics, /event\.code/);
  assert.match(diagnostics, /lastSndAgeMs/);
  assert.match(diagnostics, /nativeSndHeader/);
  assert.match(diagnostics, /hasNativeSocketConstruction/);
});

test('receiver UI loads lifecycle v2 without depending on worker HTML injection', () => {
  assert.match(receiverUi, /sdr-lifecycle-diagnostics-v2\.js\?v=2/);
});
