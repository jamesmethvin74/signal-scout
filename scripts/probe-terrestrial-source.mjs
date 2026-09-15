import { normalizeOfcom } from './generate-global-terrestrial-catalog.mjs';

const official = 'https://www.ofcom.org.uk/siteassets/resources/documents/spectrum/tv-transmitter-guidance/tech-parameters/txparamsmf.csv?v=423471';
const proxy = `https://r.jina.ai/${official}`;
try {
  const r = await fetch(proxy, {
    redirect: 'follow',
    headers: {
      'user-agent': 'FREQBEACON catalog builder/2.0 (+https://freqbeacon.methvindigitalworks.com)',
      'x-respond-with': 'text'
    },
    signal: AbortSignal.timeout(30000)
  });
  if (!r.ok) throw new Error(`Jina transport failed: ${r.status} ${r.statusText}`);
  const text = await r.text();
  const entries = normalizeOfcom(text);
  if (entries.length < 50) throw new Error(`Ofcom parser returned only ${entries.length} records`);
  if (!entries.some((e) => Math.abs(e.frequencyKHz - 648) < 0.1 && /Radio Caroline/i.test(e.name || ''))) {
    throw new Error('Ofcom Radio Caroline 648 marker missing');
  }
  console.log(`Ofcom via Jina transport validated: ${entries.length} records`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
