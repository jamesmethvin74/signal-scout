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
let engine=c.FREQBEACON_IDENTIFICATION_ENGINE;

let result=engine.identify(740,{receiver:{lat:33.68,lon:-117.83},now:new Date('2026-09-15T19:00:00Z')});
assert.equal(result.kind,'exact'); assert.equal(result.entry.callsign,'KBRT');
result=engine.identify(660,{receiver:{lat:40.72,lon:-74.0},now:new Date('2026-09-15T19:00:00Z')});
assert.equal(result.kind,'exact'); assert.equal(result.entry.callsign,'WFAN');
result=engine.identify(9955,{receiver:{lat:25.8,lon:-80.2},now:new Date('2026-09-15T19:00:00Z')});
assert.equal(result.kind,'exact'); assert.equal(result.entry.band,'SW');
result=engine.identify(740,{receiver:{lat:-33.86,lon:151.2},now:new Date('2026-09-15T19:00:00Z')});
assert.equal(result.kind,'range'); assert.match(result.range.name,/Medium Wave|AM Broadcast/i);

c.FREQBEACON_TERRESTRIAL_CATALOG=[
  {type:'station',band:'MW',frequencyKHz:999,name:'REG',country:'Canada',sourceAuthority:'ISED',sourceTier:1,dayLat:45,dayLon:-75,nightLat:50,nightLon:-100,dayPowerW:50000,nightPowerW:0,categories:['broadcast','MW']}
];
c.FREQBEACON_TERRESTRIAL_FALLBACK_CATALOG=[
  {type:'station',band:'MW',frequencyKHz:999,name:'FALLBACK',country:'Canada',sourceAuthority:'EiBi',sourceTier:'reference/fallback',lat:45,lon:-75,powerW:50000,locationApproximate:true,categories:['broadcast','MW']}
];
await run(c,'freqbeacon-terrestrial-identification.js');
engine=c.FREQBEACON_IDENTIFICATION_ENGINE;
result=engine.identify(999,{receiver:{lat:45,lon:-75},now:new Date('2026-09-15T17:00:00Z')});
assert.equal(result.kind,'exact'); assert.equal(result.entry.name,'REG');
result=engine.identify(999,{receiver:{lat:45,lon:-75},now:new Date('2026-09-16T05:00:00Z')});
assert.notEqual(result.entry?.name,'REG');

console.log('terrestrial identification regressions: ok');
