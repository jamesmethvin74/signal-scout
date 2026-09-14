import baseWorker from './worker-program-v18.js';
import { runExploreBackfillCycle, receiverHealthSummary } from './receiver-health-backfill.js';
import { runReceiverScreenCycle, receiverScreenSummary } from './receiver-health-screen.js';

const PATH = '/api/explore/diagnostic-bootstrap-sync-4d1f9a72';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== PATH) return baseWorker.fetch(request, env, ctx);

    const startedAt = Date.now();
    try {
      const before = await receiverHealthSummary(env);
      const screening = await runReceiverScreenCycle(env, { limit: 18, concurrency: 6 });
      const backfill = await runExploreBackfillCycle(env, { limit: 10, screenedOnly: true });
      const after = await receiverHealthSummary(env);
      const screenSummary = await receiverScreenSummary(env);
      return new Response(JSON.stringify({
        ok: true,
        durationMs: Date.now() - startedAt,
        before,
        screening,
        backfill,
        after,
        screenSummary
      }, null, 2), {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
      });
    } catch (error) {
      return new Response(JSON.stringify({
        ok: false,
        durationMs: Date.now() - startedAt,
        error: String(error?.message || error),
        stack: String(error?.stack || '')
      }, null, 2), {
        status: 500,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
      });
    }
  },
  scheduled: baseWorker.scheduled
};
