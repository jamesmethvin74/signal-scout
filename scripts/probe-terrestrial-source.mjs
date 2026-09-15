const official = 'https://www.ofcom.org.uk/siteassets/resources/documents/spectrum/tv-transmitter-guidance/tech-parameters/txparamsmf.csv?v=423471';
const proxy = `https://r.jina.ai/${official}`;
try {
  const r = await fetch(proxy, {
    redirect: 'follow',
    headers: {'user-agent': 'FREQBEACON catalog builder/2.0 (+https://freqbeacon.methvindigitalworks.com)'},
    signal: AbortSignal.timeout(30000)
  });
  if (!r.ok) throw new Error(`Jina transport failed: ${r.status} ${r.statusText}`);
  const text = await r.text();
  if (text.length < 1000) throw new Error(`Jina response too small: ${text.length}`);
  console.log(`Jina Ofcom transport reachable: ${text.length} chars`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
