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
  acquireReceiverBootstrapLease,
  receiverScreenSummary,
  releaseReceiverBootstrapLease,
  runReceiverScreenCycle
} from './receiver-health-screen.js';
import {
  recentReceiverHealthRuns,
  recordReceiverHealthRun
} from './receiver-health-runs.js';

const PROGRAM_REFRESH_CRON = '17 */6 * * *';
const RECEIVER_HEALTH_CRON = '* * * * *';
const BOOTSTRAP_TRUSTED_TARGET = 125;
const SCREEN_BATCH_SIZE = 18;
const FULL_PROOF_BATCH_SIZE = 10;
const MAINTENANCE_MINUTE_UTC = 45;
const TRUST_STALE_MS = 7 * 86400000;
const DISCOVERY_STALE_MS = 14 * 86400000;
const EXPLORE_VENDOR_PREFIX = '/_freqbeacon/explore/';
const EXPLORE_VENDOR_ASSETS = Object.freeze({
  'd3.min.js': {
    url: 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js',
    contentType: 'application/javascript; charset=utf-8'
  },
  'topojson-client.min.js': {
    url: 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js',
    contentType: 'application/javascript; charset=utf-8'
  },
  'countries-110m.json': {
    url: 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json',
    contentType: 'application/json; charset=utf-8'
  }
});

function splitSqlStatements(sql) {
  const text = String(sql || '');
  const statements = [];
  let start = 0;
  let single = false;
  let double = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "'" && !double) {
      if (single && next === "'") {
        i += 1;
        continue;
      }
      single = !single;
      continue;
    }
    if (ch === '"' && !single) {
      if (double && next === '"') {
        i += 1;
        continue;
      }
      double = !double;
      continue;
    }
    if (ch === ';' && !single && !double) {
      const statement = text.slice(start, i).trim();
      if (statement) statements.push(statement);
      start = i + 1;
    }
  }

  const tail = text.slice(start).trim();
  if (tail) statements.push(tail);
  return statements;
}

function receiverHealthCompatEnv(env) {
  const database = env?.RECEIVER_HEALTH_DB;
  if (!database) return env;

  const compatDatabase = {
    prepare: database.prepare.bind(database),
    exec: async (sql) => {
      const statements = splitSqlStatements(sql);
      const started = Date.now();
      for (const statement of statements) {
        await database.prepare(statement).run();
      }
      return { count: statements.length, duration: Date.now() - started };
    }
  };

  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === 'RECEIVER_HEALTH_DB') return compatDatabase;
      return Reflect.get(target, property, receiver);
    }
  });
}

function scheduledMinuteUtc(event) {
  const time = Number(event?.scheduledTime);
  return new Date(Number.isFinite(time) ? time : Date.now()).getUTCMinutes();
}

async function runReceiverHealthCron(event, env) {
  const inventoryReady = await receiverInventoryReady(env);
  if (!inventoryReady) {
    const seeded = await runExploreHealthCycle(receiverHealthCompatEnv(env));
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
  const bootstrapping = before.trustedReceivers < BOOTSTRAP_TRUSTED_TARGET;
  if (!bootstrapping && scheduledMinuteUtc(event) !== MAINTENANCE_MINUTE_UTC) {
    return {
      mode: 'maintenance-skip',
      trustedReceivers: before.trustedReceivers,
      inventory: before.inventory,
      untested: before.untested,
      promotionQueue: before.promotionQueue
    };
  }

  const acquired = await acquireReceiverBootstrapLease(env);
  if (!acquired) {
    return {
      mode: 'overlap-skip',
      trustedReceivers: before.trustedReceivers,
      inventory: before.inventory,
      untested: before.untested,
      promotionQueue: before.promotionQueue
    };
  }

  try {
    const screening = await runReceiverScreenCycle(env, {
      limit: SCREEN_BATCH_SIZE,
      concurrency: 6
    });
    const backfill = await runExploreBackfillCycle(env, {
      limit: FULL_PROOF_BATCH_SIZE,
      screenedOnly: true
    });

    return {
      mode: bootstrapping ? 'bootstrap' : 'maintenance',
      screened: screening.screenedNow,
      screenReachable: screening.reachableNow,
      screenUnreachable: screening.unreachableNow,
      screenPending: screening.pending,
      tested: backfill.tested,
      successful: backfill.successful,
      promoted: backfill.promoted,
      demoted: backfill.demoted,
      trustedReceivers: backfill.trustedReceivers,
      inventory: backfill.inventory,
      untested: backfill.untested,
      promotionQueue: backfill.promotionQueue
    };
  } finally {
    await releaseReceiverBootstrapLease(env);
  }
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
    let bootstrap = null;
    try {
      recentRuns = await recentReceiverHealthRuns(env, 12);
    } catch (error) {
      console.warn('FREQBEACON receiver health history read failed', error?.message || error);
    }
    try {
      bootstrap = await receiverScreenSummary(env);
    } catch (error) {
      console.warn('FREQBEACON receiver bootstrap summary read failed', error?.message || error);
    }
    payload.recentRuns = recentRuns;
    payload.lastRun = recentRuns[0] || null;
    payload.bootstrap = bootstrap;
    payload.cadence = {
      directoryRefresh: 'every 6 hours',
      bootstrap: `every minute until ${BOOTSTRAP_TRUSTED_TARGET} trusted receivers`,
      bootstrapScreenBatch: SCREEN_BATCH_SIZE,
      bootstrapFullProofBatch: FULL_PROOF_BATCH_SIZE,
      maintenance: `hourly at minute ${MAINTENANCE_MINUTE_UTC} UTC after bootstrap`,
      maintenanceWork: 'trusted revalidation, promotion candidates, then screened reachable unqualified receivers',
      strictPromotion: 'two successful real SND+W/F observations remain required'
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

async function trustedReceiverFeedResponse(request, env) {
  if (!env?.RECEIVER_HEALTH_DB) {
    return new Response(JSON.stringify({ error: 'Trusted receiver database is unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }

  try {
    const now = Date.now();
    const result = await env.RECEIVER_HEALTH_DB.prepare(`
      SELECT id,name,location,country,lat,lon,receiver_type AS receiverType,antenna
      FROM receivers
      WHERE trusted=1 AND last_success_at>=? AND last_discovered_at>=?
      ORDER BY country,location,name
    `).bind(now - TRUST_STALE_MS, now - DISCOVERY_STALE_MS).all();

    const rows = result?.results || [];
    const features = rows.map((receiver) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [receiver.lon, receiver.lat] },
      properties: {
        id: receiver.id,
        name: receiver.name,
        location: receiver.location,
        country: receiver.country || '',
        receiverType: receiver.receiverType || 'KiwiSDR',
        antenna: receiver.antenna || '',
        status: 'Healthy',
        trusted: true
      }
    }));

    const headers = {
      'content-type': 'application/geo+json; charset=utf-8',
      'cache-control': 'public, max-age=120, stale-while-revalidate=300'
    };
    if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(JSON.stringify({
      type: 'FeatureCollection',
      features,
      count: features.length,
      generatedAt: new Date().toISOString(),
      policy: 'trusted-only'
    }), { status: 200, headers });
  } catch (error) {
    console.warn('FREQBEACON trusted receiver feed query failed', error?.message || error);
    return new Response(JSON.stringify({ error: 'Trusted receiver feed query failed' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }
}

async function explorePageResponse(request, env) {
  if (!env?.ASSETS) return null;
  const url = new URL(request.url);
  url.pathname = '/explore.html';
  url.search = '';
  const assetRequest = new Request(url.toString(), {
    method: request.method,
    headers: request.headers
  });
  return env.ASSETS.fetch(assetRequest);
}

async function exploreVendorResponse(request, ctx) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(EXPLORE_VENDOR_PREFIX)) return null;
  const name = url.pathname.slice(EXPLORE_VENDOR_PREFIX.length);
  const asset = EXPLORE_VENDOR_ASSETS[name];
  if (!asset) return null;

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}${EXPLORE_VENDOR_PREFIX}${name}`, { method: 'GET' });
  let response = await cache.match(cacheKey);

  if (!response) {
    const upstream = await fetch(asset.url, {
      headers: { accept: '*/*' },
      cf: { cacheEverything: true, cacheTtl: 604800 }
    });
    if (!upstream.ok) {
      return new Response('Explore globe dependency unavailable', {
        status: 502,
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
      });
    }

    const headers = new Headers();
    headers.set('content-type', asset.contentType);
    headers.set('cache-control', 'public, max-age=604800, immutable');
    headers.set('x-content-type-options', 'nosniff');
    response = new Response(upstream.body, { status: 200, headers });
    ctx?.waitUntil(cache.put(cacheKey, response.clone()));
  }

  if (request.method === 'HEAD') {
    return new Response(null, { status: response.status, headers: response.headers });
  }
  return response;
}

async function exploreScriptResponse(request, env) {
  if (!env?.ASSETS) return null;
  const url = new URL(request.url);
  url.pathname = '/explore-page.js';
  url.search = '';
  const assetRequest = new Request(url.toString(), {
    method: request.method,
    headers: request.headers
  });
  const response = await env.ASSETS.fetch(assetRequest);
  if (!response || !response.ok || request.method === 'HEAD') return response;

  const source = await response.text();
  const rewritten = source
    .replace(
      'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json',
      '/_freqbeacon/explore/countries-110m.json'
    )
    .replace(
      "window.addEventListener('load', initialize, { once: true });",
      "if (document.readyState === 'complete') initialize(); else window.addEventListener('load', initialize, { once: true });"
    );
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('etag');
  headers.set('content-type', 'application/javascript; charset=utf-8');
  headers.set('cache-control', 'public, max-age=0, must-revalidate');
  return new Response(rewritten, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname.startsWith(EXPLORE_VENDOR_PREFIX)) {
      const response = await exploreVendorResponse(request, ctx);
      if (response) return response;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/explore-page.js') {
      const response = await exploreScriptResponse(request, env);
      if (response) return response;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && (url.pathname === '/explore' || url.pathname === '/explore/')) {
      const response = await explorePageResponse(request, env);
      if (response) return response;
    }

    if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/api/explore/receivers') {
      return trustedReceiverFeedResponse(request, env);
    }

    if (url.pathname === '/api/explore/status') {
      const statusResponse = await healthStatusResponse(request, env);
      if (statusResponse) return statusResponse;
    }

    if (url.pathname.startsWith('/api/explore/')) {
      return handleExploreApi(request, receiverHealthCompatEnv(env));
    }

    // Explore selects only an already-trusted receiver and hands it to the
    // existing Zero endpoints. It does not participate in local reception scoring.
    if (url.pathname.startsWith('/api/zero/') && selectedExploreReceiverId(request)) {
      const exploreResponse = await handleExploreZeroRequest(request, receiverHealthCompatEnv(env));
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
        const result = await runExploreHealthCycle(receiverHealthCompatEnv(env));
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