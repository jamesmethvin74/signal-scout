import { writeFile } from 'node:fs/promises';
import { normalizeBrazilMCom } from './generate-global-terrestrial-catalog.mjs';

const URL='https://s3.mcom.gov.br/radcom/SCR_DADOS_RADIODIFUSAO_TV_GTVD_RTV_RTVD_FM_OM.csv';
const norm=(s)=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'').toLowerCase();
function parseSemicolon(text){
  const rows=[]; let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i+=1){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i+=1;}else quoted=!quoted;}else if(c===';'&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i+=1;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';}else cell+=c;}
  if(cell||row.length){row.push(cell);if(row.some(Boolean))rows.push(row);}return rows;
}
function matchingHeaders(headers,needles){return headers.filter(h=>needles.some(n=>norm(h).includes(norm(n))));}
function objectRows(rows){const h=rows[0]||[];return rows.slice(1).map(r=>Object.fromEntries(h.map((k,i)=>[k,r[i]??''])));}
function pickLoose(row,needles){for(const [k,v] of Object.entries(row)){if(needles.some(n=>norm(k).endsWith(norm(n)))&&String(v??'').trim()!=='')return String(v).trim();}return '';}

const probe={url:URL,builtAt:new Date().toISOString(),ok:false};
try{
  const response=await fetch(URL,{redirect:'follow',signal:AbortSignal.timeout(30000)});
  probe.http={status:response.status,statusText:response.statusText,contentType:response.headers.get('content-type'),contentLength:response.headers.get('content-length')};
  if(!response.ok)throw new Error(`HTTP ${response.status} ${response.statusText}`);
  const buf=Buffer.from(await response.arrayBuffer()); probe.bytes=buf.length;
  const text=new TextDecoder('iso-8859-1').decode(buf).replace(/^\uFEFF/,'');
  const rows=parseSemicolon(text), headers=(rows[0]||[]).map(v=>String(v).trim()), objects=objectRows(rows);
  probe.rows=objects.length; probe.headers=headers;
  probe.headerMatches={
    service:matchingHeaders(headers,['siglaservico']), status:matchingHeaders(headers,['indstatusestacao','sitarwebstatus','siglasituacao']),
    frequency:matchingHeaders(headers,['freqop','frequency','frequencia']), latitude:matchingHeaders(headers,['latitude','coordinates1']),
    longitude:matchingHeaders(headers,['longitude','coordinates0']), power:matchingHeaders(headers,['potencia','erpmax']),
    identity:matchingHeaders(headers,['indicativo','nomeentidade','respnomeentidade'])
  };
  const om=objects.filter(r=>pickLoose(r,['siglaservico']).toUpperCase()==='OM'); probe.omRows=om.length;
  try{const normalized=normalizeBrazilMCom(text,probe.builtAt.slice(0,10));probe.normalizedCount=normalized.length;probe.marker980=normalized.filter(e=>Math.abs(e.frequencyKHz-980)<0.1).slice(0,10);probe.ok=true;}catch(error){probe.normalizeError=String(error?.stack||error);}
}catch(error){probe.fetchError=String(error?.stack||error);}
await writeFile('brazil-probe.json',JSON.stringify(probe,null,2)+'\n','utf8');
await writeFile('freqbeacon-zero-global-mw-lw.js',`(() => { 'use strict'; window.FREQBEACON_TERRESTRIAL_CATALOG=Object.freeze([]); window.FREQBEACON_TERRESTRIAL_META=Object.freeze({diagnostic:true}); })();\n`,'utf8');
await writeFile('freqbeacon-zero-global-mw-lw-fallback.js',`(() => { 'use strict'; window.FREQBEACON_TERRESTRIAL_FALLBACK_CATALOG=Object.freeze([]); window.FREQBEACON_TERRESTRIAL_FALLBACK_META=Object.freeze({diagnostic:true}); })();\n`,'utf8');
console.log(`Brazil SCR header probe: ${JSON.stringify({http:probe.http,rows:probe.rows,omRows:probe.omRows,headers:probe.headerMatches,normalizeError:probe.normalizeError})}`);
// This diagnostic build succeeds only when the official combined SCR file actually contains a technical power field.
// The result lets us distinguish a missing-power source contract from a generic parser bug without weakening production validation.
if(probe.fetchError||!probe.headerMatches?.power?.length) process.exitCode=1;
