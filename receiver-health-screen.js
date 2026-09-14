const SCREEN_BATCH_SIZE = 18;
const SCREEN_CONCURRENCY = 6;
const SCREEN_TIMEOUT_MS = 2500;
const SCREEN_RETRY_MS = 6 * 60 * 60 * 1000;
const DISCOVERY_STALE_MS = 14 * 86400000;
const LEASE_MS = 3 * 60 * 1000;
let screenSchemaReady = null;

function db(env) {
  if (!env?.RECEIVER_HEALTH_DB) throw new Error('RECEIVER_HEALTH_DB binding is not configured');
  return env.RECEIVER_HEALTH_DB;
}

async function ensureScreenSchema(env) {
  if (!screenSchemaReady) {
    screenSchemaReady = (async () => {
      await db(env).prepare(`
        CREATE TABLE IF NOT EXISTS receiver_screening (
          receiver_id TEXT PRIMARY KEY,
          screened_at INTEGER NOT NULL,
          reachable INTEGER NOT NULL DEFAULT 0,
          latency_ms INTEGER,
          consecutive_failures INTEGER NOT NULL DEFAULT 0,
          last_error TEXT
        )
      `).run();
      await db(env).prepare(`
        CREATE INDEX IF NOT EXISTS idx_receiver_screening_reachable
        ON receiver_screening(reachable, screened_at)
      `).run();
      await db(env).prepare(`
        CREATE TABLE IF NOT EXISTS receiver_bootstrap_lease (
          id INTEGER PRIMARY KEY CHECK(id=1),
          expires_at INTEGER NOT NULL DEFAULT 0
        )
      `).run();
    })().catch((error) => {
      screenSchemaReady = null;
      throw error;
    });
  }
  return screenSchemaReady;
}

function safeWhole(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

export async function acquireReceiverBootstrapLease(env) {
  await ensureScreenSchema(env);
  const now = Date.now();
  const result = await db(env).prepare(`
    INSERT INTO receiver_bootstrap_lease (id,expires_at)
    VALUES (1,?)
    ON CONFLICT(id) DO UPDATE SET expires_at=excluded.expires_at
    WHERE receiver_bootstrap_lease.expires_at<?
  `).bind(now + LEASE_MS, now).run();
  return Number(result?.meta?.changes || 0) > 0;
}

export async function releaseReceiverBootstrapLease(env) {
  await ensureScreenSchema(env);
  await db(env).prepare('UPDATE receiver_bootstrap_lease SET expires_at=0 WHERE id=1').run();
}

async function loadScreenCandidates(env, limit) {
  await ensureScreenSchema(env);
  const cutoff = Date.now() - DISCOVERY_STALE_MS;
  const retryBefore = Date.now() - SCREEN_RETRY_MS;
  const result = await db(env).prepare(`
    SELECT r.id,r.protocol,r.upstream_host AS upstreamHost
    FROM receivers r
    LEFT JOIN receiver_screening s ON s.receiver_id=r.id
    WHERE r.last_discovered_at>=?
      AND r.trusted=0
      AND r.observations=0
      AND (
        s.receiver_id IS NULL
        OR (s.reachable=0 AND s.screened_at<?)
      )
    ORDER BY
      CASE WHEN s.receiver_id IS NULL THEN 0 ELSE 1 END,
      COALESCE(s.screened_at,0) ASC,
      r.id ASC
    LIMIT ${limit}
  `).bind(cutoff, retryBefore).all();
  return result.results || [];
}

async function quickVerProbe(receiver) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCREEN_TIMEOUT_MS);
  try {
    const response = await fetch(`${receiver.protocol}//${receiver.upstreamHost}/VER`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'FREQBEACON/1.0 receiver bootstrap screen'
      },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`VER HTTP ${response.status}`);
    await response.json();
    return {
      receiverId: receiver.id,
      reachable: true,
      screenedAt: Date.now(),
      latencyMs: Date.now() - startedAt,
      error: null
    };
  } catch (error) {
    return {
      receiverId: receiver.id,
      reachable: false,
      screenedAt: Date.now(),
      latencyMs: Date.now() - startedAt,
      error: String(error?.message || 'VER screen failed').slice(0, 240)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function recordScreen(env, result) {
  await db(env).prepare(`
    INSERT INTO receiver_screening (
      receiver_id,screened_at,reachable,latency_ms,consecutive_failures,last_error
    ) VALUES (?,?,?,?,?,?)
    ON CONFLICT(receiver_id) DO UPDATE SET
      screened_at=excluded.screened_at,
      reachable=excluded.reachable,
      latency_ms=excluded.latency_ms,
      consecutive_failures=CASE
        WHEN excluded.reachable=1 THEN 0
        ELSE receiver_screening.consecutive_failures+1
      END,
      last_error=excluded.last_error
  `).bind(
    result.receiverId,
    result.screenedAt,
    result.reachable ? 1 : 0,
    safeWhole(result.latencyMs),
    result.reachable ? 0 : 1,
    result.error || null
  ).run();
}

async function mapConcurrent(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function receiverScreenSummary(env) {
  await ensureScreenSchema(env);
  const cutoff = Date.now() - DISCOVERY_STALE_MS;
  const row = await db(env).prepare(`
    SELECT
      COUNT(*) AS inventory,
      SUM(CASE WHEN r.observations>0 OR s.receiver_id IS NOT NULL THEN 1 ELSE 0 END) AS screened,
      SUM(CASE WHEN r.observations>0 OR s.reachable=1 THEN 1 ELSE 0 END) AS reachable,
      SUM(CASE WHEN r.observations=0 AND s.receiver_id IS NOT NULL AND s.reachable=0 THEN 1 ELSE 0 END) AS unreachable,
      SUM(CASE WHEN r.observations=0 AND s.receiver_id IS NULL THEN 1 ELSE 0 END) AS pending
    FROM receivers r
    LEFT JOIN receiver_screening s ON s.receiver_id=r.id
    WHERE r.last_discovered_at>=?
  `).bind(cutoff).first();

  return {
    inventory: safeWhole(row?.inventory),
    screened: safeWhole(row?.screened),
    reachable: safeWhole(row?.reachable),
    unreachable: safeWhole(row?.unreachable),
    pending: safeWhole(row?.pending)
  };
}

export async function runReceiverScreenCycle(env, options = {}) {
  const limit = Math.max(1, Math.min(SCREEN_BATCH_SIZE, Math.floor(Number(options.limit) || SCREEN_BATCH_SIZE)));
  const concurrency = Math.max(1, Math.min(SCREEN_CONCURRENCY, Math.floor(Number(options.concurrency) || SCREEN_CONCURRENCY)));
  const candidates = await loadScreenCandidates(env, limit);
  const results = await mapConcurrent(candidates, concurrency, quickVerProbe);

  for (const result of results) await recordScreen(env, result);

  const summary = await receiverScreenSummary(env);
  return {
    screenedNow: results.length,
    reachableNow: results.filter((item) => item?.reachable).length,
    unreachableNow: results.filter((item) => item && !item.reachable).length,
    ...summary
  };
}
