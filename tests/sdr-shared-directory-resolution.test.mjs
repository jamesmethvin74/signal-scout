import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');

assert.match(source, /__cache\/sdr-directory-v4-fresh/);
assert.match(source, /__cache\/sdr-directory-v4-last-good/);
assert.match(source, /resolveReceiverFromSharedCache\(request, receiverId\)/);
assert.match(source, /resolveReceiver\(request, receiverId\)/);
assert.match(source, /receiver = await resolveReceiver\(request, receiverId\)/);
assert.match(source, /normalized\?\.id === receiverId/);

console.log('shared SDR directory resolution guard passed');
