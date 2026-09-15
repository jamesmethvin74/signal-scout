import { normalizeOfcom } from './generate-global-terrestrial-catalog.mjs';

const official = 'https://www.ofcom.org.uk/siteassets/resources/documents/spectrum/tv-transmitter-guidance/tech-parameters/txparamsmf.csv?v=423471';
const candidates = [
  ['corsproxy.io', `https://corsproxy.io/?url=${encodeURIComponent(official)}`],
  ['CodeTabs', `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(official)}`]
];
let lastError;
for (const [name,url] of candidates) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {'user-agent':'FREQBEACON catalog builder/2.0 (+https://freqbeacon.methvindigitalworks.com)'},
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) throw new Error(`${name} transport failed: ${response.status} ${response.statusText}`);
    const csv = (await response.text()).replace(/^\uFEFF/, '');
    const entries = normalizeOfcom(csv);
    if (entries.length < 50) throw new Error(`${name} Ofcom parser returned only ${entries.length} records`);
    if (!entries.some((e) => Math.abs(e.frequencyKHz - 648) < 0.1 && /Radio Caroline/i.test(e.name || ''))) {
      throw new Error(`${name} Radio Caroline 648 marker missing`);
    }
    console.log(`Ofcom via ${name} validated: ${entries.length} records`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.error(error);
  }
}
throw lastError || new Error('No Ofcom transport fallback succeeded');
