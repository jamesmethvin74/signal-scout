import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../freqbeacon-brand.js', import.meta.url), 'utf8');

assert.match(source, /applyPrimaryBrand\(\);/);
assert.match(source, /installApprovedSplash\(\);/);
assert.match(source, /installLocationReliability\(\);/);
assert.match(source, /brandNode\(document\.body\);/);
assert.doesNotMatch(source, /new\s+MutationObserver\s*\(/);
assert.doesNotMatch(source, /observe\(document\.body,\s*\{\s*childList:\s*true,\s*subtree:\s*true\s*\}\)/);

console.log('freqbeacon-brand observer regression guard passed');
