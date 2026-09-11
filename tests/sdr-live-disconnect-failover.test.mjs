import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const health = fs.readFileSync(new URL('../sdr-health.js', import.meta.url), 'utf8');
const player = fs.readFileSync(new URL('../sdr-player.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');

test('short abnormal live sessions remain passive health evidence', () => {
  assert.match(health, /SHORT_LIVE_SESSION_MS = 30 \* 1000/);
  assert.match(health, /Number\(event\?\.code \|\| 0\) === 1006/);
  assert.match(health, /markFailure\(receiverId, 'disconnect'\)/);
  assert.match(health, /passive-health-v3/);
  assert.match(health, /Health is passive evidence only/);
});

test('real live socket death advances through the existing bounded ranked fallback', () => {
  assert.match(worker, /PLAYER_LIVE_FAILOVER_MARKER = 'sdr-player-live-disconnect-failover-v1'/);
  assert.match(worker, /The public receiver disconnected\. Trying the next ranked receiver…/);
  assert.match(worker, /x-freqbeacon-sdr-player-failover/);
  assert.match(worker, /liveFailoverApplied \? PLAYER_LIVE_FAILOVER_MARKER : 'live-failover-patch-miss'/);

  // The source player owns the bounded receiver set. Each attempted receiver is
  // marked once, already-tried indices are skipped, and exhaustion stops at
  // Unavailable instead of wrapping forever.
  assert.match(player, /if \(!sdr\.fallbackTried\.has\(index\)\) return index/);
  assert.match(player, /sdr\.fallbackTried\.add\(next\)/);
  assert.match(player, /sdr\.fallbackTried\.add\(sdr\.receiverIndex\)/);
  assert.match(player, /if \(next == null\) \{/);
  assert.match(player, /setStatus\('Unavailable', false\)/);
  assert.match(player, /The ranked public receivers did not answer\. Tap Retry or choose another receiver\./);
});

test('startup and healthy-stream lifecycle stay on the proven non-carrier path', () => {
  assert.match(player, /\}, 9000\);/);
  assert.doesNotMatch(worker, /30000/);
  assert.match(worker, /known-good-connect-lifecycle-v1/);

  // Do not revive the #195/#196 carrier/dead-air or same-receiver retry bundle.
  assert.doesNotMatch(worker, /freqbeacon:rf-carrier/);
  assert.doesNotMatch(worker, /PLAYER_CARRIER_MARKER/);
  assert.doesNotMatch(worker, /carrierAutoAllowed/);
  assert.doesNotMatch(worker, /No usable carrier/);
  assert.doesNotMatch(worker, /CARRIER_STARTUP_GRACE_MS/);
  assert.doesNotMatch(worker, /SHORT_LIVE_RETRY_MS/);
  assert.doesNotMatch(worker, /Retrying the same receiver once/);
});

test('worker source still parses as JavaScript', () => {
  assert.doesNotThrow(() => new Function(worker.replace(/^import .*$/gm, '').replace(/export default/g, 'void')));
});

console.log('bounded live SDR disconnect failover guard passed');
