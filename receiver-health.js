import { DurableObject } from 'cloudflare:workers';

const DIRECTORY_URL = 'https://www.receiverbook.de/map?type=kiwisdr';
const MAX_RECEIVERS = 1400;
const BATCH_SIZE = 8;
const HISTORY_LIMIT = 8;
const TRUST_STALE_MS = 7 * 86400000;
const DISCOVERY_STALE_MS = 14 * 86400000;
const NEW_TSTAMP_SPACE = 1n << 62n;
const LOWER_TSTAMP_MASK = NEW_TSTAMP_SPACE - 1n;
const STORE_ORIGIN = 'https://freqbeacon-health.internal';

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

function finiteNumber(value) {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cleanText(value, max = 180) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function isBlockedHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '0.0.0.0' || host === '::' || host === '::1') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const private172 = host.match(/^172\.(\d+)\./);
  if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return true;
  if (/^(?:fc|fd|fe80):/i.test(host)) return true;
  return false;
}

function normalizeReceiverUrl(rawUrl) {
  if (!rawUrl) return null;
  let parsed;
  try { parsed = new URL(String(rawUrl).trim()); } catch { return null; }
  if (!['http:', 'https:'].includes(parsed.protocol) || isBlockedHost(parsed.hostname)) return null;
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  return {
    id: `${parsed.hostname.toLowerCase()}:${port}`,
    upstreamHost: parsed.host,
    hostname: parsed.hostname.toLowerCase(),
    protocol: parsed.protocol
  };
}

function parseReceiverBook(html) {
  const match = String(html || '').match(/var\s+receivers\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) throw new Error('ReceiverBook format was not recognized');
  const sites = JSON.parse(match[1]);
  if (!Array.isArray(sites)) throw new Error('ReceiverBook did not contain a receiver list');

  const byId = new Map();
  for (const site of sites) {
    const coordinates = site?.location?.coordinates;
    const lon = finiteNumber(Array.isArray(coordinates) ? coordinates[0] : site?.lon);
    const lat = finiteNumber(Array.isArray(coordinates) ? coordinates[1] : site?.lat);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const siteLabel = cleanText(site?.label || site?.name || '');
    const children = Array.isArray(site?.receivers) && site.receivers.length ? site.receivers : [site];
    for (const child of children) {
      if (byId.size >= MAX_RECEIVERS) break;
      const typeText = [child?.type, child?.version, child?.software].filter(Boolean).join(' ');
      if (typeText && /(?:openwebrx|websdr)/i.test(typeText) && !/kiwi/i.test(typeText)) continue;
      const normalized = normalizeReceiverUrl(child?.url || site?.url);
      if (!normalized || byId.has(normalized.id)) continue;

      const childLabel = cleanText(child?.label || child?.name || '');
      const name = childLabel || siteLabel || normalized.upstreamHost;
      byId.set(normalized.id, {
        ...normalized,
        name,
        location: siteLabel || childLabel || name,
        country: cleanText(child?.country || site?.country || '', 80),
        lat,
        lon,
        version: cleanText(child?.version || '', 80),
        receiverType: 'KiwiSDR',
        antenna: cleanText(child?.antenna || site?.antenna || '', 180)
      });
    }
    if (byId.size >= MAX_RECEIVERS) break;
  }
  return [...byId.values()];
}

function storeStub(env) {
  if (!env?.RECEIVER_HEALTH) throw new Error('RECEIVER_HEALTH binding is not configured');
  return env.RECEIVER_HEALTH.get(env.RECEIVER_HEALTH.idFromName('freqbeacon-global-receiver-health-v1'));
}

async function storeRequest(env, path, init = {}) {
  const response = await storeStub(env).fetch(`${STORE_ORIGIN}${path}`, init);
  if (!response.ok) {
    let detail = '';
    try { detail = await response.text(); } catch {}
    throw new Error(`receiver health store ${path} failed (${response.status})${detail ? `: ${detail.slice(0, 180)}` : ''}`);
  }
  return response;
}

function proxySafeTimestamp(timestamp) {
  const text = String(timestamp || '');
  const raw = /^\d+$/.test(text) ? BigInt(text) : BigInt(Math.floor(Date.now() / 1000));
  return (NEW_TSTAMP_SPACE | (raw & LOWER_TSTAMP_MASK)).toString();
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
  const badp = text.match(/(?:^|\s)badp=(\d+)/);
  if (badp && Number(badp[1]) !== 0) return `authentication rejected (${badp[1]})`;
  if (/(?:^|\s)too_busy=1(?:\s|$)/.test(text)) return 'receiver busy';
  if (/(?:^|\s)down=1(?:\s|$)/.test(text)) return 'receiver reports down';
  return null;
}

async function openUpstreamSocket(receiver, stream, sessionTs, agent = 'FREQBEACON/1.0 receiver health probe') {
  const base = upstreamBase(receiver);
  const response = await fetch(`${base}/ws/kiwi/${sessionTs}/${stream}`, {
    headers: { Upgrade: 'websocket', Origin: base, 'User-Agent': agent }
  });
  if (!response.webSocket) throw new Error(`${stream} refused WebSocket (${response.status})`);
  const socket = response.webSocket;
  socket.binaryType = 'arraybuffer';
  socket.accept();
  return socket;
}

function closeSocket(socket, reason = 'FREQBEACON health probe complete') {
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
    const versionResponse = await fetch(`${upstreamBase(receiver)}/VER`, {
      headers: { Accept: 'application/json', 'User-Agent': 'FREQBEACON/1.0 receiver health probe' }
    });
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

async function discoverReceivers() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(DIRECTORY_URL, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'FREQBEACON/1.0 trusted receiver discovery'
      },
      signal: controller.signal,
      cf: { cacheTtl: 15 * 60, cacheEverything: true }
    });
    if (!response.ok) throw new Error(`ReceiverBook HTTP ${response.status}`);
    return parseReceiverBook(await response.text());
  } finally {
    clearTimeout(timer);
  }
}

export async function runExploreHealthCycle(env) {
  const discoveredAt = Date.now();
  const receivers = await discoverReceivers();
  await storeRequest(env, '/ingest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ receivers, discoveredAt })
  });

  const candidatesResponse = await storeRequest(env, `/candidates?limit=${BATCH_SIZE}`);
  const { receivers: candidates = [] } = await candidatesResponse.json();
  const results = [];
  for (const receiver of candidates.slice(0, BATCH_SIZE)) {
    const result = await probeReceiver(receiver);
    results.push(result);
    await storeRequest(env, '/record', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(result)
    });
  }
  return { discovered: receivers.length, tested: results.length, results };
}

export async function handleExploreApi(request, env) {
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.pathname !== '/api/explore/receivers') {
    return json({ error: 'Explore endpoint not found' }, 404);
  }
  const response = await storeRequest(env, '/trusted');
  const payload = await response.json();
  const features = (payload.receivers || []).map((receiver) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [receiver.lon, receiver.lat] },
    properties: {
      id: receiver.id,
      name: receiver.name,
      location: receiver.location,
      country: receiver.country || '',
      receiverType: receiver.receiverType || 'KiwiSDR',
      antenna: receiver.antenna || '',
      status: 'Healthy'
    }
  }));
  return json({
    type: 'FeatureCollection',
    features,
    count: features.length,
    generatedAt: new Date().toISOString(),
    policy: 'trusted-only'
  }, 200, { 'cache-control': 'public, max-age=120, stale-while-revalidate=300' });
}

export function selectedExploreReceiverId(request) {
  const cookie = String(request.headers.get('cookie') || '');
  const match = cookie.match(/(?:^|;\s*)fb_explore_receiver=([^;]+)/);
  if (!match) return null;
  try { return decodeURIComponent(match[1]).slice(0, 180); } catch { return null; }
}

async function trustedReceiver(env, receiverId) {
  const id = String(receiverId || '').trim();
  if (!id || id.length > 180) return null;
  try {
    const response = await storeRequest(env, `/receiver?id=${encodeURIComponent(id)}`);
    return (await response.json()).receiver || null;
  } catch {
    return null;
  }
}

export class ReceiverHealthStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS receivers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        location TEXT NOT NULL,
        country TEXT NOT NULL DEFAULT '',
        lat REAL NOT NULL,
        lon REAL NOT NULL,
        upstream_host TEXT NOT NULL,
        hostname TEXT NOT NULL,
        protocol TEXT NOT NULL,
        version TEXT NOT NULL DEFAULT '',
        receiver_type TEXT NOT NULL DEFAULT 'KiwiSDR',
        antenna TEXT NOT NULL DEFAULT '',
        last_discovered_at INTEGER NOT NULL,
        last_tested_at INTEGER,
        last_success_at INTEGER,
        observations INTEGER NOT NULL DEFAULT 0,
        recent_successes INTEGER NOT NULL DEFAULT 0,
        recent_failures INTEGER NOT NULL DEFAULT 0,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        snd_success INTEGER NOT NULL DEFAULT 0,
        wf_success INTEGER NOT NULL DEFAULT 0,
        connect_ms INTEGER,
        success_rate REAL NOT NULL DEFAULT 0,
        health_score INTEGER NOT NULL DEFAULT 0,
        trusted INTEGER NOT NULL DEFAULT 0,
        history TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX IF NOT EXISTS idx_receivers_trusted_success ON receivers(trusted, last_success_at);
      CREATE INDEX IF NOT EXISTS idx_receivers_tested ON receivers(last_tested_at);
      CREATE INDEX IF NOT EXISTS idx_receivers_discovered ON receivers(last_discovered_at);
    `);
  }

  rows(query, ...args) {
    return [...this.sql.exec(query, ...args)];
  }

  async ingest(request) {
    const body = await request.json();
    const receivers = Array.isArray(body?.receivers) ? body.receivers.slice(0, MAX_RECEIVERS) : [];
    const discoveredAt = Number(body?.discoveredAt) || Date.now();
    for (const receiver of receivers) {
      if (!receiver?.id || !receiver?.upstreamHost || !Number.isFinite(receiver?.lat) || !Number.isFinite(receiver?.lon)) continue;
      this.sql.exec(`
        INSERT INTO receivers (
          id,name,location,country,lat,lon,upstream_host,hostname,protocol,version,receiver_type,antenna,last_discovered_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, location=excluded.location, country=excluded.country,
          lat=excluded.lat, lon=excluded.lon, upstream_host=excluded.upstream_host,
          hostname=excluded.hostname, protocol=excluded.protocol, version=excluded.version,
          receiver_type=excluded.receiver_type, antenna=excluded.antenna,
          last_discovered_at=excluded.last_discovered_at
      `,
      String(receiver.id), cleanText(receiver.name) || String(receiver.id),
      cleanText(receiver.location) || cleanText(receiver.name) || String(receiver.id),
      cleanText(receiver.country, 80), Number(receiver.lat), Number(receiver.lon),
      String(receiver.upstreamHost), String(receiver.hostname),
      receiver.protocol === 'https:' ? 'https:' : 'http:', cleanText(receiver.version, 80),
      'KiwiSDR', cleanText(receiver.antenna), discoveredAt);
    }
    return json({ ok: true, received: receivers.length });
  }

  candidates(url) {
    const limit = Math.max(1, Math.min(BATCH_SIZE, Number(url.searchParams.get('limit')) || BATCH_SIZE));
    const pool = this.rows(`
      SELECT id,name,location,country,lat,lon,upstream_host AS upstreamHost,hostname,protocol,version,
             receiver_type AS receiverType,antenna,trusted,recent_successes AS recentSuccesses,last_tested_at AS lastTestedAt
      FROM receivers
      WHERE last_discovered_at >= ?
      ORDER BY CASE WHEN trusted=0 AND recent_successes>0 THEN 0 ELSE 1 END,
               COALESCE(last_tested_at,0) ASC
      LIMIT 64
    `, Date.now() - DISCOVERY_STALE_MS);

    const progress = pool.filter((row) => !row.trusted && row.recentSuccesses > 0);
    const trusted = pool.filter((row) => Boolean(row.trusted));
    const fresh = pool.filter((row) => !row.trusted && row.recentSuccesses === 0);
    const picked = [];
    const seen = new Set();
    const add = (items, max = Infinity) => {
      let count = 0;
      for (const item of items) {
        if (picked.length >= limit || count >= max) break;
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        picked.push(item);
        count += 1;
      }
    };
    add(progress, Math.ceil(limit / 2));
    add(trusted, Math.max(1, Math.floor(limit / 4)));
    add(fresh);
    add(progress);
    add(trusted);
    return json({ receivers: picked });
  }

  async record(request) {
    const body = await request.json();
    const receiverId = String(body?.receiverId || '');
    const existing = this.rows('SELECT * FROM receivers WHERE id=? LIMIT 1', receiverId)[0];
    if (!existing) return json({ error: 'receiver not found' }, 404);

    let history = [];
    try { history = JSON.parse(existing.history || '[]'); } catch {}
    if (!Array.isArray(history)) history = [];
    const success = Boolean(body?.reachable && body?.sndSuccess && body?.wfSuccess);
    history.push(success ? 1 : 0);
    history = history.slice(-HISTORY_LIMIT);
    const recentSuccesses = history.reduce((total, value) => total + (value ? 1 : 0), 0);
    const recentFailures = history.length - recentSuccesses;
    const rate = history.length ? recentSuccesses / history.length : 0;
    const consecutiveFailures = success ? 0 : Number(existing.consecutive_failures || 0) + 1;
    let trusted = Boolean(existing.trusted);
    if (!trusted && success && history.length >= 2 && recentSuccesses >= 2 && rate >= 0.75) trusted = true;
    if (trusted && !success && (consecutiveFailures >= 2 || rate < 0.625)) trusted = false;

    const connectMs = Number.isFinite(Number(body?.connectMs)) ? Math.max(0, Math.round(Number(body.connectMs))) : null;
    const latencyPoints = connectMs == null ? 0 : connectMs <= 2500 ? 10 : connectMs <= 5000 ? 6 : connectMs <= 8000 ? 3 : 0;
    const healthScore = Math.max(0, Math.min(100, Math.round(rate * 80 + (success ? 10 : 0) + latencyPoints - consecutiveFailures * 12)));
    const testedAt = Number(body?.testedAt) || Date.now();
    const lastSuccessAt = success ? testedAt : existing.last_success_at;

    this.sql.exec(`
      UPDATE receivers SET
        last_tested_at=?, last_success_at=?, observations=observations+1,
        recent_successes=?, recent_failures=?, consecutive_failures=?,
        snd_success=?, wf_success=?, connect_ms=?, success_rate=?, health_score=?, trusted=?, history=?
      WHERE id=?
    `, testedAt, lastSuccessAt, recentSuccesses, recentFailures, consecutiveFailures,
    body?.sndSuccess ? 1 : 0, body?.wfSuccess ? 1 : 0, connectMs, rate, healthScore,
    trusted ? 1 : 0, JSON.stringify(history), receiverId);

    return json({ ok: true, trusted, successRate: rate, healthScore });
  }

  trusted() {
    const now = Date.now();
    return json({ receivers: this.rows(`
      SELECT id,name,location,country,lat,lon,receiver_type AS receiverType,antenna
      FROM receivers
      WHERE trusted=1 AND last_success_at>=? AND last_discovered_at>=?
      ORDER BY country,location,name
    `, now - TRUST_STALE_MS, now - DISCOVERY_STALE_MS) });
  }

  receiver(url) {
    const id = String(url.searchParams.get('id') || '');
    const now = Date.now();
    const receiver = this.rows(`
      SELECT id,name,location,country,lat,lon,upstream_host AS upstreamHost,hostname,protocol,version,
             receiver_type AS receiverType,antenna
      FROM receivers
      WHERE id=? AND trusted=1 AND last_success_at>=? AND last_discovered_at>=?
      LIMIT 1
    `, id, now - TRUST_STALE_MS, now - DISCOVERY_STALE_MS)[0] || null;
    return json({ receiver });
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/ingest') return this.ingest(request);
    if (request.method === 'POST' && url.pathname === '/record') return this.record(request);
    if (request.method === 'GET' && url.pathname === '/candidates') return this.candidates(url);
    if (request.method === 'GET' && url.pathname === '/trusted') return this.trusted();
    if (request.method === 'GET' && url.pathname === '/receiver') return this.receiver(url);
    return json({ error: 'health store endpoint not found' }, 404);
  }
}

function parseStatusPairs(text) {
  const pairs = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq > 0) pairs[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return pairs;
}

async function fetchTrustedText(receiver, path, accept = 'text/plain') {
  const response = await fetch(`${upstreamBase(receiver)}${path}`, {
    headers: { accept, 'user-agent': 'FREQBEACON-ZERO/explore' }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} FAILED (${response.status})`);
  return text;
}

async function trustedBootstrap(receiver) {
  try {
    const versionText = await fetchTrustedText(receiver, '/VER', 'application/json');
    let version;
    try { version = JSON.parse(versionText); }
    catch { return json({ ok: false, error: 'RECEIVER VER INVALID' }, 502); }
    const rawTs = String(version?.ts ?? '');
    if (!/^\d{1,20}$/.test(rawTs)) return json({ ok: false, error: 'RECEIVER SESSION TIMESTAMP MISSING' }, 502);
    return json({
      ok: true,
      sessionTs: proxySafeTimestamp(rawTs),
      receiver: { id: receiver.id, name: receiver.name, place: receiver.location },
      kiwi: {
        major: Number.isFinite(Number(version?.maj)) ? Number(version.maj) : null,
        minor: Number.isFinite(Number(version?.min)) ? Number(version.min) : null
      }
    });
  } catch (error) {
    return json({ ok: false, error: `RECEIVER VER FAILED: ${error?.message || 'network error'}` }, 502);
  }
}

async function trustedDiagnostics(receiver) {
  try {
    const [versionText, statusText] = await Promise.all([
      fetchTrustedText(receiver, '/VER', 'application/json'),
      fetchTrustedText(receiver, '/status', 'text/plain')
    ]);
    let version = null;
    try { version = JSON.parse(versionText); } catch {}
    return json({
      ok: true,
      observedAt: new Date().toISOString(),
      receiver: { id: receiver.id, name: receiver.name, place: receiver.location, host: receiver.upstreamHost },
      kiwi: {
        major: Number.isFinite(Number(version?.maj)) ? Number(version.maj) : null,
        minor: Number.isFinite(Number(version?.min)) ? Number(version.min) : null,
        sessionTs: version?.ts != null ? String(version.ts) : null
      },
      status: parseStatusPairs(statusText)
    });
  } catch (error) {
    return json({ ok: false, error: `RECEIVER DIAGNOSTICS FAILED: ${error?.message || 'network error'}` }, 502);
  }
}

async function trustedZeroSocket(request, url, receiver) {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('WEBSOCKET REQUIRED', { status: 426 });
  }
  const stream = url.searchParams.get('stream');
  const sessionTs = url.searchParams.get('ts') || '';
  if (!['SND', 'W/F'].includes(stream)) return new Response('UNKNOWN STREAM', { status: 400 });
  if (!/^\d{8,20}$/.test(sessionTs)) return new Response('BAD SESSION TIMESTAMP', { status: 400 });

  try {
    const response = await fetch(`${upstreamBase(receiver)}/ws/kiwi/${sessionTs}/${stream}`, {
      headers: {
        Upgrade: 'websocket',
        Origin: upstreamBase(receiver),
        'User-Agent': 'FREQBEACON-ZERO/explore'
      }
    });
    if (!response.webSocket) return new Response(`${stream} REFUSED (${response.status})`, { status: 502 });
    return response;
  } catch (error) {
    return new Response(`${stream} CONNECT FAILED: ${error?.message || 'network error'}`, { status: 502 });
  }
}

export async function handleExploreZeroRequest(request, env) {
  const receiverId = selectedExploreReceiverId(request);
  if (!receiverId) return null;
  const receiver = await trustedReceiver(env, receiverId);
  const url = new URL(request.url);
  if (!receiver) {
    if (url.pathname === '/api/zero/bootstrap' || url.pathname === '/api/zero/diagnostics') {
      return json({ ok: false, error: 'EXPLORE RECEIVER IS NO LONGER TRUSTED. CHOOSE ANOTHER RECEIVER IN EXPLORE.' }, 409);
    }
    if (url.pathname === '/api/zero/ws') return new Response('EXPLORE RECEIVER NO LONGER TRUSTED', { status: 409 });
    return null;
  }
  if (request.method === 'GET' && url.pathname === '/api/zero/bootstrap') return trustedBootstrap(receiver);
  if (request.method === 'GET' && url.pathname === '/api/zero/diagnostics') return trustedDiagnostics(receiver);
  if (url.pathname === '/api/zero/ws') return trustedZeroSocket(request, url, receiver);
  return null;
}
