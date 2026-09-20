import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

async function script(name){ return readFile(new URL(`../${name}`, import.meta.url), 'utf8'); }
function context(){
  const c={console,Date,Math,Number,String,Array,Object,Map,Set,Promise,JSON,RegExp,Infinity,NaN};
  c.fetch=async(url)=>{
    if(String(url).includes('/data/identification/a26/sw-7500-11999.json')){
      return {
        ok:true,
        json:async()=>({
          season:'A26',
          entries:[{
            type:'station',band:'SW',frequencyKHz:9955,name:'A26 TEST 9955',
            location:'Miami, FL',country:'United States',lat:25.8,lon:-80.2,
            powerW:100000,mode:'AM',start:'0000',end:'2400',days:'1234567',
            language:'English',source:'HFCC + EiBi A26 test fixture',categories:['shortwave','broadcast']
          }]
        })
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
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
result=await engine.identifyAsync(9955,{receiver:{lat:25.8,lon:-80.2},now:new Date('2026-09-15T19:00:00Z')});
assert.equal(result.kind,'exact'); assert.equal(result.entry.band,'SW'); assert.equal(result.entry.name,'A26 TEST 9955');
result=engine.identify(740,{receiver:{lat:-33.86,lon:151.2},now:new Date('2026-09-15T19:00:00Z')});
assert.equal(result.kind,'range'); assert.match(result.range.name,/Medium Wave|AM Broadcast/i);
result=engine.identify(150,{receiver:{lat:0,lon:0},now:new Date('2026-09-15T19:00:00Z')});
assert.equal(result.kind,'range'); assert.match(result.range.name,/Longwave/i);

console.log('base exact and range identification regressions: ok');
