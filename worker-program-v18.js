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

function injectExploreNav(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;
  return response.text().then((source) => {
    let html = source;
    if (!html.includes('href="/explore"')) {
      html = html.replace(
        '<a class="zero-app-action" href="/lookup.html">LOOKUP</a>',
        '<a class="zero-app-action" href="/explore">EXPLORE</a>\n        <a class="zero-app-action" href="/lookup.html">LOOKUP</a>'
      );
    }
    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-primary-nav', 'radio-explore-lookup-v1');
    return new Response(html, { status: response.status, statusText: response.statusText, headers });
  });
}

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

    if (url.pathname.startsWith('/api/zero/') && selectedExploreReceiverId(request)) {
      const exploreResponse = await handleExploreZeroRequest(request, env);
      if (exploreResponse) return exploreResponse;
    }

    if (request.method === 'GET' && (url.pathname === '/explore' || url.pathname === '/explore/')) {
      const exploreUrl = new URL('/explore.html', request.url);
      return env.ASSETS.fetch(new Request(exploreUrl.toString(), { method: 'GET', headers: request.headers }));
    }

    const response = await baseWorker.fetch(request, env, ctx);
    if (request.method === 'GET' && (url.pathname === '/zero' || url.pathname === '/zero/')) {
      return injectExploreNav(response);
    }
    return response;
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
      // Explore health is additive background work. It must never interrupt
      // FREQBEACON's existing scheduled program/schedule refresh duties.
      console.warn('FREQBEACON explore health cycle failed', error?.message || error);
    }
  }
};
