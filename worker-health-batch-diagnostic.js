import baseWorker from './worker-program-v18.js';
import { runExploreBackfillCycle, receiverHealthSummary } from './receiver-health-backfill.js';
import { runReceiverScreenCycle, receiverScreenSummary } from './receiver-health-screen.js';
import { recordReceiverHealthRun } from './receiver-health-runs.js';

const PATH = '/api/explore/run-health-batch-9c31f2a7';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== PATH) return baseWorker.fetch(request, env, ctx);
    const runAt = Date.now();
    try {
      const before = await receiverHealthSummary(env);
      const screening = await runReceiverScreenCycle(env, { limit: 18, concurrency: 6 });
      const backfill = await runExploreBackfillCycle(env, { limit: 10, screenedOnly: true });
      const after = await receiverHealthSummary(env);
      const screenSummary = await receiverScreenSummary(env);
      const result = {
        mode: 'manual-bootstrap-diagnostic',
        runAt,
        durationMs: Date.now() - runAt,
        screened: screening.screenedNow,
        screenReachable: screening.reachableNow,
        screenUnreachable: screening.unreachableNow,
        tested: backfill.tested,
        successful: backfill.successful,
        promoted: backfill.promoted,
        demoted: backfill.demoted,
        trustedReceivers: after.trustedReceivers,
        inventory: after.inventory,
        untested: after.untested,
        promotionQueue: after.promotionQueue
      };
      await recordReceiverHealthRun(env, result);
      return new Response(JSON.stringify({ ok: true, before, screening, backfill, after, screenSummary, result }, null, 2), {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
      });
    } catch (error) {
      return new Response(JSON.stringify({ ok: false, durationMs: Date.now() - runAt, error: String(error?.message || error), stack: String(error?.stack || '') }, null, 2), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
      });
    }
  },
  scheduled: baseWorker.scheduled
};
