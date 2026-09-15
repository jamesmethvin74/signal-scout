import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function script(name){ return readFile(new URL(`../${name}`, import.meta.url), 'utf8'); }
function context(){
  const c={console,Date,Math,Number,String,Array,Object,Map,Set,Promise,JSON,RegExp,Infinity,NaN,fetch:async()=>{throw new Error('unexpected fetch');}};
  c.window=c; vm.createContext(c); return c;
}
async function run(c,name){ vm.runInContext(await script(name),c,{filename:name}); }

const c=context();
for(const name of ['freqbeacon-zero-am-catalog.js','freqbeacon-zero-us-am-fcc.js','freqbeacon-zero-am-merge.js','stations.js','ham-bands.js','freqbeacon-zero-identification-data.js','freqbeacon-identification-engine.js']) await run(c,name);
const engine=c.FREQBEACON_IDENTIFICATION_ENGINE;

let result=engine.identify(740,{receiver:{lat:33.68,lon:-117.83},now:new Date('2026-09-15T19:00:00Z')});
assert.equal(result.kind,'exact'); assert.equal(result.entry.callsign,'KBRT');
result=engine.identify(660,{receiver:{lat:40.72,lon:-74.0},now:new Date('2026-09-15T19:00:00Z')});
assert.equal(result.kind,'exact'); assert.equal(result.entry.callsign,'WFAN');

console.log('US AM identification regressions: ok');
