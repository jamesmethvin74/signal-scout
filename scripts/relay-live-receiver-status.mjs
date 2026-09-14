import { access, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';

const BRANCH = 'diag/live-receiver-status';
const SNAPSHOT = 'receiver-status-live.json';
const STATUS_URL = 'https://freqbeacon.methvindigitalworks.com/api/explore/status';
const REPO_URL = 'https://github.com/jamesmethvin74/signal-scout.git';

function runGit(args, options = {}) {
  return spawnSync('git', args, {
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    ...options
  });
}

function currentBranchMatches() {
  if (process.env.WORKERS_CI_BRANCH === BRANCH) return true;
  if (process.env.CF_PAGES_BRANCH === BRANCH) return true;
  const branch = runGit(['branch', '--show-current']);
  return String(branch.stdout || '').trim() === BRANCH;
}

if (process.env.WORKERS_CI !== '1' || !currentBranchMatches()) {
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
    headers: {
      accept: 'application/json',
      'user-agent': 'FREQBEACON-CLOUDFLARE-STATUS-RELAY/1.0'
    },
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

execFileSync('git', ['config', 'user.name', 'cloudflare-status-relay'], { stdio: 'inherit' });
execFileSync('git', ['config', 'user.email', 'cloudflare-status-relay@users.noreply.github.com'], { stdio: 'inherit' });
execFileSync('git', ['add', SNAPSHOT], { stdio: 'inherit' });
execFileSync('git', ['commit', '-m', 'Diagnostic: capture live receiver status [skip ci]'], { stdio: 'inherit' });

function pushWithConfiguredRemote() {
  const result = runGit(['push', 'origin', `HEAD:refs/heads/${BRANCH}`]);
  return result.status === 0;
}

function credentialFromHelper() {
  const result = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  });
  if (result.status !== 0) return null;
  const pairs = Object.fromEntries(
    String(result.stdout || '')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf('=');
        return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : ['', ''];
      })
      .filter(([key]) => key)
  );
  return pairs.username && pairs.password ? pairs : null;
}

function pushWithCredential(username, password) {
  const authUrl = `https://${encodeURIComponent(username)}:${encodeURIComponent(password)}@github.com/jamesmethvin74/signal-scout.git`;
  const result = runGit(['push', authUrl, `HEAD:refs/heads/${BRANCH}`]);
  return result.status === 0;
}

let pushed = pushWithConfiguredRemote();

if (!pushed) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GIT_AUTH_TOKEN || '';
  if (token) pushed = pushWithCredential('x-access-token', token);
}

if (!pushed) {
  const credential = credentialFromHelper();
  if (credential) pushed = pushWithCredential(credential.username, credential.password);
}

if (!pushed) {
  throw new Error('Live receiver status was captured but Cloudflare build credentials could not write the snapshot back to the diagnostic branch.');
}

console.log('Live receiver status snapshot pushed back to diagnostic branch.');
