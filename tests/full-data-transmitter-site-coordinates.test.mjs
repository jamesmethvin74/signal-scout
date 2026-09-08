import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../full-data.js', import.meta.url), 'utf8');

const header = 'Frequency,M,Station,On,Off,Language,Site,TX Country,Days,Target,Power,Azimuth,Origin,Source';
const rows = Array.from({ length: 501 }, (_, index) => {
  const frequencyHz = 5050000 + index * 1000;
  return `${frequencyHz},AM,Radio Miami International,0000,0500,English / Spanish,"Okeechobee, FL",United States,1234567,,100,160,United States,HFCC`;
});
const scheduleText = [header, ...rows].join('\n');
const countriesText = 'name,latitude,longitude\nUnited States,39.8283,-98.5795';

const windowObject = {
  SIGNAL_SCOUT_STATIONS: [
    {
      band: 'SW',
      frequency: 5010,
      name: 'WRMI',
      country: 'United States',
      transmitter: 'Okeechobee, Florida',
      lat: 27.467,
      lon: -80.933
    }
  ],
  setTimeout
};

const documentObject = {
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null
};

const fetch = async (url) => ({
  ok: true,
  text: async () => String(url).includes('merged_schedule') ? scheduleText : countriesText
});

vm.runInNewContext(source, {
  window: windowObject,
  document: documentObject,
  fetch,
  console,
  setTimeout,
  clearTimeout
});

await windowObject.SIGNAL_SCOUT_DATA_READY;

const wrmi5050 = windowObject.SIGNAL_SCOUT_FULL_SW.find((station) => station.frequency === 5050 && station.name === 'WRMI');
assert.ok(wrmi5050, 'expected the A26 WRMI 5050 kHz row to be built');
assert.equal(wrmi5050.transmitter, 'Okeechobee, FL');
assert.equal(wrmi5050.lat, 27.467);
assert.equal(wrmi5050.lon, -80.933);
assert.equal(wrmi5050.locationApproximate, false);
assert.notEqual(wrmi5050.lat, 39.8283, 'must not use the U.S. centroid when the transmitter city is known');
assert.notEqual(wrmi5050.lon, -98.5795, 'must not use the U.S. centroid when the transmitter city is known');

console.log('full-data transmitter-site coordinate guard passed');
