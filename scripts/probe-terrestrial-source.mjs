import { normalizeOfcom } from './generate-global-terrestrial-catalog.mjs';

const official = 'https://www.ofcom.org.uk/siteassets/resources/documents/spectrum/tv-transmitter-guidance/tech-parameters/txparamsmf.csv?v=423471';
const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(official)}`;
try {
  const response = await fetch(proxy, {
    redirect: 'follow',
    headers: {'user-agent':'FREQBEACON catalog builder/2.0 (+https://freqbeacon.methvindigitalworks.com)'},
    signal: AbortSignal.timeout(30000)
  });
  if (!response.ok) throw new Error(`AllOrigins transport failed: ${response.status} ${response.statusText}`);
  const csv = (await response.text()).replace(/^\uFEFF/, '');
  const entries = normalizeOfcom(csv);
  if (entries.length < 50) throw new Error(`Ofcom proxy parser returned only ${entries.length} records`);
  if (!entries.some((e) => Math.abs(e.frequencyKHz - 648) < 0.1 && /Radio Caroline/i.test(e.name || ''))) {
    throw new Error('Ofcom proxy Radio Caroline 648 marker missing');
  }
  console.log(`Ofcom via AllOrigins validated: ${entries.length} records`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
