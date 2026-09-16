import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  clean, num, parseCsv, rowsToObjects, pick, requireAnyHeaders,
  parseDbf, ddmmssToDecimal, unzipEntries, findZipEntry,
  osGridToWgs84, parseXlsxSheets, headerKey
} from './lib/terrestrial-catalog-lib.mjs';

const OUT = path.resolve('freqbeacon-zero-global-mw-lw.js');
const FALLBACK_OUT = path.resolve('freqbeacon-zero-global-mw-lw-fallback.js');
const ISED_URL = 'https://www.ic.gc.ca/engineering/BC_DBF_FILES/baserad.zip';
const OFCOM_URL = 'https://www.ofcom.org.uk/siteassets/resources/documents/spectrum/tv-transmitter-guidance/tech-parameters/txparamsmf.csv?v=423471';
const OFCOM_SNAPSHOT = path.resolve('data/ofcom/txparamsmf-2026-08-05.csv.gz');
const OFCOM_SNAPSHOT_SHA256 = '0348c032d137fbc11be6392c93f4e65fa891ecc07d82d847aa1d7605a88bd7e9';
const ACMA_URL = 'https://www.acma.gov.au/sites/default/files/2026-07/BroadcastTransmitterExcel.zip';
const A26_COMMIT = '55076d0767a2ba4a6d46a71d98c66db624749797';
const A26_URL = `https://raw.githubusercontent.com/Roger-Need/StationFinder/${A26_COMMIT}/Frequency%20Lists/Merged/A26%20merged_schedule.csv`;
const COUNTRY_COMMIT = 'db79dad685276dbf98ca44b875d1481bc240c5c1';
const COUNTRY_URL = `https://raw.githubusercontent.com/google/dspl/${COUNTRY_COMMIT}/samples/google/canonical/countries.csv`;
const CANADIAN_PROVINCES = new Set(['AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT']);
const UTILITY_RE = /\b(?:ndb|beacon|navtex|navigation|aero|aviation|marine|maritime|coast guard|weather fax|\bfax\b|rtty|time signal|standard frequency)\b/i;
const FETCH_ATTEMPTS = 3;
const FETCH_TIMEOUT_MS = 30000;
const RETRYABLE_HTTP = new Set([408,425,429,500,502,503,504]);

async function fetchBuffer(url,label){
  let lastError=null;
  for(let attempt=1;attempt<=FETCH_ATTEMPTS;attempt+=1){
    try{
      const r=await fetch(url,{redirect:'follow',headers:{'user-agent':'FREQBEACON catalog builder/2.0 (+https://freqbeacon.methvindigitalworks.com)'},signal:AbortSignal.timeout(FETCH_TIMEOUT_MS)});
      if(!r.ok){
        const error=new Error(`${label} fetch failed: ${r.status} ${r.statusText}`);
        if(!RETRYABLE_HTTP.has(r.status)){ error.nonRetryable=true; throw error; }
        lastError=error;
      }else{
        return Buffer.from(await r.arrayBuffer());
      }
    }catch(error){
      if(error?.nonRetryable) throw error;
      lastError=error;
    }
    if(attempt<FETCH_ATTEMPTS) await new Promise(resolve=>setTimeout(resolve,500*attempt));
  }
  const detail=lastError instanceof Error?`${lastError.name}: ${lastError.message}`:String(lastError||'unknown error');
  throw new Error(`${label} fetch failed after ${FETCH_ATTEMPTS} attempts: ${detail}`);
}
async function fetchText(url,label){ return (await fetchBuffer(url,label)).toString('utf8').replace(/^\uFEFF/,''); }
async function readOfcomSnapshot(){
  const compressed=await readFile(OFCOM_SNAPSHOT);
  let raw;
  try{ raw=gunzipSync(compressed); }
  catch(error){ throw new Error(`Pinned Ofcom MF snapshot is not valid gzip: ${error?.message||error}`); }
  const sha256=createHash('sha256').update(raw).digest('hex');
  if(sha256!==OFCOM_SNAPSHOT_SHA256) throw new Error(`Pinned Ofcom MF snapshot SHA-256 mismatch: expected ${OFCOM_SNAPSHOT_SHA256}, got ${sha256}`);
  return raw.toString('utf8').replace(/^\uFEFF/,'');
}
function validCoord(lat,lon){ return Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180; }
function stationBase(authority,tier,country){ return {type:'station',sourceAuthority:authority,sourceTier:tier,sourceCountry:country,technicalConfidence:tier===1?'regulator':'reference'}; }

export function normalizeISED(dbfBuffer){
  const {fields,records}=parseDbf(dbfBuffer); const headers=fields.map(f=>f.name);
  requireAnyHeaders(headers,[['PROVINCE'],['CITY'],['CALL_SIGN'],['FREQUENCY'],['LATITUDE'],['LONGITUDE'],['LATITUDE2'],['LONGITUDE2'],['POWERDAY'],['POWERNIGHT'],['POWERCRIT']], 'ISED AMSTATIO.DBF');
  const out=[];
  for(const r of records){
    const region=clean(r.PROVINCE).toUpperCase(), callsign=clean(r.CALL_SIGN).toUpperCase(), frequencyKHz=num(r.FREQUENCY);
    if(!CANADIAN_PROVINCES.has(region)||!callsign||/^\d/.test(callsign)||!Number.isFinite(frequencyKHz)||frequencyKHz<530||frequencyKHz>1700) continue;
    const nightLat=ddmmssToDecimal(r.LATITUDE), nightLon=ddmmssToDecimal(r.LONGITUDE,true), dlat=ddmmssToDecimal(r.LATITUDE2), dlon=ddmmssToDecimal(r.LONGITUDE2,true);
    if(!validCoord(nightLat,nightLon)) continue;
    const dayLat=validCoord(dlat,dlon)?dlat:nightLat, dayLon=validCoord(dlat,dlon)?dlon:nightLon;
    const dayPowerW=Math.max(0,num(r.POWERDAY)||0), nightPowerW=Math.max(0,num(r.POWERNIGHT)||0), criticalPowerW=Math.max(0,num(r.POWERCRIT)||0);
    if(dayPowerW<=0&&nightPowerW<=0&&criticalPowerW<=0) continue;
    out.push({...stationBase('ISED',1,'Canada'),id:`ised:${callsign}:${clean(r.BANNER)||'?'}:${frequencyKHz}`,sourceId:`${callsign}${clean(r.BANNER)}`,band:'MW',frequencyKHz,callsign,name:callsign,location:`${clean(r.CITY)}, ${region}`,country:'Canada',region,class:clean(r.CLASS),status:`D:${clean(r.STATUS1)||'?'} N:${clean(r.STATUS2)||'?'}`,mode:'AM',lat:nightLat,lon:nightLon,dayLat,dayLon,nightLat,nightLon,dayPowerW,nightPowerW,...(criticalPowerW?{criticalPowerW}:{}),categories:['broadcast','MW'],description:`ISED regulator AM technical record for ${clean(r.CITY)}, ${region}.`,source:'Innovation, Science and Economic Development Canada Broadcasting Database (AMSTATIO.DBF)',sourceDate:'2026-09-02',locationApproximate:false});
  }
  return out;
}

function parseOfcomEmrp(raw){
  const text=clean(raw).replace(/,/g,'');
  if(!text) return null;
  const match=text.match(/^([-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?)\s*(kW|W)?$/i);
  if(!match) return null;
  const value=Number(match[1]);
  return Number.isFinite(value)?{value,unit:(match[2]||'').toLowerCase()}:null;
}
function ofcomPower(row){
  const key=Object.keys(row).find(k=>/in.?use.*emrp/i.test(k));
  if(!key) throw new Error('Ofcom MF CSV missing In-use EMRP column');
  const parsed=parseOfcomEmrp(row[key]); if(!parsed) return null;
  if(parsed.unit==='kw') return parsed.value*1000;
  if(parsed.unit==='w') return parsed.value;
  if(/\bkw\b/i.test(key)) return parsed.value*1000;
  if(/\bw\b|watt/i.test(key)) return parsed.value;
  if(/^in.?use.*emrp$/i.test(clean(key))) return parsed.value*1000;
  throw new Error(`Ofcom EMRP unit/header not recognized: ${key}`);
}
export function normalizeOfcom(csvText){
  const rows=parseCsv(csvText); const headers=rows[0].map(clean);
  requireAnyHeaders(headers,[['Station'],['Area'],['Site'],['Frequency','Frequency (kHz)','Frequency kHz'],['OS National Grid Reference','NGR','OS NGR'],['In-use EMRP','In-use EMRP (kW)','In-Use EMRP (kW)','In-use EMRP kW']], 'Ofcom MF CSV');
  const objects=rowsToObjects(rows), out=[];
  for(const r of objects){
    const frequencyKHz=num(pick(r,['Frequency (kHz)','Frequency kHz','Frequency'])); if(!Number.isFinite(frequencyKHz)||frequencyKHz<500||frequencyKHz>1800) continue;
    const ngr=pick(r,['OS National Grid Reference','OS NGR','NGR']); let coord; try{coord=osGridToWgs84(ngr);}catch{continue;}
    const powerW=ofcomPower(r); if(!Number.isFinite(powerW)||powerW<=0) continue;
    const name=pick(r,['Station']), area=pick(r,['Area']), site=pick(r,['Site']), date=pick(r,['Date','Effective Date','Change Date']);
    out.push({...stationBase('Ofcom',1,'United Kingdom'),id:`ofcom:${frequencyKHz}:${headerKey(name)}:${headerKey(site)}`,sourceId:`${frequencyKHz}:${name}:${site}`,band:'MW',frequencyKHz,callsign:'',name,location:[site,area].filter(Boolean).join(', '),country:'United Kingdom',serviceArea:area,lat:coord.lat,lon:coord.lon,powerW,mode:'AM',status:'On air',categories:['broadcast','MW'],description:`Ofcom on-air MF transmitter serving ${area||'the United Kingdom'}.`,source:'Ofcom Technical parameters for broadcast radio transmitters — MF CSV',sourceDate:date||'2026-08-05',locationApproximate:false});
  }
  return out;
}

function coordinateValue(v,isLon=false){
  const raw=clean(v); if(!raw) return null; const simple=Number(raw);
  if(Number.isFinite(simple)&&Math.abs(simple)<=(isLon?180:90)) return simple;
  const parts=raw.match(/-?\d+(?:\.\d+)?/g)?.map(Number)||[];
  if(parts.length>=3){const sign=/[SW]/i.test(raw)||parts[0]<0?-1:1; return sign*(Math.abs(parts[0])+parts[1]/60+parts[2]/3600);}
  return null;
}
function findHeaderRow(rows){ for(let i=0;i<Math.min(rows.length,30);i++){const keys=rows[i].map(headerKey); if(keys.some(k=>k.includes('callsign'))&&keys.some(k=>k.includes('frequency'))) return i;} return -1; }
function acmaFrequencyKHz(row){
  const key=Object.keys(row).find(k=>['frequency','frequencykhz','frequencymhz'].includes(headerKey(k)));
  if(!key) throw new Error(`ACMA AM sheet missing frequency column; got ${Object.keys(row).join(', ')}`);
  const value=num(row[key]); if(!Number.isFinite(value)) return null;
  const normalized=headerKey(key);
  if(normalized==='frequencymhz') return value*1000;
  if(normalized==='frequencykhz'||normalized==='frequency') return value;
  throw new Error(`ACMA frequency unit/header not recognized: ${key}`);
}
function acmaPowerW(row){
  const key=Object.keys(row).find(k=>{
    if(!/(erp|power)/i.test(k)) return false;
    return /\(\s*kw\s*\)|\bkw\b|\bkilowatts?\b|\(\s*w\s*\)|\bwatts?\b|\bw\b/i.test(k);
  });
  if(!key) throw new Error(`ACMA AM power header lacks explicit W/kW unit; got ${Object.keys(row).join(', ')}`);
  const value=num(row[key]); if(!Number.isFinite(value)) return null;
  const isKw=/\(\s*kw\s*\)|\bkw\b|\bkilowatts?\b/i.test(key);
  return isKw?value*1000:value;
}
export function normalizeACMARows(rows){
  const hi=findHeaderRow(rows); if(hi<0) throw new Error('ACMA AM sheet header row not found');
  const headers=rows[hi].map(clean);
  requireAnyHeaders(headers,[['Callsign','Call Sign'],['Frequency','Frequency (kHz)','Frequency kHz','Frequency(MHz)','Frequency (MHz)','Frequency MHz'],['Service Area','Area Served']], 'ACMA AM sheet');
  const objects=rowsToObjects([headers,...rows.slice(hi+1)]), out=[];
  for(const r of objects){
    const callsign=pick(r,['Callsign','Call Sign']).toUpperCase(), frequencyKHz=acmaFrequencyKHz(r);
    if(!callsign||!Number.isFinite(frequencyKHz)||frequencyKHz<500||frequencyKHz>1800) continue;
    const status=pick(r,['Status','Licence Status','License Status']); if(status&&!/^issued$/i.test(status)) continue;
    const lat=coordinateValue(pick(r,['Latitude','Lat']),false), lon=coordinateValue(pick(r,['Longitude','Long','Lon']),true); if(!validCoord(lat,lon)) continue;
    const powerW=acmaPowerW(r); if(!Number.isFinite(powerW)||powerW<=0) continue;
    const area=pick(r,['Service Area','Area Served']), site=pick(r,['Transmitter','Transmitter Site','Site','Site Name','Location']), purpose=pick(r,['Purpose','Service Type']), licence=pick(r,['Licence Number','License Number','Licence No','Licence No.']);
    out.push({...stationBase('ACMA',1,'Australia'),id:`acma:${licence||callsign}:${frequencyKHz}:${headerKey(site)}`,sourceId:licence||`${callsign}:${frequencyKHz}:${site}`,band:'MW',frequencyKHz,callsign,name:callsign,location:[site,area].filter(Boolean).join(', '),country:'Australia',serviceArea:area,lat,lon,powerW,mode:'AM',status:status||'Licensed',class:purpose||undefined,categories:['broadcast','MW'],description:`ACMA licensed AM transmitter${area?` serving ${area}`:''}.`,source:'Australian Communications and Media Authority Licensed Broadcasting Transmitter Data',sourceDate:'2026-07-13',locationApproximate:false});
  }
  return out;
}
export function normalizeACMA(outerZip){
  const outer=unzipEntries(outerZip); const xlsx=[...outer.entries()].find(([n])=>/\.xlsx$/i.test(n));
  if(!xlsx) throw new Error(`ACMA ZIP contains no XLSX; entries: ${[...outer.keys()].join(', ')}`);
  const sheets=parseXlsxSheets(xlsx[1]);
  const sheet=sheets.find(s=>/^am$/i.test(clean(s.name)))||sheets.find(s=>/\bam\b|mf/i.test(s.name));
  if(!sheet) throw new Error(`ACMA workbook missing AM/MF sheet; sheets: ${sheets.map(s=>s.name).join(', ')}`);
  return normalizeACMARows(sheet.rows);
}

function countryCentroids(text){ const rows=parseCsv(text); const objs=rowsToObjects(rows), m=new Map(); for(const r of objs){const name=clean(r.name),lat=num(r.latitude),lon=num(r.longitude); if(name&&validCoord(lat,lon))m.set(headerKey(name),{lat,lon});} return m; }
function countryKey(name){const k=headerKey(name); const a={uk:'unitedkingdom',greatbritain:'unitedkingdom',usa:'unitedstates',unitedstatesofamerica:'unitedstates',russianfederation:'russia'}; return a[k]||k;}
export function normalizeLowFrequencyFallback(scheduleText,countryText){
  const rows=parseCsv(scheduleText), objects=rowsToObjects(rows), countries=countryCentroids(countryText), out=[];
  for(const r of objects){
    if(clean(r.Source)!=='EiBi') continue;
    const hz=num(r.Frequency), kHz=hz/1000, inLW=kHz>=148.5&&kHz<=283.5, inMW=kHz>=520&&kHz<=1710; if(!inLW&&!inMW) continue;
    const station=clean(r.Station), language=clean(r.Language); if(!station||!clean(r.On)||!clean(r.Off)||language.startsWith('-')||UTILITY_RE.test(station)) continue;
    const country=clean(r['TX Country']||r.Origin)||'Unknown', c=countries.get(countryKey(country)), band=inLW?'LW':'MW', kw=num(r.Power);
    out.push({...stationBase('EiBi','reference/fallback',country),id:`eibi:${Math.round(hz)}:${headerKey(station)}:${clean(r.On)}:${clean(r.Off)}`,sourceId:`${Math.round(hz)}:${station}:${clean(r.On)}-${clean(r.Off)}`,band,frequencyKHz:kHz,name:station,location:clean(r.Site)||country,country,...(c?{lat:c.lat,lon:c.lon}:{}),locationApproximate:true,...(Number.isFinite(kw)&&kw>0?{powerW:kw*1000}:{}),mode:clean(r.M)||clean(r.Mode)||'AM',language,categories:['broadcast',band],description:`EiBi reference broadcast schedule${clean(r.Target)?`. Target: ${clean(r.Target)}`:''}.`,start:clean(r.On).padStart(4,'0'),end:clean(r.Off).padStart(4,'0'),days:clean(r.Days)||'1234567',target:clean(r.Target),source:'EiBi via FREQBEACON A26 merged schedule',season:'A26',sourceCommit:A26_COMMIT});
  }
  return out;
}

function validate(name,entries,min){
  if(entries.length<min) throw new Error(`Refusing suspicious ${name} catalog: ${entries.length} records (<${min})`);
  for(const e of entries){
    if(!Number.isFinite(e.frequencyKHz)||e.frequencyKHz<=0) throw new Error(`${name}: invalid frequency`);
    if(Number.isFinite(e.lat)&&!validCoord(e.lat,e.lon)) throw new Error(`${name}: invalid coordinates`);
    for(const p of [e.powerW,e.dayPowerW,e.nightPowerW,e.criticalPowerW].filter(Number.isFinite)){ if(p<0||p>5e6) throw new Error(`${name}: implausible power ${p}`); }
  }
}
function marker(entries,freq,name,label){ if(!entries.some(e=>Math.abs(e.frequencyKHz-freq)<0.1&&new RegExp(name,'i').test(`${e.callsign||''} ${e.name||''}`))) throw new Error(`${label} marker missing: ${name} ${freq}`); }
function stableDedupe(entries){ const seen=new Map(); for(const e of entries){const k=`${e.sourceAuthority}|${e.sourceId}|${e.frequencyKHz}|${e.country}|${headerKey(e.location)}`; if(!seen.has(k))seen.set(k,e);} return [...seen.values()].sort((a,b)=>a.frequencyKHz-b.frequencyKHz||String(a.country).localeCompare(String(b.country))||String(a.name).localeCompare(String(b.name))); }
function render(entries,meta,varName,metaName,comment){ return `(() => {\n  'use strict';\n  // ${comment} Do not hand-edit.\n  const entries = ${JSON.stringify(entries)};\n  window.${varName} = Object.freeze(entries.map((e) => Object.freeze({...e, categories:Object.freeze([...(e.categories||[])])})));\n  window.${metaName} = Object.freeze(${JSON.stringify(meta)});\n})();\n`; }

async function main(){
  // Cloudflare's build network is reliable for these sources individually,
  // but concurrent regulator downloads can starve/timeout one another. Keep
  // the slow national archives serialized; only parallelize the lightweight
  // GitHub text inputs after the regulator fetches are complete.
  const ofcomText=await readOfcomSnapshot();
  const isedZipBuf=await fetchBuffer(ISED_URL,'ISED broadcasting database');
  const acmaZip=await fetchBuffer(ACMA_URL,'ACMA transmitter workbook');
  const [a26Text,countryText]=await Promise.all([
    fetchText(A26_URL,'A26 merged schedule'),
    fetchText(COUNTRY_URL,'country centroids')
  ]);
  const isedZip=unzipEntries(isedZipBuf), amDbf=findZipEntry(isedZip,'amstatio.dbf'); if(!amDbf) throw new Error(`ISED archive missing AMSTATIO.DBF; entries: ${[...isedZip.keys()].join(', ')}`);
  const ca=normalizeISED(amDbf), uk=normalizeOfcom(ofcomText), au=normalizeACMA(acmaZip), fallback=normalizeLowFrequencyFallback(a26Text,countryText);
  validate('Canada/ISED',ca,150); validate('UK/Ofcom',uk,50); validate('Australia/ACMA',au,150); validate('global EiBi fallback',fallback,30);
  marker(ca,740,'CFZM','ISED'); marker(uk,648,'Radio Caroline','Ofcom'); marker(au,873,'2GB','ACMA');
  const regulatorEntries=stableDedupe([...ca,...uk,...au]), fallbackEntries=stableDedupe(fallback), builtAt=new Date().toISOString();
  const regulatorMeta={version:1,builtAt,recordCount:regulatorEntries.length,sources:{ISED:{authority:'Innovation, Science and Economic Development Canada',tier:1,url:ISED_URL,records:ca.length,format:'dBASEIII AMSTATIO.DBF',sourceDate:'2026-09-02'},Ofcom:{authority:'Ofcom',tier:1,url:OFCOM_URL,records:uk.length,format:'MF CSV (pinned gzip snapshot)',sourceDate:'2026-08-05',snapshot:'data/ofcom/txparamsmf-2026-08-05.csv.gz',snapshotSha256:OFCOM_SNAPSHOT_SHA256},ACMA:{authority:'Australian Communications and Media Authority',tier:1,url:ACMA_URL,records:au.length,format:'XLSX in ZIP',sourceDate:'2026-07-13',attribution:'CC BY 2.5 Australia'}}};
  const fallbackMeta={version:1,builtAt,recordCount:fallbackEntries.length,source:{authority:'EiBi reference schedule',tier:'reference/fallback',url:A26_URL,season:'A26',sourceCommit:A26_COMMIT}};
  const regulatorJs=render(regulatorEntries,regulatorMeta,'FREQBEACON_TERRESTRIAL_CATALOG','FREQBEACON_TERRESTRIAL_META','Generated regulator-grade MW catalog.');
  const fallbackJs=render(fallbackEntries,fallbackMeta,'FREQBEACON_TERRESTRIAL_FALLBACK_CATALOG','FREQBEACON_TERRESTRIAL_FALLBACK_META','Generated EiBi MW/LW fallback catalog.');
  await Promise.all([writeFile(OUT,regulatorJs,'utf8'),writeFile(FALLBACK_OUT,fallbackJs,'utf8')]);
  console.log(`FREQBEACON terrestrial catalogs: CA ${ca.length}, UK ${uk.length}, AU ${au.length}; regulator ${regulatorEntries.length} (${Buffer.byteLength(regulatorJs)} B), fallback ${fallbackEntries.length} (${Buffer.byteLength(fallbackJs)} B).`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){main().catch(e=>{console.error(e);process.exitCode=1;});}
