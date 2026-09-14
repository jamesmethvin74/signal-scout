import { writeFile } from 'node:fs/promises';

const urls = [
  'https://freqbeacon.methvindigitalworks.com/api/explore/status',
  'https://signal-scout.james-methvin74.workers.dev/api/explore/status'
];

let payload = null;
let source = null;
let lastError = null;
for (const url of urls) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'FREQBEACON build diagnostic' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    payload = await response.json();
    source = url;
    break;
  } catch (error) {
    lastError = error;
  }
}

if (!payload) {
  console.error('LIVE_RECEIVER_STATUS_ERROR=' + (lastError?.stack || lastError));
  process.exit(43);
}

const snapshot = {
  capturedAt: new Date().toISOString(),
  source,
  ...payload
};
await writeFile(new URL('../receiver-status-live.json', import.meta.url), JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
console.log('LIVE_RECEIVER_STATUS_CAPTURED=' + JSON.stringify(snapshot));
