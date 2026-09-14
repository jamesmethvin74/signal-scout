import { spawnSync } from 'node:child_process';

const BRANCH = 'diag/live-receiver-status';
const STATUS_URL = 'https://freqbeacon.methvindigitalworks.com/api/explore/status';
const MAX_TRUSTED = 100;

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
      'user-agent': 'FREQBEACON-CLOUDFLARE-STATUS-TIMING/1.0'
    },
    signal: controller.signal
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`status endpoint HTTP ${response.status}`);
  payload = JSON.parse(text);
} finally {
  clearTimeout(timer);
}

const trusted = Number(payload?.trustedReceivers);
if (!Number.isInteger(trusted) || trusted < 0 || trusted > MAX_TRUSTED) {
  throw new Error('trusted receiver count outside diagnostic range');
}

await new Promise((resolve) => setTimeout(resolve, trusted * 1000));
throw new Error('intentional diagnostic completion after trusted-count delay');
