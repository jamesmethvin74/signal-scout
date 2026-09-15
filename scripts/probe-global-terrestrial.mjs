import { parseCsv, rowsToObjects, pick, num } from './lib/terrestrial-catalog-lib.mjs';

const url = 'https://www.ofcom.org.uk/siteassets/resources/documents/spectrum/tv-transmitter-guidance/tech-parameters/txparamsmf.csv?v=423471';
const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(60000) });
if (!r.ok) throw new Error(`Ofcom fetch failed: ${r.status}`);
const text = (await r.text()).replace(/^\uFEFF/, '');
const rows = parseCsv(text);
const objects = rowsToObjects(rows);
let frequencyValid = 0;
let powerStrictNumeric = 0;
let powerContainsNumericToken = 0;
for (const row of objects) {
  const frequencyKHz = num(pick(row, ['Frequency (kHz)', 'Frequency kHz', 'Frequency']));
  if (!Number.isFinite(frequencyKHz) || frequencyKHz < 500 || frequencyKHz > 1800) continue;
  frequencyValid++;
  const key = Object.keys(row).find((k) => /in.?use.*emrp/i.test(k));
  if (!key) continue;
  if (Number.isFinite(num(row[key]))) powerStrictNumeric++;
  if (/[-+]?\d+(?:\.\d+)?/.test(String(row[key] || ''))) powerContainsNumericToken++;
}
console.log(JSON.stringify({ rows: objects.length, frequencyValid, powerStrictNumeric, powerContainsNumericToken }));
// Diagnostic classifier: failure means >=20 rows contain a usable numeric token
// in EMRP but strict Number parsing rejects most of them.
process.exitCode = powerContainsNumericToken >= 20 && powerStrictNumeric < 20 ? 1 : 0;
