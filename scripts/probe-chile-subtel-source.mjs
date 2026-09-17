import { writeFile } from 'node:fs/promises';
import { parseXlsxSheets, unzipEntries } from './lib/terrestrial-catalog-lib.mjs';

const XLSX_URL='https://www.subtel.gob.cl/wp-content/uploads/2026/09/Actualiza_agosto_2026_web.xlsx';
const KMZ_URL='https://www.subtel.gob.cl/wp-content/uploads/2016/12/CoberturaAM_LayerToKML.kmz';

async function fetchBuffer(url,label){
  const response=await fetch(url,{redirect:'follow',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`${label}: HTTP ${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

const probe={builtAt:new Date().toISOString(),xlsxUrl:XLSX_URL,kmzUrl:KMZ_URL,ok:false};
try{
  const xlsx=await fetchBuffer(XLSX_URL,'SUBTEL concessions XLSX');
  probe.xlsxBytes=xlsx.length;
  const sheets=parseXlsxSheets(xlsx);
  probe.sheets=sheets.map(sheet=>({name:sheet.name,rowCount:sheet.rows.length,sample:sheet.rows.slice(0,15).map(row=>row.slice(0,35))}));

  const kmz=await fetchBuffer(KMZ_URL,'SUBTEL AM coverage KMZ');
  probe.kmzBytes=kmz.length;
  const entries=unzipEntries(kmz);
  probe.kmzEntries=[...entries.keys()];
  probe.kml=[];
  for(const [name,data] of entries){
    if(/\.kml$/i.test(name)) probe.kml.push({name,head:data.toString('utf8').slice(0,30000)});
  }
  probe.ok=true;
}catch(error){
  probe.error=String(error?.stack||error);
}

await writeFile('chile-probe.json',JSON.stringify(probe,null,2)+'\n','utf8');
await writeFile('freqbeacon-zero-global-mw-lw.js',`(() => { 'use strict'; window.FREQBEACON_TERRESTRIAL_CATALOG=Object.freeze([]); window.FREQBEACON_TERRESTRIAL_META=Object.freeze({diagnostic:true}); })();\n`,'utf8');
await writeFile('freqbeacon-zero-global-mw-lw-fallback.js',`(() => { 'use strict'; window.FREQBEACON_TERRESTRIAL_FALLBACK_CATALOG=Object.freeze([]); window.FREQBEACON_TERRESTRIAL_FALLBACK_META=Object.freeze({diagnostic:true}); })();\n`,'utf8');
console.log(`Chile SUBTEL diagnostic: ${JSON.stringify({ok:probe.ok,xlsxBytes:probe.xlsxBytes,kmzBytes:probe.kmzBytes,sheets:probe.sheets?.map(s=>[s.name,s.rowCount]),kmzEntries:probe.kmzEntries,error:probe.error})}`);
if(!probe.ok)process.exitCode=1;
