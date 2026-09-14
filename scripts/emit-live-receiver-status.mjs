import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const snapshotPath = new URL('../receiver-status-live.json', import.meta.url);
if (existsSync(snapshotPath)) {
  console.log('LIVE_RECEIVER_STATUS snapshot already committed; skipping relay push');
  process.exit(0);
}

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
await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
console.log('LIVE_RECEIVER_STATUS=' + JSON.stringify(snapshot));

try {
  execFileSync('git', ['config', 'user.name', 'FREQBEACON Cloudflare Diagnostic'], { stdio: 'inherit' });
  execFileSync('git', ['config', 'user.email', 'freqbeacon-diagnostic@users.noreply.github.com'], { stdio: 'inherit' });
  execFileSync('git', ['add', 'receiver-status-live.json'], { stdio: 'inherit' });
  execFileSync('git', ['commit', '-m', 'Relay live receiver health snapshot'], { stdio: 'inherit' });
  execFileSync('git', ['push', 'origin', 'HEAD:refs/heads/temp-receiver-health-snapshot-final'], { stdio: 'inherit' });
  console.log('LIVE_RECEIVER_STATUS_PUSHED=1');
} catch (error) {
  console.error('LIVE_RECEIVER_STATUS_PUSH_ERROR=' + (error?.stack || error));
  process.exit(44);
}
