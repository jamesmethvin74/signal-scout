import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../full-data.js', import.meta.url), 'utf8');
assert.doesNotMatch(source, /fetch\s*\(/);
assert.doesNotMatch(source, /raw\.githubusercontent\.com/i);

const windowObject = {
  SIGNAL_SCOUT_STATIONS: [
    { band:'SW', frequency:9955, name:'WRMI', transmitter:'Okeechobee, Florida', lat:27.467, lon:-80.933 },
    { band:'MW', frequency:920, name:'KARN' }
  ]
};
const documentObject = { querySelector: () => null };

vm.runInNewContext(source, { window:windowObject, document:documentObject, Promise });
await windowObject.SIGNAL_SCOUT_DATA_READY;

assert.equal(windowObject.SIGNAL_SCOUT_FULL_SW.length,1);
assert.equal(windowObject.SIGNAL_SCOUT_FULL_SW[0].frequency,9955);
assert.equal(windowObject.SIGNAL_SCOUT_DATA_STATE.complianceMode,true);

console.log('full-data no-network compliance guard passed');
