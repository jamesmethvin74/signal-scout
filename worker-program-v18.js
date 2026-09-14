import baseWorker from './worker-program-v17.js';
import {
  handleExploreApi,
  handleExploreZeroRequest,
  runExploreHealthCycle,
  selectedExploreReceiverId
} from './receiver-health-d1.js';
import {
  handleExploreHealthStatus,
  receiverHealthSummary,
  receiverInventoryReady,
  runExploreBackfillCycle
} from './receiver-health-backfill.js';
import {
  recentReceiverHealthRuns,
  recordReceiverHealthRun
} from './receiver-health-runs.js';

const PROGRAM_REFRESH_CRON = '17 */6 * * *';
const RECEIVER_HEALTH_CRON = '*/15 * * * *';
const WARMUP_TRUSTED_TARGET = 100;
const MAINTENANCE_MINUTE_UTC = 45;

function scheduledMinuteUtc(event) {
  const time = Number(event?.scheduledTime);
  return new Date(Number.isFinite(time) ? time : Date.now()).getUTCMinutes();
}

async function runReceiverHealthCron(event, env) {
  const inventoryReady = await receiverInventoryReady(env);
  if (!inventoryReady) {
    const seeded = await runExploreHealthCycle(env);
    const summary = await receiverHealthSummary(env);
    return {
      mode: 'seed',
      discovered: seeded.discovered,
      tested: seeded.tested,
      trustedReceivers: summary.trustedReceivers,
      inventory: summary.inventory,
      untested: summary.untested,
      promotionQueue: summary.promotionQueue
    };
  }

  const before = await receiverHealthSummary(env);
  const warming = before.trustedReceivers < WARMUP_TRUSTED_TARGET;
  if (!warming && scheduledMinuteUtc(event) !== MAINTENANCE_MINUTE_UTC) {
    return {
      mode: 'maintenance-skip',
      trustedReceivers: before.trustedReceivers,
      inventory: before.inventory,
      untested: before.untested,
      promotionQueue: before.promotionQueue
    };
  }

  const backfill = await runExploreBackfillCycle(env, { limit: 10 });
  return {
    mode: warming ? 'warmup' : 'maintenance',
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

async function persistHealthRun(env, run) {
  try {
    await recordReceiverHealthRun(env, run);
  } catch (error) {
    console.warn('FREQBEACON receiver health run persistence failed', error?.message || error);
  }
}

async function healthStatusResponse(request, env) {
  const response = await handleExploreHealthStatus(request, env);
  if (!response) return null;
  try {
    const payload = await response.clone().json();
    let recentRuns = [];
    try {
      recentRuns = await recentReceiverHealthRuns(env, 12);
    } catch (error) {
      console.warn('FREQBEACON receiver health history read failed', error?.message || error);
    }
    payload.recentRuns = recentRuns;
    payload.lastRun = recentRuns[0] || null;
    payload.cadence = {
      directoryRefresh: 'every 6 hours',
      warmup: `every 15 minutes until ${WARMUP_TRUSTED_TARGET} trusted receivers`,
      maintenance: `hourly at minute ${MAINTENANCE_MINUTE_UTC} UTC after warmup`,
      batchSize: 10
    };
    const headers = new Headers(response.headers);
    return new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  } catch {
    return response;
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/explore/status') {
      const statusResponse = await healthStatusResponse(request, env);
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

    if (cron === RECEIVER_HEALTH_CRON) {
      const runAt = Date.now();
      try {
        const result = await runReceiverHealthCron(event, env);
        await persistHealthRun(env, {
          ...result,
          runAt,
          durationMs: Date.now() - runAt
        });
        console.log('FREQBEACON receiver health backfill', JSON.stringify(result));
      } catch (error) {
        let summary = {};
        try {
          summary = await receiverHealthSummary(env);
        } catch {}
        await persistHealthRun(env, {
          mode: 'error',
          runAt,
          durationMs: Date.now() - runAt,
          error: error?.message || error,
          trustedReceivers: summary.trustedReceivers,
          inventory: summary.inventory,
          untested: summary.untested,
          promotionQueue: summary.promotionQueue
        });
        console.warn('FREQBEACON receiver health cycle failed', error?.message || error);
      }
      return;
    }

    try {
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
