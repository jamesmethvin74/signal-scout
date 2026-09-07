import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cardSource = readFileSync(new URL('../card-collapse.js', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');

assert.match(cardSource, /new IntersectionObserver/);
assert.match(cardSource, /rootMargin: '900px 0px'/);
assert.match(cardSource, /requestIdleCallback/);
assert.match(cardSource, /processed < 10/);
assert.match(cardSource, /subtree: false/);
assert.doesNotMatch(cardSource, /requestAnimationFrame\(\(\) => \{\s*for \(const card of added\)/s);

const startupTail = appSource.slice(appSource.lastIndexOf('updateClock();'));
assert.match(startupTail, /initializeLocation\(\);\s*render\(\);/s);
assert.doesNotMatch(appSource, /if \(saved\) render\(\);/);

console.log('progressive card decoration guard passed');
