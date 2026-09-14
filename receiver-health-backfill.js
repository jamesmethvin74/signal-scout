const BACKFILL_BATCH_SIZE = 10;
const HISTORY_LIMIT = 8;
const TRUST_STALE_MS = 7 * 86400000;
const DISCOVERY_STALE_MS = 14 * 86400000;
const NEW_TSTAMP_SPACE = 1n << 62n;
const LOWER_TSTAMP_MASK = NEW_TSTAMP_SPACE - 1n;

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      ...headers
    }
  });
}

function db(env) {
  if (!env?.RECEIVER_HEALTH_DB) throw new Error('RECEIVER_HEALTH_DB binding is not configured');
  return env.RECEIVER_HEALTH_DB;
}

function candidateSelect() {
  return `id,name,location,country,lat,lon,upstream_host AS upstreamHost,hostname,protocol,version,
          receiver_type AS receiverType,antenna,trusted,recent_successes AS recentSuccesses,
          consecutive_failures AS consecutiveFailures,last_tested_at AS lastTestedAt`;
}

export function candidateBudget(trustedCount = 0, limit = BACKFILL_BATCH_SIZE) {
  const safeLimit = Math.max(1, Math.min(12, Math.floor(Number(limit) || BACKFILL_BATCH_SIZE)));
  const trusted = Number(trustedCount || 0) < 125 ? 1 : 2;
  const promotion = Math.min(7, Math.max(4, Math.ceil(safeLimit * 0.6)));
  return {
    limit: safeLimit,
    promotion,
    trusted: Math.min(trusted, Math.max(1, safeLimit - promotion)),
    fresh: safeLimit
  };
}

export function proxySafeTimestamp(timestamp) {
  const text = String(timestamp || '');
  const raw = /^\d+$/.test(text) ? BigInt(text) : BigInt(Math.floor(Date.now() / 1000));
  return (NEW_TSTAMP_SPACE | (raw & LOWER_TSTAMP_MASK)).toString();
}

export function evaluateHealthTransition(existing = {}, result = {}) {
  let history = [];
  if (Array.isArray(existing.history)) history = [...existing.history];
  else {
    try { history = JSON.parse(existing.history || '[]'); } catch {}
  }
  if (!Array.isArray(history)) history = [];
  history = history.map((value) => value ? 1 : 0).slice(-HISTORY_LIMIT + 1);

  const success = Boolean(result.reachable && result.sndSuccess && result.wfSuccess);
  history.push(success ? 1 : 0);
  history = history.slice(-HISTORY_LIMIT);

  const recentSuccesses = history.reduce((total, value) => total + (value ? 1 : 0), 0);
  const recentFailures = history.length - recentSuccesses;
  const successRate = history.length ? recentSuccesses / history.length : 0;
  const consecutiveFailures = success ? 0 : Number(existing.consecutive_failures ?? existing.consecutiveFailures ?? 0) + 1;

  let trusted = Boolean(Number(existing.trusted || 0));
  if (!trusted && success && history.length >= 2 && recentSuccesses >= 2 && successRate >= 0.75) trusted = true;
  if (trusted && !success && (consecutiveFailures >= 2 || successRate < 0.625)) trusted = false;

  const connectMs = Number.isFinite(Number(result.connectMs)) ? Math.max(0, Math.round(Number(result.connectMs))) : null;
  const latencyPoints = connectMs == null ? 0 : connectMs <= 2500 ? 10 : connectMs <= 5000 ? 6 : connectMs <= 8000 ? 3 : 0;
  const healthScore = Math.max(0, Math.min(100,
    Math.round(successRate * 80 + (success ? 10 : 0) + latencyPoints - consecutiveFailures * 12)
  ));

  return {
    success,
    history,
    recentSuccesses,
    recentFailures,
    successRate,
    consecutiveFailures,
    trusted,
    connectMs,
    healthScore
  };
}

export async function receiverInventoryReady(env) {
  try {
    const row = await db(env).prepare('SELECT COUNT(*) AS count FROM receivers').first();
    return Number(row?.count || 0) > 0;
  } catch {
    return false;
  }
}

export async function receiverHealthSummary(env) {
  const now = Date.now();
  try {
    const row = await db(env).prepare(`
      SELECT
        COUNT(*) AS inventory,
        SUM(CASE WHEN trusted=1 AND last_success_at>=? AND last_discovered_at>=? THEN 1 ELSE 0 END) AS trustedFresh,
        SUM(CASE WHEN observations=0 THEN 1 ELSE 0 END) AS untested,
        SUM(CASE WHEN trusted=0 AND recent_successes>0 THEN 1 ELSE 0 END) AS promotionQueue,
        SUM(CASE WHEN last_tested_at>=? THEN 1 ELSE 0 END) AS tested24h,
        MAX(last_discovered_at) AS lastDiscoveryAt,
        MAX(last_tested_at) AS lastTestedAt,
        MAX(last_success_at) AS lastSuccessAt
      FROM receivers
    `).bind(now - TRUST_STALE_MS, now - DISCOVERY_STALE_MS, now - 86400000).first();

    return {
      inventoryReady: Number(row?.inventory || 0) > 0,
      inventory: Number(row?.inventory || 0),
      trustedReceivers: Number(row?.trustedFresh || 0),
      untested: Number(row?.untested || 0),
      promotionQueue: Number(row?.promotionQueue || 0),
      testedLast24h: Number(row?.tested24h || 0),
      lastDiscoveryAt: row?.lastDiscoveryAt ? Number(row.lastDiscoveryAt) : null,
      lastTestedAt: row?.lastTestedAt ? Number(row.lastTestedAt) : null,
      lastSuccessAt: row?.lastSuccessAt ? Number(row.lastSuccessAt) : null
    };
  } catch {
    return {
      inventoryReady: false,
      inventory: 0,
      trustedReceivers: 0,
      untested: 0,
      promotionQueue: 0,
      testedLast24h: 0,
      lastDiscoveryAt: null,
      lastTestedAt: null,
      lastSuccessAt: null
    };
  }
}

async function loadCandidates(env, limit = BACKFILL_BATCH_SIZE, options = {}) {
  const summary = await receiverHealthSummary(env);
  if (!summary.inventoryReady) return { summary, candidates: [] };

  const budget = candidateBudget(summary.trustedReceivers, limit);
  const cutoff = Date.now() - DISCOVERY_STALE_MS;
  const screenedOnly = Boolean(options.screenedOnly);
  const freshScreenClause = screenedOnly
    ? `AND EXISTS (
         SELECT 1 FROM receiver_screening s
         WHERE s.receiver_id=receivers.id AND s.reachable=1
       )`
    : '';
  const result = await db(env).prepare(`
    SELECT * FROM (
      SELECT ${candidateSelect()}, 0 AS bucket, COALESCE(last_tested_at,0) AS sort_value
      FROM receivers
      WHERE last_discovered_at>=? AND trusted=0 AND recent_successes>0
      ORDER BY COALESCE(last_tested_at,0) ASC
      LIMIT ${budget.promotion}
    )
    UNION ALL
    SELECT * FROM (
      SELECT ${candidateSelect()}, 1 AS bucket, COALESCE(last_tested_at,0) AS sort_value
      FROM receivers
      WHERE last_discovered_at>=? AND trusted=1
      ORDER BY COALESCE(last_tested_at,0) ASC
      LIMIT ${budget.trusted}
    )
    UNION ALL
    SELECT * FROM (
      SELECT ${candidateSelect()}, 2 AS bucket, COALESCE(last_tested_at,0) AS sort_value
      FROM receivers
      WHERE last_discovered_at>=? AND trusted=0 AND recent_successes=0
        ${freshScreenClause}
      ORDER BY CASE WHEN last_tested_at IS NULL THEN 0 ELSE 1 END ASC, COALESCE(last_tested_at,0) ASC
      LIMIT ${budget.fresh}
    )
    ORDER BY bucket, sort_value
    LIMIT ${budget.limit}
  `).bind(cutoff, cutoff, cutoff).all();

  return { summary, candidates: result.results || [] };
}

function upstreamBase(receiver) {
  return `${receiver.protocol}//${receiver.upstreamHost}`;
}

function tagOf(bytes) {
  if (!bytes || bytes.length < 3) return '';
  return String.fromCharCode(bytes[0], bytes[1], bytes[2]);
}

function messageText(bytes) {
  return new TextDecoder().decode(bytes.subarray(4));
}

function commonKiwiError(text) {
  const badp = String(text || '').match(/(?:^|\s)badp=(\d+)/);
  if (badp && Number(badp[1]) !== 0) return `authentication rejected (${badp[1]})`;
  if (/(?:^|\s)too_busy=1(?:\s|$)/.test(text)) return 'receiver busy';
  if (/(?:^|\s)down=1(?:\s|$)/.test(text)) return 'receiver reports down';
  return null;
}

async function openUpstreamSocket(receiver, stream, sessionTs) {
  const base = upstreamBase(receiver);
  const response = await fetch(`${base}/ws/kiwi/${sessionTs}/${stream}`, {
    headers: {
      Upgrade: 'websocket',
      Origin: base,
      'User-Agent': 'FREQBEACON/1.0 receiver health backfill'
    }
  });
  if (!response.webSocket) throw new Error(`${stream} refused WebSocket (${response.status})`);
  const socket = response.webSocket;
  socket.binaryType = 'arraybuffer';
  socket.accept();
  return socket;
}

function closeSocket(socket, reason = 'FREQBEACON health check complete') {
  if (!socket) return;
  try { socket.close(1000, reason); } catch {}
}

function waitForSndProof(socket, timeoutMs = 5500) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let frames = 0;
    let configured = false;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('error', onError);
      socket.removeEventListener('close', onClose);
      if (error) reject(error); else resolve(frames);
    };
    const configure = (sampleRate = 12000) => {
      if (configured) return;
      configured = true;
      const rate = Number.isFinite(sampleRate) && sampleRate > 1000 && sampleRate < 100000 ? sampleRate : 12000;
      socket.send(`SET AR OK in=${Math.round(rate)} out=48000`);
      socket.send('SET mod=am low_cut=-5000 high_cut=5000 freq=10000.000');
      socket.send('SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50');
      socket.send('SET compression=0');
      socket.send('SET squelch=0 max=0');
    };
    const onMessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(event.data);
      const tag = tagOf(bytes);
      if (tag === 'MSG') {
        const text = messageText(bytes);
        const error = commonKiwiError(text);
        if (error) return finish(new Error(`SND ${error}`));
        const rate = Number(text.match(/(?:^|\s)sample_rate=([0-9.]+)/)?.[1]);
        if (Number.isFinite(rate)) configure(rate);
        return;
      }
      if (tag !== 'SND' || bytes.length < 12) return;
      frames += 1;
      if (frames >= 2) finish();
    };
    const onError = () => finish(new Error('SND socket error'));
    const onClose = (event) => finish(new Error(`SND closed before proof (${event.code})`));
    const timer = setTimeout(() => finish(new Error('SND proof timeout')), timeoutMs);
    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onError);
    socket.addEventListener('close', onClose);
    socket.send('SET auth t=kiwi p=');
    socket.send('SERVER DE CLIENT FREQBEACON-HEALTH SND');
    socket.send('SET ident_user=FREQBEACON HEALTH');
  });
}

function waitForWfProof(socket, timeoutMs = 5500) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeEventListener('message', onMessage);
      socket.removeEventListener('error', onError);
      socket.removeEventListener('close', onClose);
      if (error) reject(error); else resolve(true);
    };
    const onMessage = (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const bytes = new Uint8Array(event.data);
      const tag = tagOf(bytes);
      if (tag === 'MSG') {
        const error = commonKiwiError(messageText(bytes));
        if (error) finish(new Error(`W/F ${error}`));
        return;
      }
      if (tag === 'W/F' && bytes.length >= 16 + 1024) finish();
    };
    const onError = () => finish(new Error('W/F socket error'));
    const onClose = (event) => finish(new Error(`W/F closed before proof (${event.code})`));
    const timer = setTimeout(() => finish(new Error('W/F proof timeout')), timeoutMs);
    socket.addEventListener('message', onMessage);
    socket.addEventListener('error', onError);
    socket.addEventListener('close', onClose);
    socket.send('SET auth t=kiwi p=');
    socket.send('SERVER DE CLIENT FREQBEACON-HEALTH W/F');
    socket.send('SET ident_user=FREQBEACON HEALTH');
    socket.send('SET send_dB=1');
    socket.send('SET zoom=8 cf=10000.000');
    socket.send('SET maxdb=-35 mindb=-125');
    socket.send('SET wf_comp=0');
    socket.send('SET interp=13');
    socket.send('SET window_func=2');
    socket.send('SET wf_speed=1');
  });
}

async function probeReceiver(receiver) {
  const testedAt = Date.now();
  const result = {
    receiverId: receiver.id,
    testedAt,
    reachable: false,
    sndSuccess: false,
    wfSuccess: false,
    connectMs: null,
    error: null
  };
  let snd = null;
  let wf = null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);
    let versionResponse;
    try {
      versionResponse = await fetch(`${upstreamBase(receiver)}/VER`, {
        headers: { Accept: 'application/json', 'User-Agent': 'FREQBEACON/1.0 receiver health backfill' },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if (!versionResponse.ok) throw new Error(`VER HTTP ${versionResponse.status}`);
    const version = await versionResponse.json();
    result.reachable = true;
    const sessionTs = proxySafeTimestamp(version?.ts);

    snd = await openUpstreamSocket(receiver, 'SND', sessionTs);
    await waitForSndProof(snd);
    result.sndSuccess = true;

    wf = await openUpstreamSocket(receiver, 'W/F', sessionTs);
    await waitForWfProof(wf);
    result.wfSuccess = true;
    result.connectMs = Date.now() - testedAt;
  } catch (error) {
    result.connectMs = Date.now() - testedAt;
    result.error = String(error?.message || 'probe failed').slice(0, 240);
  } finally {
    closeSocket(wf);
    closeSocket(snd);
  }
  return result;
}

async function recordProbe(env, result) {
  const existing = await db(env).prepare(`
    SELECT history,trusted,consecutive_failures,last_success_at
    FROM receivers WHERE id=? LIMIT 1
  `).bind(result.receiverId).first();
  if (!existing) return null;

  const next = evaluateHealthTransition(existing, result);
  const testedAt = Number(result.testedAt) || Date.now();
  const lastSuccessAt = next.success ? testedAt : existing.last_success_at;

  await db(env).prepare(`
    UPDATE receivers SET
      last_tested_at=?, last_success_at=?, observations=observations+1,
      recent_successes=?, recent_failures=?, consecutive_failures=?,
      snd_success=?, wf_success=?, connect_ms=?, success_rate=?, health_score=?, trusted=?, history=?
    WHERE id=?
  `).bind(
    testedAt, lastSuccessAt, next.recentSuccesses, next.recentFailures, next.consecutiveFailures,
    result.sndSuccess ? 1 : 0, result.wfSuccess ? 1 : 0, next.connectMs, next.successRate,
    next.healthScore, next.trusted ? 1 : 0, JSON.stringify(next.history), result.receiverId
  ).run();

  return next;
}

export async function runExploreBackfillCycle(env, options = {}) {
  const limit = Math.max(1, Math.min(12, Math.floor(Number(options.limit) || BACKFILL_BATCH_SIZE)));
  const loaded = await loadCandidates(env, limit, { screenedOnly: Boolean(options.screenedOnly) });
  if (!loaded.summary.inventoryReady) {
    return { inventoryReady: false, tested: 0, successful: 0, promoted: 0, demoted: 0, results: [] };
  }

  const results = [];
  let successful = 0;
  let promoted = 0;
  let demoted = 0;

  for (const receiver of loaded.candidates.slice(0, limit)) {
    const wasTrusted = Boolean(Number(receiver.trusted || 0));
    const probe = await probeReceiver(receiver);
    const next = await recordProbe(env, probe);
    if (next?.success) successful += 1;
    if (!wasTrusted && next?.trusted) promoted += 1;
    if (wasTrusted && next && !next.trusted) demoted += 1;
    results.push({
      id: receiver.id,
      success: Boolean(next?.success),
      trusted: Boolean(next?.trusted),
      connectMs: next?.connectMs ?? null,
      error: probe.error || null
    });
  }

  const summary = await receiverHealthSummary(env);
  return {
    inventoryReady: true,
    tested: results.length,
    successful,
    promoted,
    demoted,
    trustedReceivers: summary.trustedReceivers,
    inventory: summary.inventory,
    untested: summary.untested,
    promotionQueue: summary.promotionQueue,
    results
  };
}

export async function handleExploreHealthStatus(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== '/api/explore/status') return null;
  const summary = await receiverHealthSummary(env);
  return json({
    ok: true,
    state: !summary.inventoryReady ? 'warming' : summary.trustedReceivers > 0 ? 'ready' : 'qualifying',
    inventory: summary.inventory,
    trustedReceivers: summary.trustedReceivers,
    promotionQueue: summary.promotionQueue,
    untested: summary.untested,
    testedLast24h: summary.testedLast24h,
    lastDiscoveryAt: summary.lastDiscoveryAt ? new Date(summary.lastDiscoveryAt).toISOString() : null,
    lastTestedAt: summary.lastTestedAt ? new Date(summary.lastTestedAt).toISOString() : null,
    lastSuccessAt: summary.lastSuccessAt ? new Date(summary.lastSuccessAt).toISOString() : null,
    policy: {
      visibility: 'trusted-only',
      promotion: 'two successful real SND+W/F observations with rolling success rate >= 75%',
      demotion: 'two consecutive failed observations or rolling success rate below 62.5%',
      staleAfterDays: 7
    },
    cadence: {
      directoryRefresh: 'every 6 hours',
      healthBackfill: 'hourly',
      batchSize: BACKFILL_BATCH_SIZE
    }
  }, 200, { 'cache-control': 'public, max-age=30, stale-while-revalidate=60' });
}
