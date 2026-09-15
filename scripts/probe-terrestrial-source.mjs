const paths = [
  'https://ofcom.org.uk/siteassets/resources/documents/spectrum/tv-transmitter-guidance/tech-parameters/txparamsmf.csv?v=423471',
  'http://www.ofcom.org.uk/siteassets/resources/documents/spectrum/tv-transmitter-guidance/tech-parameters/txparamsmf.csv?v=423471',
  'http://ofcom.org.uk/siteassets/resources/documents/spectrum/tv-transmitter-guidance/tech-parameters/txparamsmf.csv?v=423471'
];
let lastError;
for (const url of paths) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {'user-agent':'FREQBEACON catalog builder/2.0 (+https://freqbeacon.methvindigitalworks.com)'},
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const text = await response.text();
    if (text.length < 10000 || !/Radio Caroline/i.test(text)) throw new Error(`suspicious response: ${text.length} chars`);
    console.log(`Ofcom alternate official route reachable: ${url} -> ${response.url}; ${text.length} chars`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.error(`route failed ${url}: ${error?.message || error}`);
  }
}
throw lastError || new Error('No Ofcom route succeeded');
