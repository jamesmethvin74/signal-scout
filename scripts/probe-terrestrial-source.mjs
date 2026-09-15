const snapshotUrl = 'https://33e27151-signal-scout.james-methvin74.workers.dev/freqbeacon-zero-global-mw-lw.js';
try {
  const response = await fetch(snapshotUrl, {signal: AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`FREQBEACON snapshot failed: ${response.status} ${response.statusText}`);
  const js = await response.text();
  const match = js.match(/const entries = (\[[\s\S]*?\]);\s*window\.FREQBEACON_TERRESTRIAL_CATALOG/);
  if (!match) throw new Error('FREQBEACON snapshot does not contain terrestrial entries');
  const entries = JSON.parse(match[1]);
  const uk = entries.filter((e) => e?.sourceAuthority === 'Ofcom' && e?.country === 'United Kingdom');
  if (uk.length < 50) throw new Error(`FREQBEACON snapshot has only ${uk.length} Ofcom rows`);
  if (!uk.some((e) => Math.abs(Number(e.frequencyKHz) - 648) < 0.1 && /Radio Caroline/i.test(String(e.name || '')))) {
    throw new Error('FREQBEACON snapshot Radio Caroline 648 marker missing');
  }
  console.log(`FREQBEACON Ofcom snapshot validated: ${uk.length} rows`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
