import { parseCsv, rowsToObjects, pick, num, osGridToWgs84 } from './lib/terrestrial-catalog-lib.mjs';

const url = 'https://www.ofcom.org.uk/siteassets/resources/documents/spectrum/tv-transmitter-guidance/tech-parameters/txparamsmf.csv?v=423471';
const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
if (!r.ok) throw new Error(`Ofcom fetch failed: ${r.status}`);
const text = (await r.text()).replace(/^\uFEFF/, '');
const rows = parseCsv(text);
const objects = rowsToObjects(rows);
let frequencyValid = 0;
let ngrShapeValid = 0;
let ngrConverted = 0;
let powerNumeric = 0;
for (const row of objects) {
  const frequencyKHz = num(pick(row, ['Frequency (kHz)', 'Frequency kHz', 'Frequency']));
  if (!Number.isFinite(frequencyKHz) || frequencyKHz < 500 || frequencyKHz > 1800) continue;
  frequencyValid++;
  const ngr = pick(row, ['OS National Grid Reference', 'OS NGR', 'NGR']);
  const compact = String(ngr || '').trim().toUpperCase().replace(/\s+/g, '');
  if (/^[A-Z]{2}\d{2,10}$/.test(compact) && (compact.length - 2) % 2 === 0) ngrShapeValid++;
  try { osGridToWgs84(ngr); ngrConverted++; } catch {}
  const key = Object.keys(row).find((k) => /in.?use.*emrp/i.test(k));
  if (key && Number.isFinite(num(row[key]))) powerNumeric++;
}
console.log(JSON.stringify({ rows: objects.length, frequencyValid, ngrShapeValid, ngrConverted, powerNumeric }));
// Diagnostic classifier: failure means at least 20 frequency-valid rows also
// convert as OS grid references. Success means the NGR path is dropping them.
process.exitCode = ngrConverted >= 20 ? 1 : 0;
