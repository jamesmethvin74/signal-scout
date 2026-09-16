import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { normalizeISED, normalizeOfcom, normalizeLowFrequencyFallback } from './generate-global-terrestrial-catalog.mjs';
import { unzipEntries, findZipEntry } from './lib/terrestrial-catalog-lib.mjs';

const ISED_URL='https://www.ic.gc.ca/engineering/BC_DBF_FILES/baserad.zip';
const A26_URL='https://raw.githubusercontent.com/Roger-Need/StationFinder/55076d0767a2ba4a6d46a71d98c66db624749797/Frequency%20Lists/Merged/A26%20merged_schedule.csv';
const COUNTRY_URL='https://raw.githubusercontent.com/google/dspl/db79dad685276dbf98ca44b875d1481bc240c5c1/samples/google/canonical/countries.csv';

async function fetchBuffer(url){const r=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(`${url} ${r.status}`);return Buffer.from(await r.arrayBuffer());}
async function fetchText(url){return (await fetchBuffer(url)).toString('utf8').replace(/^\uFEFF/,'');}
function validate(rows,label,min){
  if(rows.length<min) throw new Error(`${label} count ${rows.length}`);
  for(const x of rows){
    if(!Number.isFinite(x.frequencyKHz)||x.frequencyKHz<=0) throw new Error(`${label} bad freq`);
    if(Number.isFinite(x.lat)&&(!Number.isFinite(x.lon)||Math.abs(x.lat)>90||Math.abs(x.lon)>180)) throw new Error(`${label} bad coord ${x.callsign||x.name}`);
    for(const p of [x.powerW,x.dayPowerW,x.nightPowerW,x.criticalPowerW].filter(Number.isFinite)){if(p<0||p>5e6)throw new Error(`${label} bad power ${x.callsign||x.name} ${p}`);}
  }
}
function marker(rows,freq,re,label){if(!rows.some(x=>Math.abs(x.frequencyKHz-freq)<0.1&&re.test(`${x.callsign||''} ${x.name||''}`)))throw new Error(`${label} marker missing`);}

const isedZip=unzipEntries(await fetchBuffer(ISED_URL));
const amDbf=findZipEntry(isedZip,'amstatio.dbf'); if(!amDbf) throw new Error('ISED AMSTATIO missing');
const ca=normalizeISED(amDbf); validate(ca,'ISED',150); marker(ca,740,/CFZM/i,'ISED');

const ofcomRaw=gunzipSync(await readFile('data/ofcom/txparamsmf-2026-08-05.csv.gz')).toString('utf8').replace(/^\uFEFF/,'');
const uk=normalizeOfcom(ofcomRaw); validate(uk,'Ofcom',50); marker(uk,648,/Radio Caroline/i,'Ofcom');

const [a26,countries]=await Promise.all([fetchText(A26_URL),fetchText(COUNTRY_URL)]);
const fallback=normalizeLowFrequencyFallback(a26,countries); validate(fallback,'EiBi fallback',30);

console.log(`non-ACMA terrestrial inputs ok CA ${ca.length} UK ${uk.length} fallback ${fallback.length}`);
