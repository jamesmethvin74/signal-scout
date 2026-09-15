import { normalizeOfcom } from './generate-global-terrestrial-catalog.mjs';

const target = 'https://www.ofcom.org.uk/siteassets/resources/documents/spectrum/tv-transmitter-guidance/tech-parameters/txparamsmf.csv?v=423471';
const cdx = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(target)}&output=json&fl=timestamp,original,statuscode,mimetype,digest,length&filter=statuscode:200&from=2026&to=2026&filter=timestamp:^20260[89]&collapse=digest`;
try {
  const indexResponse = await fetch(cdx, {
    headers: {'user-agent':'FREQBEACON catalog builder/2.0'},
    signal: AbortSignal.timeout(30000)
  });
  if (!indexResponse.ok) throw new Error(`Wayback CDX failed: ${indexResponse.status} ${indexResponse.statusText}`);
  const rows = await indexResponse.json();
  if (!Array.isArray(rows) || rows.length < 2) throw new Error('No Aug/Sep 2026 Ofcom MF capture found');
  const captures = rows.slice(1).filter((row) => /^20260[89]/.test(String(row?.[0] || '')));
  if (!captures.length) throw new Error('No qualifying Aug/Sep 2026 Ofcom MF capture found');
  captures.sort((a,b) => String(a[0]).localeCompare(String(b[0])));
  const latest = captures.at(-1);
  const timestamp = String(latest[0]);
  const original = String(latest[1] || target);
  const archiveUrl = `https://web.archive.org/web/${timestamp}id_/${original}`;
  const archivedResponse = await fetch(archiveUrl, {
    headers: {'user-agent':'FREQBEACON catalog builder/2.0'},
    signal: AbortSignal.timeout(30000)
  });
  if (!archivedResponse.ok) throw new Error(`Wayback Ofcom capture failed: ${archivedResponse.status} ${archivedResponse.statusText}`);
  const csv = (await archivedResponse.text()).replace(/^\uFEFF/, '');
  const entries = normalizeOfcom(csv);
  if (entries.length < 50) throw new Error(`Archived Ofcom parser returned only ${entries.length} records`);
  if (!entries.some((e) => Math.abs(e.frequencyKHz - 648) < 0.1 && /Radio Caroline/i.test(e.name || ''))) {
    throw new Error('Archived Ofcom Radio Caroline 648 marker missing');
  }
  console.log(`Archived Ofcom capture validated: ${timestamp}, ${entries.length} records`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
