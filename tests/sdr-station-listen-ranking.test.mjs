import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../worker-base.js', import.meta.url), 'utf8');

function loadRanker() {
  const instrumented = source
    .replace('export default {', 'globalThis.__workerDefault = {')
    .concat('\nglobalThis.__rankReceivers = rankReceivers;\n');
  const context = { console, Math, Date, URL };
  context.globalThis = context;
  vm.runInNewContext(instrumented, context, { filename: 'worker-base.js' });
  return context.__rankReceivers;
}

const rankReceivers = loadRanker();

const receivers = [
  {
    id: 'arkansas-near-user:8073',
    name: 'Arkansas near user',
    location: 'Central Arkansas',
    lat: 35.20,
    lon: -92.30,
    minKHz: 10,
    maxKHz: 30000,
    coverageKnown: true,
    source: 'receiverbook'
  },
  {
    id: 'maine-near-station:8073',
    name: 'Maine near station',
    location: 'Northern Maine',
    lat: 45.50,
    lon: -68.50,
    minKHz: 10,
    maxKHz: 30000,
    coverageKnown: true,
    source: 'receiverbook'
  },
  {
    id: 'pennsylvania-middle:8073',
    name: 'Pennsylvania middle',
    location: 'Pennsylvania',
    lat: 41.00,
    lon: -76.00,
    minKHz: 10,
    maxKHz: 30000,
    coverageKnown: true,
    source: 'receiverbook'
  }
];

const conway = { userLat: 35.0887, userLon: -92.4421 };
const wbcq = { txLat: 46.333, txLon: -67.833 };

test('known-transmitter HF Listen Live chooses a station-side receiver, not the receiver nearest the user', () => {
  const ranked = rankReceivers(receivers, {
    frequencyKHz: 6160,
    ...conway,
    ...wbcq
  });

  assert.equal(ranked[0].id, 'maine-near-station:8073');
  assert.equal(ranked[0].recommended, true);
  assert.equal(ranked[0].role, 'STATION CHECK');
  assert.ok(ranked.some((receiver) => receiver.id === 'arkansas-near-user:8073' && receiver.role === 'NEAR YOU'));
});

test('MW and local listening still chooses the receiver nearest the user', () => {
  const ranked = rankReceivers(receivers, {
    frequencyKHz: 1000,
    ...conway,
    ...wbcq
  });

  assert.equal(ranked[0].id, 'arkansas-near-user:8073');
  assert.equal(ranked[0].recommended, true);
  assert.equal(ranked[0].role, 'NEAR YOU');
});

test('HF station-first score no longer gives user proximity half of the primary score', () => {
  assert.match(source, /function stationListeningScore\(distanceMiles, frequencyKHz\)/);
  assert.match(source, /stationReach \* 0\.82 \+ stationSolar \* 0\.18/);
  assert.doesNotMatch(source, /proximity \* 0\.50 \+ pathSimilarity \* 0\.38 \+ solar \* 0\.12/);
});
