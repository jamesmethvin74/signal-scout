import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wranglerText = await readFile(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
const wrangler = JSON.parse(wranglerText.replace(/^\s*\/\/.*$/gm, ''));
assert.deepEqual(wrangler.triggers.crons, ['17 */6 * * *', '*/15 * * * *']);
assert.equal(wrangler.preview_urls, true);

const worker = await readFile(new URL('../worker-program-v18.js', import.meta.url), 'utf8');
assert.match(worker, /RECEIVER_HEALTH_CRON = '\*\/15 \* \* \* \*'/);
assert.match(worker, /WARMUP_TRUSTED_TARGET = 100/);
assert.match(worker, /MAINTENANCE_MINUTE_UTC = 45/);
assert.match(worker, /runExploreBackfillCycle/);
assert.match(worker, /receiverInventoryReady/);
assert.match(worker, /receiverHealthSummary/);
assert.match(worker, /recordReceiverHealthRun/);
assert.match(worker, /recentReceiverHealthRuns/);
assert.match(worker, /payload\.recentRuns = recentRuns/);
assert.match(worker, /payload\.lastRun = recentRuns\[0\] \|\| null/);
assert.match(worker, /mode: 'error'/);
assert.match(worker, /maintenance-skip/);
assert.match(worker, /cron !== RECEIVER_HEALTH_CRON/);

const backfill = await readFile(new URL('../receiver-health-backfill.js', import.meta.url), 'utf8');
assert.match(backfill, /BACKFILL_BATCH_SIZE = 10/);
assert.match(backfill, /reachable && result\.sndSuccess && result\.wfSuccess/);
assert.match(backfill, /history\.length >= 2/);
assert.match(backfill, /consecutiveFailures >= 2/);
assert.match(backfill, /tag === 'W\/F' && bytes\.length >= 16 \+ 1024/);

const runs = await readFile(new URL('../receiver-health-runs.js', import.meta.url), 'utf8');
assert.match(runs, /CREATE TABLE IF NOT EXISTS receiver_health_runs/);
assert.match(runs, /RUN_RETENTION_MS = 14 \* 86400000/);
assert.match(runs, /INSERT INTO receiver_health_runs/);
assert.match(runs, /DELETE FROM receiver_health_runs WHERE run_at < \?/);
assert.match(runs, /ORDER BY run_at DESC, id DESC/);
assert.match(runs, /LIMIT \$\{safeLimit\}/);

console.log('Receiver health scheduler/source checks passed.');
