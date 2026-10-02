import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workerV2 = readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');
const workerBase = readFileSync(new URL('../worker-base.js', import.meta.url), 'utf8');

assert.doesNotMatch(workerV2, /receiverbook\.de|SHARED_DIRECTORY_CACHE_PATHS|resolveReceiverFromSharedCache/i);
assert.doesNotMatch(workerBase, /receiverbook\.de|parseReceiverBook|sdr-directory-v4/i);
assert.match(workerBase, /source: 'operator-public-static'/);
assert.match(workerV2, /function resolveReceiver\(receiverId\)/);

console.log('SDR directory compliance guard passed');
