import { writeFile } from 'node:fs/promises';

const source = process.env.PROBE_SOURCE || 'ISED';
const urls = {
  ISED: 'https://www.ic.gc.ca/engineering/BC_DBF_FILES/baserad.zip',
  OFCOM: 'https://www.ofcom.org.uk/siteassets/resources/documents/spectrum/tv-transmitter-guidance/tech-parameters/txparamsmf.csv',
  ACMA: 'https://www.acma.gov.au/sites/default/files/2026-07/BroadcastTransmitterExcel.zip'
};
const url = urls[source];
if(!url) throw new Error(`Unknown probe source ${source}`);
let detail='';
try{
  const headers = source === 'OFCOM'
    ? {
        'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153.0.0.0 Safari/537.36',
        'accept':'text/csv,text/plain;q=0.9,*/*;q=0.8',
        'referer':'https://www.ofcom.org.uk/tv-radio-and-on-demand/coverage-and-transmitters/radio-tech-parameters'
      }
    : {'user-agent':'FREQBEACON catalog builder/2.0 (+https://freqbeacon.methvindigitalworks.com)'};
  const r = await fetch(url,{redirect:'follow',headers,signal:AbortSignal.timeout(20000)});
  const bytes = Buffer.from(await r.arrayBuffer()).length;
  detail = `${source}\nurl=${url}\nstatus=${r.status} ${r.statusText}\nfinalUrl=${r.url}\nbytes=${bytes}\ncontentType=${r.headers.get('content-type')||''}\nserver=${r.headers.get('server')||''}\n`;
}catch(error){
  detail = `${source}\nurl=${url}\nerrorName=${error?.name||'Error'}\nerrorMessage=${error?.message||error}\ncauseCode=${error?.cause?.code||''}\ncauseMessage=${error?.cause?.message||''}\n`;
}
await writeFile('terrestrial-source-probe.txt',detail,'utf8');
console.log(detail);
