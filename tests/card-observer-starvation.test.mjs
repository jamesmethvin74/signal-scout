import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bandLabels = readFileSync(new URL('../band-labels.js', import.meta.url), 'utf8');
const collapse = readFileSync(new URL('../card-collapse.js', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../program-guide.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

assert.match(bandLabels, /observe\(grid, \{ childList: true, subtree: false \}\)/);
assert.match(collapse, /observe\(grid, \{ childList: true, subtree: false \}\)/);
assert.match(guide, /observe\(grid,\{childList:true,subtree:false\}\)/);
assert.match(index, /new MutationObserver\(decorate\)\.observe\(grid, \{ childList: true, subtree: false \}\)/);
assert.match(collapse, /content-visibility:\s*auto/);
assert.match(collapse, /contain-intrinsic-size:\s*auto 320px/);
assert.doesNotMatch(bandLabels, /observe\(grid, \{ childList: true, subtree: true \}\)/);
assert.doesNotMatch(collapse, /observe\(grid, \{ childList: true, subtree: true \}\)/);
assert.doesNotMatch(guide, /observe\(grid,\{childList:true,subtree:true\}\)/);

console.log('card observer starvation guard passed');
