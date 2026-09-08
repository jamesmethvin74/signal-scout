import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const worker = fs.readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const playerWorker = fs.readFileSync(new URL('../worker-v2.js', import.meta.url), 'utf8');

test('RF quality is measured at the exact tuned frequency instead of RSSI', () => {
  assert.match(worker, /function patchRfCarrierSignal\(source\)/);
  assert.match(worker, /const targetIndex = clamp\(Math\.round\(\(\(state\.targetKHz - startKHz\) \/ span\)/);
  assert.match(worker, /const carrierRadiusBins = Math\.max\(2, Math\.round\(0\.35 \/ binKHz\)\)/);
  assert.match(worker, /const guardBins = Math\.max\(carrierRadiusBins \+ 2, Math\.round\(0\.9 \/ binKHz\)\)/);
  assert.match(worker, /const floorDb = percentile\(noise, 0\.50\)/);
  assert.match(worker, /const framePresent = prominenceDb >= 4\.5/);
  assert.match(worker, /state\.carrierHistory\.length >= 6/);
  assert.match(worker, /presentVotes >= Math\.ceil\(state\.carrierHistory\.length \* 0\.60\)/);
  assert.match(worker, /freqbeacon:rf-carrier/);
});

test('missing RF waterfall is evidence to move an automatic broadcast listen', () => {
  assert.match(worker, /function publishCarrierUnavailable\(reason\)/);
  assert.match(worker, /carrierPresent: false/);
  assert.match(worker, /unavailable: true/);
  assert.match(worker, /if \(error && !state\.hasFrame\) publishCarrierUnavailable/);
});

test('player uses its existing bounded receiver fallback for repeated no-carrier evidence', () => {
  assert.match(playerWorker, /PLAYER_CARRIER_MARKER = 'sdr-player-carrier-aware-failover-v1'/);
  assert.match(playerWorker, /window\.addEventListener\('freqbeacon:rf-carrier', handleRfCarrier\)/);
  assert.match(playerWorker, /sdr\.carrierMisses = detail\.unavailable \? 2/);
  assert.match(playerWorker, /if \(sdr\.carrierMisses < 2\) return/);
  assert.match(playerWorker, /No usable carrier was heard at the tuned frequency/);
  assert.match(playerWorker, /const next = nextFallbackReceiver\(\)/);
  assert.match(playerWorker, /sdr\.fallbackTried\.add\(next\)/);
});

test('manual receiver and manual tuning remain user-controlled', () => {
  assert.match(playerWorker, /sdr\.carrierAuto = false/);
  assert.match(playerWorker, /sdr\.carrierAuto = true/);
  assert.match(playerWorker, /stationText === 'manual tuning'/);
});

test('live receiver disconnects fail over instead of returning to Tap Play', () => {
  assert.match(playerWorker, /The public receiver disconnected\. Trying the next ranked receiver/);
  assert.doesNotMatch(playerWorker, /setMessage\('The public receiver disconnected\. Tap Play to reconnect\.'/);
});

test('proven Kiwi transport is preserved', () => {
  assert.match(playerWorker, /const NEW_TSTAMP_SPACE = 1n << 62n/);
  assert.match(playerWorker, /\/ws\/kiwi\/\$\{upstreamTimestamp\}\/\$\{stream\}/);
  assert.match(playerWorker, /stream=SND/);
  assert.doesNotMatch(playerWorker, /instant-local-options/);
});

test('worker source files parse as JavaScript', () => {
  assert.doesNotThrow(() => new Function(worker.replace(/^import .*$/gm, '').replace(/export default/g, 'void')));
  assert.doesNotThrow(() => new Function(playerWorker.replace(/^import .*$/gm, '').replace(/export default/g, 'void')));
});
