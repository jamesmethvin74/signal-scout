const source = process.env.PROBE_SOURCE || 'ISED';
const urls = {
  ISED: 'https://www.ic.gc.ca/engineering/BC_DBF_FILES/baserad.zip',
  OFCOM: 'https://www.ofcom.org.uk/siteassets/resources/documents/spectrum/tv-transmitter-guidance/tech-parameters/txparamsmf.csv?v=423471',
  ACMA: 'https://www.acma.gov.au/sites/default/files/2026-07/BroadcastTransmitterExcel.zip'
};
const url = urls[source];
if(!url) throw new Error(`Unknown probe source ${source}`);
try{
  const r = await fetch(url,{redirect:'follow',headers:{'user-agent':'FREQBEACON catalog builder/2.0 (+https://freqbeacon.methvindigitalworks.com)'},signal:AbortSignal.timeout(20000)});
  if(!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  const bytes = Buffer.from(await r.arrayBuffer()).length;
  console.log(`${source} fetch ok: ${bytes} bytes`);
}catch(error){
  console.error(`${source} fetch failed: ${error?.name||'Error'}: ${error?.message||error}`);
  process.exitCode=1;
}
