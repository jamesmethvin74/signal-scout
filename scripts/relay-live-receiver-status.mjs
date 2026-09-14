import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const BRANCH = 'diag/live-receiver-status';
const STATUS_URL = 'https://freqbeacon.methvindigitalworks.com/api/explore/status';

function currentBranchMatches() {
  if (process.env.WORKERS_CI_BRANCH === BRANCH) return true;
  if (process.env.CF_PAGES_BRANCH === BRANCH) return true;
  const result = spawnSync('git', ['branch', '--show-current'], { encoding: 'utf8' });
  return String(result.stdout || '').trim() === BRANCH;
}

if (process.env.WORKERS_CI !== '1' || !currentBranchMatches()) process.exit(0);

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 15000);
let response;
let payload;
try {
  response = await fetch(STATUS_URL, {
    headers: {
      accept: 'application/json',
      'user-agent': 'FREQBEACON-CLOUDFLARE-STATUS-RELAY/2.0'
    },
    signal: controller.signal
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`status endpoint HTTP ${response.status}: ${text.slice(0, 300)}`);
  payload = JSON.parse(text);
} finally {
  clearTimeout(timer);
}

const inventory = Number(payload.inventory || 0);
const trusted = Number(payload.trustedReceivers || 0);
const promotion = Number(payload.promotionQueue || 0);
const untested = Number(payload.untested || 0);
const tested24h = Number(payload.testedLast24h || 0);
const lastTestedAt = Number(payload.lastTestedAt || 0);
const ageMinutes = lastTestedAt > 0 ? Math.max(0, Math.round((Date.now() - lastTestedAt) / 60000)) : 9999;

const diagnosticName = `fbdiag-i${inventory}-t${trusted}-p${promotion}-u${untested}-d${tested24h}-a${ageMinutes}`;
if (diagnosticName.length > 63) throw new Error(`diagnostic Worker name is too long: ${diagnosticName}`);

const snapshot = {
  capturedAt: new Date().toISOString(),
  source: STATUS_URL,
  httpStatus: response.status,
  body: payload,
  encodedWorkerName: diagnosticName
};
await writeFile('receiver-status-live.json', `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

const wranglerPath = 'wrangler.jsonc';
const wrangler = await readFile(wranglerPath, 'utf8');
const updated = wrangler.replace(/"name"\s*:\s*"signal-scout"/, `"name": "${diagnosticName}"`);
if (updated === wrangler) throw new Error('Could not replace Worker name in wrangler.jsonc');
await writeFile(wranglerPath, updated, 'utf8');

console.log(`LIVE_RECEIVER_HEALTH ${diagnosticName}`);
