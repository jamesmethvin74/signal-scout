import { appendFile } from 'node:fs/promises';

const urls = [
  'https://freqbeacon.methvindigitalworks.com/api/explore/status',
  'https://signal-scout.james-methvin74.workers.dev/api/explore/status'
];

let payload = null;
let lastError = null;
for (const url of urls) {
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'FREQBEACON build diagnostic' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    payload = await response.json();
    break;
  } catch (error) {
    lastError = error;
  }
}

if (!payload) {
  console.error('LIVE_RECEIVER_STATUS_ERROR=' + (lastError?.stack || lastError));
  process.exit(43);
}

const b = payload.bootstrap || {};
const n = (v) => Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0;
const tag = [
  `I${n(payload.inventory)}`,
  `S${n(b.screened)}`,
  `R${n(b.reachable)}`,
  `D${n(b.unreachable)}`,
  `P${n(payload.promotionQueue)}`,
  `T${n(payload.trustedReceivers)}`,
  `X${n(payload.testedLast24h)}`
].join('_');

console.log('LIVE_RECEIVER_STATUS=' + JSON.stringify(payload));
await appendFile(new URL('../worker-program-v18.js', import.meta.url), `\nconst LIVE_RECEIVER_${tag} = ;\n`, 'utf8');
console.log('LIVE_RECEIVER_STATUS_TAG=' + tag);
