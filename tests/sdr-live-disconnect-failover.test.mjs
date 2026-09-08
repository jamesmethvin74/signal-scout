import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const health = readFileSync(new URL('../sdr-health.js', import.meta.url), 'utf8');
const player = readFileSync(new URL('../sdr-player.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');

// Health can remember a short abnormal live session, but it must not own the
// player's connection lifecycle or trigger another receiver after audio was live.
assert.match(health, /SHORT_LIVE_SESSION_MS = 30 \* 1000/);
assert.match(health, /markFailure\(receiverId, 'disconnect'\)/);
assert.match(health, /passive-health-v3/);

// Restore the original player behavior: failed startup may try another ranked
// receiver, but a session that was already live stops and waits for the user.
assert.match(player, /Receiver did not answer\. Trying the next ranked receiver…/);
assert.match(player, /The public receiver disconnected\. Tap Play to reconnect\./);
assert.match(player, /\}, 9000\);/);

// The Worker may keep the proven audio batching/performance patches, but must
// not rewrite the 9-second startup window or live-disconnect ownership.
assert.doesNotMatch(worker, /sdr-player-live-disconnect-failover-v1/);
assert.doesNotMatch(worker, /PLAYER_LIVE_FAILOVER_MARKER/);
assert.doesNotMatch(worker, /Trying the next ranked receiver…'\);\n      \}\n    \};`/);
assert.doesNotMatch(worker, /30000/);
assert.match(worker, /known-good-connect-lifecycle-v1/);

console.log('known-good live SDR disconnect lifecycle guard passed');
