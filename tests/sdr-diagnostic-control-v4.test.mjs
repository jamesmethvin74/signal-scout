import fs from 'node:fs';
import assert from 'node:assert/strict';

const worker = fs.readFileSync(new URL('../worker-sdr-diagnostic-control-v3.js', import.meta.url), 'utf8');

assert.match(worker, /freqbeacon-sdr-diagnostic-control-v4/);
assert.match(worker, /sdr-lifecycle-diagnostics-v2\.js\?v=4/);
assert.match(worker, /sdr-receiver-ui\.js\?v=5/);
assert.match(worker, /Show SDR diagnostic/);
assert.match(worker, /data-sdr-diagnostic-report-v4/);
assert.match(worker, /textarea\.setSelectionRange\(0, textarea\.value\.length\)/);
assert.match(worker, /data-sdr-lifecycle-v2\],\[data-sdr-lifecycle-box\],\[data-sdr-diagnostic-control-v3\]\{display:none!important\}/);
assert.match(worker, /querySelectorAll\('\[data-sdr-lifecycle-v2\],\[data-sdr-lifecycle-box\],\[data-sdr-diagnostic-control-v3\]'\)/);
assert.doesNotMatch(worker, /navigator\.clipboard\.writeText/);
assert.doesNotMatch(worker, /document\.execCommand\('copy'\)/);

console.log('sdr diagnostic control v4 guard: PASS');
