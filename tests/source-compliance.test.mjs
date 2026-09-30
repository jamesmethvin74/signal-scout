import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL('../' + name, import.meta.url), 'utf8');

const [workerV2, workerBase, guideWorker, fullData, pkgText, fccAsset, terrestrialGenerator, policy] = await Promise.all([
  read('worker-v2.js'),
  read('worker-base.js'),
  read('program-guide-worker.js'),
  read('full-data.js'),
  read('package.json'),
  read('freqbeacon-zero-us-am-fcc.js'),
  read('scripts/generate-global-terrestrial-catalog.mjs'),
  read('SOURCE-COMPLIANCE.md')
]);

assert.doesNotMatch(workerV2, /receiverbook\.de/i);
assert.doesNotMatch(workerBase, /receiverbook\.de/i);
assert.doesNotMatch(workerV2, /\/ws\/kiwi\/\$\{upstreamTimestamp\}/);
assert.match(workerV2, /external KiwiSDR client/);
assert.match(workerV2, /owner’s ext_api channel/);

assert.doesNotMatch(guideWorker, /https?:\/\//i);
assert.doesNotMatch(guideWorker, /fetch\s*\(/);
assert.match(guideWorker, /source reuse permissions/);

assert.doesNotMatch(fullData, /raw\.githubusercontent\.com/i);
assert.doesNotMatch(fullData, /fetch\s*\(/);
assert.match(fullData, /complianceMode:\s*true/);

const pkg = JSON.parse(pkgText);
assert.doesNotMatch(pkg.scripts.postinstall, /generate-a26-identification-catalog/);
assert.doesNotMatch(pkg.scripts.postinstall, /generate-fcc-am-catalog/);
assert.match(pkg.scripts.test, /test:compliance/);

assert.match(fccAsset, /FREQBEACON_ZERO_US_AM_FCC_CATALOG = Object\.freeze\(\[\]\)/);
assert.doesNotMatch(terrestrialGenerator, /Roger-Need\/StationFinder/);
assert.match(terrestrialGenerator, /fallbackEntries=\[\]/);

assert.match(policy, /Public reachability is not permission/i);
assert.match(policy, /ReceiverBook receiver directory \| DISABLED/);
assert.match(policy, /KiwiSDR public receivers \| ALLOWED WITH OPERATOR CONTROLS/);

console.log('source compliance guards: ok');
