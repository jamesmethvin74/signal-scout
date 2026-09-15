import { normalizeOfcom } from './generate-global-terrestrial-catalog.mjs';

const url = 'https://www.ofcom.org.uk/__data/assets/file/0019/91306/TxParamsMF.csv';
try {
  const r = await fetch(url, {redirect:'follow',signal:AbortSignal.timeout(30000)});
  if (!r.ok) throw new Error(`legacy Ofcom MF route failed: ${r.status} ${r.statusText}`);
  const text = await r.text();
  const entries = normalizeOfcom(text);
  if (entries.length < 50) throw new Error(`Ofcom parser returned only ${entries.length} records`);
  if (!entries.some((e) => Math.abs(e.frequencyKHz - 648) < 0.1 && /Radio Caroline/i.test(e.name || ''))) {
    throw new Error('Ofcom Radio Caroline 648 marker missing');
  }
  console.log(`Legacy Ofcom route validated: ${entries.length} records; final URL ${r.url}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
