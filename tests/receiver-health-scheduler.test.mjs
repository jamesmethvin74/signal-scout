import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wranglerText = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const wrangler = JSON.parse(wranglerText.replace(/^\s*\/\/.*$/gm, ''));
assert.deepEqual(wrangler.triggers.crons, ['17 */6 * * *', '* * * * *']);
assert.equal(wrangler.preview_urls, true);

const worker = await readFile(new URL('../worker-program-v18.js', import.meta.url), 'utf8');
assert.match(worker, /RECEIVER_HEALTH_CRON = '\* \* \* \* \*'/);
assert.match(worker, /BOOTSTRAP_TRUSTED_TARGET = 125/);
assert.match(worker, /SCREEN_BATCH_SIZE = 18/);
assert.match(worker, /FULL_PROOF_BATCH_SIZE = 10/);
assert.match(worker, /MAINTENANCE_MINUTE_UTC = 45/);
assert.match(worker, /acquireReceiverBootstrapLease/);
assert.match(worker, /releaseReceiverBootstrapLease/);
assert.match(worker, /mode: 'overlap-skip'/);
assert.match(worker, /runReceiverScreenCycle/);
assert.match(worker, /receiverScreenSummary/);
assert.match(worker, /screenedOnly: true/);
assert.match(worker, /recordReceiverHealthRun/);
assert.match(worker, /recentReceiverHealthRuns/);
assert.match(worker, /payload\.bootstrap = bootstrap/);
assert.match(worker, /payload\.recentRuns = recentRuns/);
assert.match(worker, /payload\.lastRun = recentRuns\[0\] \|\| null/);
assert.match(worker, /mode: 'error'/);
assert.match(worker, /maintenance-skip/);
assert.match(worker, /cron !== RECEIVER_HEALTH_CRON/);

const backfill = await readFile(new URL('../receiver-health-backfill.js', import.meta.url), 'utf8');
assert.match(backfill, /BACKFILL_BATCH_SIZE = 10/);
assert.match(backfill, /screenedOnly/);
assert.match(backfill, /receiver_screening/);
assert.match(backfill, /reachable && result\.sndSuccess && result\.wfSuccess/);
assert.match(backfill, /history\.length >= 2/);
assert.match(backfill, /consecutiveFailures >= 2/);
assert.match(backfill, /tag === 'W\/F' && bytes\.length >= 16 \+ 1024/);

const screen = await readFile(new URL('../receiver-health-screen.js', import.meta.url), 'utf8');
assert.match(screen, /SCREEN_BATCH_SIZE = 18/);
assert.match(screen, /SCREEN_CONCURRENCY = 6/);
assert.match(screen, /SCREEN_TIMEOUT_MS = 2500/);
assert.match(screen, /LEASE_MS = 3 \* 60 \* 1000/);
assert.match(screen, /CREATE TABLE IF NOT EXISTS receiver_screening/);
assert.match(screen, /CREATE TABLE IF NOT EXISTS receiver_bootstrap_lease/);
assert.match(screen, /\/VER/);
assert.match(screen, /observations=0/);

const runs = await readFile(new URL('../receiver-health-runs.js', import.meta.url), 'utf8');
assert.match(runs, /CREATE TABLE IF NOT EXISTS receiver_health_runs/);
assert.match(runs, /RUN_RETENTION_MS = 14 \* 86400000/);
assert.match(runs, /INSERT INTO receiver_health_runs/);
assert.match(runs, /DELETE FROM receiver_health_runs WHERE run_at < \?/);
assert.match(runs, /ORDER BY run_at DESC, id DESC/);
assert.match(runs, /LIMIT \$\{safeLimit\}/);

console.log('Receiver health scheduler/source checks passed.');
