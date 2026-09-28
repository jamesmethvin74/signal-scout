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
assert.equal(result.nominalFrequencyKHz,9955); assert.equal(result.frequencyOffsetKHz,0);
result=await engine.identifyAsync(9953.2,{receiver:{lat:25.8,lon:-80.2},now:new Date('2026-09-15T19:00:00Z')});
assert.equal(result.kind,'exact'); assert.equal(result.entry.name,'A26 TEST 9955');
assert.equal(result.nominalFrequencyKHz,9955); assert.ok(Math.abs(result.frequencyOffsetKHz+1.8)<1e-9);
result=await engine.identifyAsync(9952.4,{receiver:{lat:25.8,lon:-80.2},now:new Date('2026-09-15T19:00:00Z')});
assert.notEqual(result.entry?.name,'A26 TEST 9955');
result=engine.identify(743.9,{receiver:{lat:33.68,lon:-117.83},now:new Date('2026-09-15T19:00:00Z')});
assert.equal(result.kind,'exact'); assert.equal(result.entry.callsign,'KBRT'); assert.equal(result.nominalFrequencyKHz,740);
result=engine.identify(744.1,{receiver:{lat:33.68,lon:-117.83},now:new Date('2026-09-15T19:00:00Z')});
assert.notEqual(result.entry?.callsign,'KBRT');
assert.equal(engine.frequencyToleranceKHz({type:'station',band:'MW'}),4);
assert.equal(engine.frequencyToleranceKHz({type:'station',band:'LW'}),2.5);
assert.equal(engine.frequencyToleranceKHz({type:'station',band:'SW'}),2.5);
assert.equal(engine.frequencyToleranceKHz({type:'signal'}),1);
assert.equal(engine.frequencyToleranceKHz({type:'station',band:'SW',matchToleranceKHz:1.75}),1.75);
result=engine.identify(740,{receiver:{lat:-33.86,lon:151.2},now:new Date('2026-09-15T19:00:00Z')});
assert.equal(result.kind,'range'); assert.match(result.range.name,/Medium Wave|AM Broadcast/i);
result=engine.identify(150,{receiver:{lat:0,lon:0},now:new Date('2026-09-15T19:00:00Z')});
assert.equal(result.kind,'range'); assert.match(result.range.name,/Longwave/i);

c.FREQBEACON_TERRESTRIAL_CATALOG=[
  {type:'station',band:'MW',frequencyKHz:999,name:'REG',country:'Canada',sourceAuthority:'ISED',sourceTier:1,dayLat:45,dayLon:-75,nightLat:50,nightLon:-100,dayPowerW:50000,nightPowerW:0,categories:['broadcast','MW']},
  {type:'station',band:'MW',frequencyKHz:693,name:'BBC Radio 5 Live',country:'United Kingdom',sourceAuthority:'Ofcom',sourceTier:1,lat:52.7,lon:-1.5,powerW:150000,categories:['broadcast','MW']},
  {type:'station',band:'MW',frequencyKHz:810,name:'BBC Radio Scotland',country:'United Kingdom',sourceAuthority:'Ofcom',sourceTier:1,lat:55.975,lon:-3.818,powerW:100000,categories:['broadcast','MW']},
  {type:'station',band:'MW',frequencyKHz:792,name:'Rádio Dechovka',country:'Czechia',sourceAuthority:'Czech Telecommunication Office',sourceTier:1,lat:50.231667,lon:15.745,powerW:5011,locationApproximate:false,categories:['broadcast','MW']}
];
c.FREQBEACON_TERRESTRIAL_FALLBACK_CATALOG=[
  {type:'station',band:'MW',frequencyKHz:999,name:'FALLBACK',country:'Canada',sourceAuthority:'EiBi',sourceTier:'reference/fallback',lat:45,lon:-75,powerW:50000,locationApproximate:true,categories:['broadcast','MW']},
  {type:'station',band:'MW',frequencyKHz:558,name:'IRIB Radio Iran',country:'Iran',sourceAuthority:'Recent independent reception confirmation',sourceTier:2,locationApproximate:true,language:'Persian',categories:['broadcast','MW']},
  {type:'station',band:'MW',frequencyKHz:864,name:'NMA Al-Quran al-Karim',country:'Egypt',sourceAuthority:'Recent independent reception confirmation',sourceTier:2,locationApproximate:true,language:'Arabic',categories:['broadcast','MW']},
  {type:'station',band:'MW',frequencyKHz:900,name:'Generic active alternate A',country:'Country A',sourceAuthority:'Test reviewed reference',sourceTier:2,lat:35,lon:30,powerW:50000,locationApproximate:false,categories:['broadcast','MW']},
  {type:'station',band:'MW',frequencyKHz:900,name:'Generic active alternate B',country:'Country B',sourceAuthority:'Test reviewed reference',sourceTier:2,lat:37,lon:31,powerW:40000,locationApproximate:false,categories:['broadcast','MW']}
];
await run(c,'freqbeacon-terrestrial-identification.js');
engine=c.FREQBEACON_IDENTIFICATION_ENGINE;
result=engine.identify(999,{receiver:{lat:45,lon:-75},now:new Date('2026-09-15T17:00:00Z')});
assert.equal(result.kind,'exact'); assert.equal(result.entry.name,'REG');
result=engine.identify(997,{receiver:{lat:45,lon:-75},now:new Date('2026-09-15T17:00:00Z')});
assert.equal(result.kind,'exact'); assert.equal(result.entry.name,'REG'); assert.equal(result.nominalFrequencyKHz,999);
result=engine.identify(999,{receiver:{lat:45,lon:-75},now:new Date('2026-09-16T05:00:00Z')});
assert.notEqual(result.entry?.name,'REG');

result=engine.identify(693,{receiver:{lat:58.6,lon:17.9},now:new Date('2026-09-27T23:49:00Z')});
assert.equal(result.kind,'exact');
assert.equal(result.entry.name,'BBC Radio 5 Live');
assert.equal(result.entry.country,'United Kingdom');

result=engine.identify(864,{receiver:{lat:35.1,lon:33.4},now:new Date('2026-09-27T23:47:00Z')});
assert.equal(result.kind,'exact');
assert.equal(result.entry.name,'NMA Al-Quran al-Karim');
assert.equal(result.entry.country,'Egypt');
assert.equal(result.confidence,'cataloged');

result=engine.identify(900,{receiver:{lat:35.1,lon:33.4},now:new Date('2026-09-27T23:47:00Z')});
assert.equal(result.kind,'exact');
assert.ok(result.alternatives.some((candidate)=>candidate.entry?.name === 'Generic active alternate B'));

const finland={lat:62.89,lon:27.68};
result=engine.identify(792,{receiver:finland,now:new Date('2026-09-28T02:11:00Z')});
assert.equal(result.kind,'exact');
assert.equal(result.entry.name,'Rádio Dechovka');
assert.equal(result.entry.country,'Czechia');
assert.equal(result.confidence,'likely');

result=engine.identify(810,{receiver:finland,now:new Date('2026-09-28T02:11:00Z')});
assert.equal(result.kind,'exact');
assert.equal(result.entry.name,'BBC Radio Scotland');
assert.equal(result.entry.country,'United Kingdom');
assert.equal(result.confidence,'likely');

const cyprus={lat:35.1,lon:33.4};
result=engine.identify(558,{receiver:cyprus,now:new Date('2026-09-28T02:13:00Z')});
assert.equal(result.kind,'exact');
assert.equal(result.entry.name,'IRIB Radio Iran');
assert.equal(result.entry.country,'Iran');
assert.equal(result.confidence,'cataloged');

result=engine.identify(865,{receiver:cyprus,now:new Date('2026-09-28T02:14:00Z')});
assert.equal(result.kind,'exact');
assert.equal(result.nominalFrequencyKHz,864);
assert.equal(result.entry.name,'NMA Al-Quran al-Karim');
assert.equal(result.entry.country,'Egypt');

console.log('terrestrial identification regressions: ok');
