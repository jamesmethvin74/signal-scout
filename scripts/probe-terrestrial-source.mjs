const url = 'https://www.ofcom.org.uk/siteassets/resources/documents/spectrum/tv-transmitter-guidance/tech-parameters/txparams.xlsx?v=423473';
try {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {'user-agent':'FREQBEACON catalog builder/2.0 (+https://freqbeacon.methvindigitalworks.com)'},
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`Ofcom XLSX failed: ${response.status} ${response.statusText}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1000000) throw new Error(`Ofcom XLSX suspiciously small: ${bytes.length} bytes`);
  console.log(`Ofcom XLSX reachable: ${bytes.length} bytes; final URL ${response.url}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
