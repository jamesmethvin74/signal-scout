import baseWorker from './worker-program-v17.js';
import {
  handleExploreApi,
  handleExploreZeroRequest,
  runExploreHealthCycle,
  selectedExploreReceiverId
} from './receiver-health-d1.js';
import {
  handleExploreHealthStatus,
  receiverInventoryReady,
  runExploreBackfillCycle
} from './receiver-health-backfill.js';

const PROGRAM_REFRESH_CRON = '17 */6 * * *';
const RECEIVER_HEALTH_CRON = '43 * * * *';

async function runReceiverHealthCron(env) {
  const inventoryReady = await receiverInventoryReady(env);
  if (!inventoryReady) {
    const seeded = await runExploreHealthCycle(env);
    return {
      mode: 'seed',
      discovered: seeded.discovered,
      tested: seeded.tested
    };
  }

  const backfill = await runExploreBackfillCycle(env, { limit: 10 });
  return {
    mode: 'backfill',
    tested: backfill.tested,
    successful: backfill.successful,
    promoted: backfill.promoted,
    demoted: backfill.demoted,
    trustedReceivers: backfill.trustedReceivers,
    inventory: backfill.inventory,
    untested: backfill.untested,
    promotionQueue: backfill.promotionQueue
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/explore/status') {
      const statusResponse = await handleExploreHealthStatus(request, env);
      if (statusResponse) return statusResponse;
    }

    if (url.pathname.startsWith('/api/explore/')) {
      return handleExploreApi(request, env);
    }

    // This handoff is intentionally dormant until the approved globe UI ships.
    // It only activates when a same-origin Explore selection cookie exists.
    if (url.pathname.startsWith('/api/zero/') && selectedExploreReceiverId(request)) {
      const exploreResponse = await handleExploreZeroRequest(request, env);
      if (exploreResponse) return exploreResponse;
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    const cron = String(event?.cron || '');

    if (cron !== RECEIVER_HEALTH_CRON && typeof baseWorker.scheduled === 'function') {
      await baseWorker.scheduled(event, env, ctx);
    }

    try {
      if (cron === RECEIVER_HEALTH_CRON) {
        const result = await runReceiverHealthCron(env);
        console.log('FREQBEACON receiver health backfill', JSON.stringify(result));
        return;
      }

      if (cron === PROGRAM_REFRESH_CRON || !cron) {
        const result = await runExploreHealthCycle(env);
        console.log('FREQBEACON receiver directory refresh', JSON.stringify({
          discovered: result.discovered,
          tested: result.tested
        }));
      }
    } catch (error) {
      // Receiver health is additive background work. It must never interrupt
      // FREQBEACON's existing scheduled program/schedule refresh duties.
      console.warn('FREQBEACON receiver health cycle failed', error?.message || error);
    }
  }
};
