import { access, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const BRANCH = 'diag/live-receiver-status';
const SNAPSHOT = 'receiver-status-live.json';
const STATUS_URL = 'https://freqbeacon.methvindigitalworks.com/api/explore/status';

if (process.env.WORKERS_CI !== '1' || process.env.WORKERS_CI_BRANCH !== BRANCH) {
  process.exit(0);
}

try {
  await access(SNAPSHOT);
  console.log('Live receiver status snapshot already exists; relay is idle.');
  process.exit(0);
} catch {}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 15000);
let response;
let bodyText = '';
try {
  response = await fetch(STATUS_URL, {
    headers: { accept: 'application/json', 'user-agent': 'FREQBEACON-CLOUDFLARE-STATUS-RELAY/1.0' },
    signal: controller.signal
  });
  bodyText = await response.text();
} finally {
  clearTimeout(timer);
}

let body;
try { body = JSON.parse(bodyText); }
catch { body = bodyText; }

const snapshot = {
  capturedAt: new Date().toISOString(),
  source: STATUS_URL,
  httpStatus: response.status,
  ok: response.ok,
  body
};

await writeFile(SNAPSHOT, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
console.log(`Captured live receiver status: HTTP ${response.status}`);

try {
  execFileSync('git', ['config', 'user.name', 'cloudflare-status-relay'], { stdio: 'inherit' });
  execFileSync('git', ['config', 'user.email', 'cloudflare-status-relay@users.noreply.github.com'], { stdio: 'inherit' });
  execFileSync('git', ['add', SNAPSHOT], { stdio: 'inherit' });
  execFileSync('git', ['commit', '-m', 'Diagnostic: capture live receiver status [skip ci]'], { stdio: 'inherit' });
  execFileSync('git', ['push', 'origin', `HEAD:refs/heads/${BRANCH}`], {
    stdio: 'inherit',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  });
  console.log('Live receiver status snapshot pushed back to diagnostic branch.');
} catch (error) {
  console.warn(`Could not push live receiver status snapshot: ${error?.message || error}`);
}
