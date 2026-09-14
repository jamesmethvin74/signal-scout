const RUN_RETENTION_MS = 14 * 86400000;
const DEFAULT_HISTORY_LIMIT = 12;
let runSchemaReady = null;

function db(env) {
  if (!env?.RECEIVER_HEALTH_DB) throw new Error('RECEIVER_HEALTH_DB binding is not configured');
  return env.RECEIVER_HEALTH_DB;
}

async function ensureRunSchema(env) {
  if (!runSchemaReady) {
    runSchemaReady = (async () => {
      await db(env).prepare(`
        CREATE TABLE IF NOT EXISTS receiver_health_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_at INTEGER NOT NULL,
          duration_ms INTEGER NOT NULL DEFAULT 0,
          mode TEXT NOT NULL,
          status TEXT NOT NULL,
          discovered INTEGER NOT NULL DEFAULT 0,
          tested INTEGER NOT NULL DEFAULT 0,
          successful INTEGER NOT NULL DEFAULT 0,
          promoted INTEGER NOT NULL DEFAULT 0,
          demoted INTEGER NOT NULL DEFAULT 0,
          trusted_receivers INTEGER NOT NULL DEFAULT 0,
          inventory INTEGER NOT NULL DEFAULT 0,
          untested INTEGER NOT NULL DEFAULT 0,
          promotion_queue INTEGER NOT NULL DEFAULT 0,
          error TEXT
        )
      `).run();
      await db(env).prepare(`
        CREATE INDEX IF NOT EXISTS idx_receiver_health_runs_run_at
        ON receiver_health_runs(run_at DESC)
      `).run();
    })().catch((error) => {
      runSchemaReady = null;
      throw error;
    });
  }
  return runSchemaReady;
}

function whole(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0;
}

export function normalizeReceiverHealthRun(run = {}, now = Date.now()) {
  const error = run.error ? String(run.error).slice(0, 400) : null;
  return {
    runAt: whole(run.runAt) || whole(now),
    durationMs: whole(run.durationMs),
    mode: String(run.mode || (error ? 'error' : 'unknown')).slice(0, 40),
    status: error ? 'error' : 'ok',
    discovered: whole(run.discovered),
    tested: whole(run.tested),
    successful: whole(run.successful),
    promoted: whole(run.promoted),
    demoted: whole(run.demoted),
    trustedReceivers: whole(run.trustedReceivers),
    inventory: whole(run.inventory),
    untested: whole(run.untested),
    promotionQueue: whole(run.promotionQueue),
    error
  };
}

export async function recordReceiverHealthRun(env, run = {}) {
  await ensureRunSchema(env);
  const value = normalizeReceiverHealthRun(run);

  await db(env).prepare(`
    INSERT INTO receiver_health_runs (
      run_at,duration_ms,mode,status,discovered,tested,successful,promoted,demoted,
      trusted_receivers,inventory,untested,promotion_queue,error
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    value.runAt, value.durationMs, value.mode, value.status, value.discovered,
    value.tested, value.successful, value.promoted, value.demoted,
    value.trustedReceivers, value.inventory, value.untested, value.promotionQueue,
    value.error
  ).run();

  await db(env).prepare('DELETE FROM receiver_health_runs WHERE run_at < ?')
    .bind(value.runAt - RUN_RETENTION_MS)
    .run();

  return value;
}

export async function recentReceiverHealthRuns(env, limit = DEFAULT_HISTORY_LIMIT) {
  await ensureRunSchema(env);
  const safeLimit = Math.max(1, Math.min(48, Math.floor(Number(limit) || DEFAULT_HISTORY_LIMIT)));
  const result = await db(env).prepare(`
    SELECT run_at AS runAt,duration_ms AS durationMs,mode,status,discovered,tested,
           successful,promoted,demoted,trusted_receivers AS trustedReceivers,
           inventory,untested,promotion_queue AS promotionQueue,error
    FROM receiver_health_runs
    ORDER BY run_at DESC, id DESC
    LIMIT ${safeLimit}
  `).all();

  return (result.results || []).map((row) => ({
    runAt: row.runAt ? new Date(Number(row.runAt)).toISOString() : null,
    durationMs: whole(row.durationMs),
    mode: String(row.mode || ''),
    status: String(row.status || 'ok'),
    discovered: whole(row.discovered),
    tested: whole(row.tested),
    successful: whole(row.successful),
    promoted: whole(row.promoted),
    demoted: whole(row.demoted),
    trustedReceivers: whole(row.trustedReceivers),
    inventory: whole(row.inventory),
    untested: whole(row.untested),
    promotionQueue: whole(row.promotionQueue),
    error: row.error || null
  }));
}
