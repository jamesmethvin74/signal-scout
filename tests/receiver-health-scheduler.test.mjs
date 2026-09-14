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
assert.match(worker, /maintenance-skip/);
assert.match(worker, /cron !== RECEIVER_HEALTH_CRON/);

const backfill = await readFile(new URL('../receiver-health-backfill.js', import.meta.url), 'utf8');
assert.match(backfill, /BACKFILL_BATCH_SIZE = 10/);
assert.match(backfill, /reachable && result\.sndSuccess && result\.wfSuccess/);
assert.match(backfill, /history\.length >= 2/);
assert.match(backfill, /consecutiveFailures >= 2/);
assert.match(backfill, /tag === 'W\/F' && bytes\.length >= 16 \+ 1024/);

console.log('Receiver health scheduler/source checks passed.');
