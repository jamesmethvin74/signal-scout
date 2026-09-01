import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../worker-sdr-copy-report-v6.js', import.meta.url), 'utf8');
const wrangler = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

assert.match(wrangler, /"main": "worker-sdr-copy-report-v6\.js"/);
assert.match(worker, /Copy report/);
assert.match(worker, /navigator\.clipboard\?\.writeText/);
assert.match(worker, /ClipboardItem/);
assert.match(worker, /document\.execCommand\('copy'\)/);
assert.match(worker, /showSelectedReport/);
assert.match(worker, /Copy blocked — report selected below/);
assert.doesNotMatch(worker, /Download JSON/);
assert.doesNotMatch(worker, /anchor\.download/);

console.log('sdr copy-report v6 guard passed');
