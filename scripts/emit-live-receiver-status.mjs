import { readFile, writeFile } from 'node:fs/promises';

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

let name = 'fb-status-fetch-failed';
if (payload) {
  const b = payload.bootstrap || {};
  const n = (v) => Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0;
  name = [
    'fb',
    `i${n(payload.inventory)}`,
    `s${n(b.screened)}`,
    `r${n(b.reachable)}`,
    `d${n(b.unreachable)}`,
    `q${n(payload.promotionQueue)}`,
    `t${n(payload.trustedReceivers)}`,
    `x${n(payload.testedLast24h)}`
  ].join('-');
  console.log('LIVE_RECEIVER_STATUS_SOURCE=' + source);
  console.log('LIVE_RECEIVER_STATUS=' + JSON.stringify(payload));
} else {
  console.error('LIVE_RECEIVER_STATUS_ERROR=' + (lastError?.stack || lastError));
}

const path = new URL('../wrangler.jsonc', import.meta.url);
let text = await readFile(path, 'utf8');
text = text.replace(/"name"\s*:\s*"[^"]+"/, `"name": "${name}"`);
await writeFile(path, text);
console.log('LIVE_RECEIVER_STATUS_SCRIPT=' + name);
