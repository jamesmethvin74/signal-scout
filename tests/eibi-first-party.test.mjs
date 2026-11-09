import assert from 'node:assert/strict';
import {
  eibiSeason, lastSundayUTC, termsAllowUse, parseEiBi,
  scheduleActive, refreshEiBiIfDue, eibiResponse
} from '../eibi-first-party.js';

// A/B rollover: last Sunday of March -> summer; last Sunday October -> winter.
assert.equal(lastSundayUTC(2026,2),29);
assert.equal(lastSundayUTC(2026,9),25);
assert.equal(eibiSeason(new Date('2026-11-09T21:00:00Z')),'b26');
assert.equal(eibiSeason(new Date('2027-01-03T12:00:00Z')),'b26');
assert.equal(eibiSeason(new Date('2027-03-27T23:00:00Z')),'b26');
assert.equal(eibiSeason(new Date('2027-03-28T12:00:00Z')),'a27');

const terms = 'All frequency lists are free of charge. Everybody is absolutely free to download, use, copy or distribute these files as well as to use them in third-party software.';
assert.equal(termsAllowUse(terms),true);
assert.equal(termsAllowUse('Files may be downloaded for private viewing only'),false);

const data=[
  'kHz;Time(UTC);Days;ITU;Station;Lang.;Target;Remarks',
  '9955;0000-2400;Mo-Fr;USA;WRMI Miami;E;NAm;Okeechobee',
  '7340;2300-0100;Mo;ROU;Radio Romania Int.;E;NAm;Bucharest',
  '6115;0800-0900;1;USA;Monday broadcast;E;NAm;',
  '6050;0800-0900;7;USA;Sunday broadcast;E;NAm;',
  '6070;0800-0900;irr;USA;Irregular;E;NAm;',
  '12000;0500-0600;;USA;"Station ""Quoted""";-CW;Eu;Test',
  'not-frequency;0800-0900;;USA;skip;E;NAm;',
].join('\n');
const rows=parseEiBi(data);
assert.equal(rows.length,6);
assert.equal(rows[0].frequencyKHz,9955);
assert.equal(rows[5].name,'Station "Quoted"');
assert.equal(rows[5].type,'service');
assert.equal(scheduleActive(rows[0],new Date('2026-11-09T12:00:00Z')),true);
assert.equal(scheduleActive(rows[0],new Date('2026-11-08T12:00:00Z')),false);
assert.equal(scheduleActive(rows[1],new Date('2026-11-10T00:30:00Z')),true); // Monday overnight
assert.equal(scheduleActive(rows[1],new Date('2026-11-11T00:30:00Z')),false);
assert.equal(scheduleActive(rows[2],new Date('2026-11-09T08:30:00Z')),true);
assert.equal(scheduleActive(rows[2],new Date('2026-11-08T08:30:00Z')),false);
assert.equal(scheduleActive(rows[3],new Date('2026-11-08T08:30:00Z')),true);
assert.equal(scheduleActive(rows[4],new Date('2026-11-09T08:30:00Z')),null);
assert.throws(()=>parseEiBi('x'.repeat(5_000_001)),/size limit/);

class MockD1 {
  constructor(){this.meta=new Map();this.rows=new Map();}
  prepare(sql){
    const db=this;
    return { values:[],bind(...v){this.values=v;return this;},
      async first(){
        if(sql.startsWith('SELECT value'))return {value:db.meta.get(this.values[0])||null};
        throw Error('Unknown first query '+sql);
      },
      async all(){
        if(sql.startsWith('SELECT payload')){
          const [snapshot,lo,hi]=this.values;
          return {results:[...db.rows.values()].filter(r=>r.snapshot===snapshot && r.frequency>=lo && r.frequency<=hi).map(r=>({payload:r.payload}))};
        }
        throw Error('Unknown all query '+sql);
      },
      async run(){
        if(sql.startsWith('CREATE '))return {meta:{changes:0}};
        if(sql.includes("VALUES('attempt',?)")){
          const [time,cutoff]=this.values;
          if(Number(db.meta.get('attempt')||0)>=Number(cutoff))return {meta:{changes:0}};
          db.meta.set('attempt',time);return {meta:{changes:1}};
        }
        if(sql.startsWith('INSERT OR REPLACE INTO freqbeacon_eibi_frequency')){
          for(let i=0;i<this.values.length;i+=3) {
            const [snapshot,frequency,payload]=this.values.slice(i,i+3);
            db.rows.set(snapshot+'|'+frequency,{snapshot,frequency,payload});
          }
          return {meta:{changes:this.values.length/3}};
        }
        if(sql.startsWith('INSERT INTO freqbeacon_eibi_meta')){
          db.meta.set(this.values[0],this.values[1]);return {meta:{changes:1}};
        }
        if(sql.startsWith('DELETE FROM freqbeacon_eibi_frequency')){
          for(const [k,r] of db.rows)if(r.snapshot!==this.values[0])db.rows.delete(k);
          return {meta:{changes:1}};
        }
        throw Error('Unknown run query '+sql);
      }
    };
  }
  async batch(stmts){return Promise.all(stmts.map(s=>s.run()));}
}

const db = new MockD1();
const env={RECEIVER_HEALTH_DB:db};
const rowsLarge = Array.from({length:2400},(_,i)=>
  (i===0?9955:3000+(i%2000)*10)+';0000-2400;1234567;USA;'+
  (i===0?'WRMI':'Test station '+i)+';E;NAm;Test transmitter').join('\n');
const oldFetch=globalThis.fetch;
let fetches=0;
globalThis.fetch=async url=>{
  fetches++;
  const body=String(url).includes('README.TXT')?terms:rowsLarge;
  return {ok:true,headers:new Map([['content-length',String(body.length)]]),text:async()=>body};
};
try {
  const now = new Date('2026-11-09T22:00:00Z');
  const r=await refreshEiBiIfDue(env,now);
  assert.equal(r.status,'updated');
  assert.equal(r.season,'B26');
  assert.equal(r.rowCount,2400);
  assert.ok(r.frequencyCount>=300);
  assert.equal(fetches,2);
  const cached=await refreshEiBiIfDue(env,new Date(now.getTime()+3600000));
  assert.equal(cached.status,'fresh');
  assert.equal(fetches,2);
  const response=await eibiResponse(new Request('https://example.test/api/eibi/identify?frequency=9955&at=2020-01-01T00%3A00%3A00Z'),env);
  // The read API intentionally applies a 45-day request clock bound.
  assert.equal(response.status,400);

  // A failed refresh never replaces an active, already published version.
  globalThis.fetch=async()=>({ok:false,status:403,headers:new Map(),text:async()=>''});
  const failed=await refreshEiBiIfDue(env,new Date(now.getTime()+26*3600000));
  assert.equal(failed.status,'failed');
  assert.equal(JSON.parse(db.meta.get('active')).snapshot,r.snapshot);
  assert.ok(db.rows.size>=40);
} finally { globalThis.fetch=oldFetch; }
// One-time read-only integration probe of the already-built Cloudflare preview.
// This uses the real Worker API and D1 binding, not an emulated response.
if (process.env.CI === 'true') {
  const host = 'https://eaa44f4c-signal-scout.james-methvin74.workers.dev';
  for (const endpoint of ['/api/eibi/status', '/api/eibi/identify?frequency=9955']) {
    try {
      const r = await fetch(host + endpoint, {signal:AbortSignal.timeout(27000)});
      const payload = await r.text();
      console.log('EIBI PREVIEW INTEGRATION:',JSON.stringify({endpoint,http:r.status,response:payload.slice(0,1200)}));
    } catch(error) {
      console.log('EIBI PREVIEW INTEGRATION ERROR:',endpoint,error?.message||String(error));
    }
  }
}
console.log('EiBi season, publisher terms, schedule parser, D1 cache and safe-refresh tests passed');
