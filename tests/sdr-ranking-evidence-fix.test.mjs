import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync(new URL('../worker-sdr-ranking-evidence-fix.js', import.meta.url), 'utf8');
const wrangler = fs.readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');

assert.match(source, /sdrConnectionUsability:v2/);
assert.match(source, /Pre-OPEN player timeouts are not receiver-health evidence/);
assert.match(source, /snd-audio/);
assert.match(source, /snd-attempt-failed/); // patch target exists in the wrapper only
assert.match(source, /!patched\.includes\("window\.addEventListener\('freqbeacon:snd-attempt-failed'/);
assert.match(source, /sdr-receiver-runtime-v3\.js\?v=10/);
assert.match(wrangler, /"main": "worker-sdr-ranking-evidence-fix\.js"/);

console.log('SDR ranking evidence policy guard passed');
