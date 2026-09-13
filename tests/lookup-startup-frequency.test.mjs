import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const zero = await readFile(new URL('../freqbeacon-zero.js', import.meta.url), 'utf8');
const dial = await readFile(new URL('../freqbeacon-zero-dial.js', import.meta.url), 'utf8');

for (const [name, source] of [['Zero engine', zero], ['Zero dial', dial]]) {
  assert.match(source, /params\.get\('from'\) !== 'lookup'/, `${name} must limit URL startup tuning to Lookup handoffs`);
  assert.match(source, /params\.get\('frequency'\) \|\| params\.get\('freq'\)/, `${name} must accept Lookup frequency parameters`);
  assert.match(source, /requested >= 30 && requested <= 30000/, `${name} must keep startup targets inside Zero's supported range`);
}

assert.match(zero, /initialFrequencyKHz:\s*initialFrequencyKHz\(\)/, 'Zero engine must use the Lookup-aware initial frequency');
assert.match(dial, /initialKHz:\s*initialFrequencyKHz\(\)/, 'Zero dial must use the Lookup-aware initial frequency');

console.log('Lookup startup frequency handoff regression checks passed.');
