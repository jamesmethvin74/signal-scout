import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const rf = readFileSync(new URL('../sdr-rf-v2.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');

assert.match(rf, /pendingFrame: null/);
assert.match(rf, /renderFrameRequest: 0/);
assert.match(rf, /function queueRfFrame\(bins\)/);
assert.match(rf, /state\.pendingFrame = bins/);
assert.match(rf, /window\.requestAnimationFrame/);
assert.match(rf, /queueRfFrame\(bins\);/);
assert.doesNotMatch(rf, /state\.unsupportedFrames = 0;\s*renderRfFrame\(bins\);/s);
assert.match(rf, /window\.cancelAnimationFrame\(state\.renderFrameRequest\)/);
assert.match(rf, /state\.hasFrame \|\| state\.pendingFrame/);

// Keep the existing production spectrum-persistence rewrite compatible with
// the source-level renderer change.
assert.match(rf, /const spectrumDb = smoothSpectrumDb\(db\);/);
assert.match(rf, /state\.requestedCompression = false;\s*if \(ensureCanvas\(\)\) drawStage\(reason\);/s);
assert.match(worker, /patchRfSpectrumPersistence/);
assert.match(worker, /persistentSpectrumDb/);

console.log('latest-frame RF rendering guard passed');
