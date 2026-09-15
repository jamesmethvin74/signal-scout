import { writeFile } from 'node:fs/promises';

const target = 'https://www.ofcom.org.uk/siteassets/resources/documents/spectrum/tv-transmitter-guidance/tech-parameters/txparamsmf.csv?v=423471';
const cdx = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(target)}&output=json&fl=timestamp,original,statuscode,mimetype,digest,length&filter=statuscode:200&from=2026&to=2026&collapse=digest`;
let detail='';
try {
  const r = await fetch(cdx,{headers:{'user-agent':'FREQBEACON catalog builder/2.0'},signal:AbortSignal.timeout(30000)});
  const text = await r.text();
  detail = `status=${r.status} ${r.statusText}\nurl=${r.url}\n${text.slice(0,20000)}\n`;
} catch (error) {
  detail = `errorName=${error?.name||'Error'}\nerrorMessage=${error?.message||error}\ncauseCode=${error?.cause?.code||''}\n`;
}
await writeFile('terrestrial-source-probe.txt',detail,'utf8');
console.log(detail);
