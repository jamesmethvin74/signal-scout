import { APPROVED_SDR_RECEIVERS } from './sdr-approved-receivers.js';

export const KIWI_PUBLIC_DIRECTORY_URL =
  'http://kiwisdr.com/public.list/index.html.gz?freqbeacon.methvindigitalworks.com';
export const KIWI_PUBLIC_DIRECTORY_SOURCE = 'kiwisdr-public-list';
export const KIWI_DIRECTORY_MIN_FETCH_MS = 60 * 60 * 1000;
const DISCOVERY_STALE_MS = 14 * 86400000;
const MAX_DIRECTORY_RECEIVERS = 5000;
let schemaReady = null;

function db(env) {
  if (!env?.RECEIVER_HEALTH_DB) throw new Error('RECEIVER_HEALTH_DB binding is not configured');
  return env.RECEIVER_HEALTH_DB;
}

function cleanText(value, max = 220) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function sqlText(value) {
  return `'${String(value ?? '').replace(/\u0000/g, '').replace(/'/g, "''")}'`;
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

export function normalizeKiwiReceiverUrl(rawUrl) {
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

function parseGps(value) {
  const match = String(value || '').match(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

function inferCountry(location) {
  const parts = cleanText(location).split(',').map((part) => part.trim()).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1].slice(0, 80) : '';
}

function receiverUrlFromBlock(block) {
  const anchor = String(block || '').match(/<a\b[^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/i);
  if (!anchor) return null;
  const label = cleanText(anchor[2], 300);
  const href = cleanText(anchor[1], 300);
  if (/^https?:\/\//i.test(label)) return label;
  if (/^https?:\/\//i.test(href)) return href;
  return null;
}

export function parseKiwiPublicListHtml(html) {
  const source = String(html || '');
  const starts = [...source.matchAll(/<div\s+class=['"]cl-info['"][^>]*>/gi)];
  const receivers = [];
  const seen = new Set();

  for (let index = 0; index < starts.length; index += 1) {
    const begin = starts[index].index;
    const end = index + 1 < starts.length ? starts[index + 1].index : source.length;
    const block = source.slice(begin, end);
    const fields = {};

    for (const match of block.matchAll(/<!--\s*([A-Za-z0-9_]+)=(.*?)\s*-->/g)) {
      fields[match[1]] = cleanText(match[2], 500);
    }

    if (String(fields.status || '').toLowerCase() !== 'active') continue;
    if (String(fields.offline || '').toLowerCase() === 'yes') continue;
    if (String(fields.auth || '').toLowerCase() === 'password') continue;

    const extApi = Number(fields.ext_api);
    if (!Number.isFinite(extApi) || extApi < 1) continue;

    const gps = parseGps(fields.gps);
    if (!gps) continue;

    const normalized = normalizeKiwiReceiverUrl(receiverUrlFromBlock(block));
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);

    const name = cleanText(fields.name || 'Public KiwiSDR');
    const location = cleanText(fields.loc || name);
    receivers.push({
      ...normalized,
      name,
      location,
      country: inferCountry(location),
      lat: gps.lat,
      lon: gps.lon,
      version: cleanText(fields.sw_version || fields.sdr_hw || '', 120),
      receiverType: 'KiwiSDR',
      antenna: cleanText(fields.antenna || '', 180),
      source: KIWI_PUBLIC_DIRECTORY_SOURCE,
      extApi: Math.max(0, Math.floor(extApi)),
      users: Number.isFinite(Number(fields.users)) ? Math.max(0, Math.floor(Number(fields.users))) : null,
      usersMax: Number.isFinite(Number(fields.users_max)) ? Math.max(0, Math.floor(Number(fields.users_max))) : null
    });

    if (receivers.length >= MAX_DIRECTORY_RECEIVERS) break;
  }

  return receivers;
}

async function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await db(env).prepare(`
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
        )
      `).run();
      await db(env).prepare(`
        CREATE TABLE IF NOT EXISTS receiver_directory_state (
          source TEXT PRIMARY KEY,
          last_attempt_at INTEGER NOT NULL DEFAULT 0,
          last_success_at INTEGER NOT NULL DEFAULT 0,
          receiver_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT NOT NULL DEFAULT ''
        )
      `).run();
      await db(env).prepare(`
        INSERT OR IGNORE INTO receiver_directory_state
          (source,last_attempt_at,last_success_at,receiver_count,last_error)
        VALUES (?,0,0,0,'')
      `).bind(KIWI_PUBLIC_DIRECTORY_SOURCE).run();
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function decodeDirectoryBody(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const gzipMagic = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (gzipMagic) {
    if (typeof DecompressionStream !== 'function') throw new Error('gzip decompression is unavailable');
    const stream = new Response(bytes).body.pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).text();
  }
  return new TextDecoder().decode(bytes);
}

async function ingestDirectory(env, receivers, discoveredAt) {
  for (let offset = 0; offset < receivers.length; offset += 75) {
    const rows = receivers.slice(offset, offset + 75);
    const values = rows.map((receiver) => `(
      ${sqlText(receiver.id)},${sqlText(receiver.name)},${sqlText(receiver.location)},${sqlText(receiver.country)},
      ${Number(receiver.lat)},${Number(receiver.lon)},${sqlText(receiver.upstreamHost)},${sqlText(receiver.hostname)},
      ${sqlText(receiver.protocol)},${sqlText(receiver.version)},${sqlText(receiver.receiverType || 'KiwiSDR')},
      ${sqlText(receiver.antenna)},${Number(discoveredAt)}
    )`).join(',');

    await db(env).prepare(`
      INSERT INTO receivers (
        id,name,location,country,lat,lon,upstream_host,hostname,protocol,version,receiver_type,antenna,last_discovered_at
      ) VALUES ${values}
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, location=excluded.location, country=excluded.country,
        lat=excluded.lat, lon=excluded.lon, upstream_host=excluded.upstream_host,
        hostname=excluded.hostname, protocol=excluded.protocol, version=excluded.version,
        receiver_type=excluded.receiver_type, antenna=excluded.antenna,
        last_discovered_at=excluded.last_discovered_at
    `).run();
  }

  await db(env).prepare(`
    UPDATE receivers
    SET trusted=0, last_discovered_at=0
    WHERE last_discovered_at<>?
  `).bind(discoveredAt).run();
}

export async function kiwiDirectoryStatus(env) {
  await ensureSchema(env);
  const row = await db(env).prepare(`
    SELECT source,last_attempt_at AS lastAttemptAt,last_success_at AS lastSuccessAt,
           receiver_count AS receiverCount,last_error AS lastError
    FROM receiver_directory_state
    WHERE source=?
    LIMIT 1
  `).bind(KIWI_PUBLIC_DIRECTORY_SOURCE).first();
  return row || {
    source: KIWI_PUBLIC_DIRECTORY_SOURCE,
    lastAttemptAt: 0,
    lastSuccessAt: 0,
    receiverCount: 0,
    lastError: ''
  };
}

export async function refreshKiwiPublicDirectory(env, options = {}) {
  await ensureSchema(env);
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const cutoff = now - KIWI_DIRECTORY_MIN_FETCH_MS;

  const claim = await db(env).prepare(`
    UPDATE receiver_directory_state
    SET last_attempt_at=?
    WHERE source=? AND last_attempt_at<=?
  `).bind(now, KIWI_PUBLIC_DIRECTORY_SOURCE, cutoff).run();

  if (Number(claim?.meta?.changes || 0) < 1) {
    const state = await kiwiDirectoryStatus(env);
    return { status: 'cached', receiverCount: Number(state.receiverCount || 0), state };
  }

  try {
    const response = await fetch(KIWI_PUBLIC_DIRECTORY_URL, {
      headers: {
        accept: 'application/gzip, text/html;q=0.8',
        'user-agent': 'FREQBEACON/1.0 authorized KiwiSDR directory cache'
      },
      redirect: 'follow'
    });
    if (!response.ok) throw new Error(`Kiwi public list HTTP ${response.status}`);

    const html = await decodeDirectoryBody(response);
    const receivers = parseKiwiPublicListHtml(html);
    if (receivers.length < 25) {
      throw new Error(`Kiwi public list parser returned only ${receivers.length} usable receivers`);
    }

    await ingestDirectory(env, receivers, now);
    await db(env).prepare(`
      UPDATE receiver_directory_state
      SET last_success_at=?, receiver_count=?, last_error=''
      WHERE source=?
    `).bind(now, receivers.length, KIWI_PUBLIC_DIRECTORY_SOURCE).run();

    return { status: 'refreshed', receiverCount: receivers.length, fetchedAt: now };
  } catch (error) {
    const message = String(error?.message || 'directory refresh failed').slice(0, 300);
    await db(env).prepare(`
      UPDATE receiver_directory_state
      SET last_error=?
      WHERE source=?
    `).bind(message, KIWI_PUBLIC_DIRECTORY_SOURCE).run();
    return { status: 'error', receiverCount: 0, error: message };
  }
}

function staticFallbackReceivers() {
  return APPROVED_SDR_RECEIVERS.map((receiver) => ({
    ...receiver,
    minKHz: 10,
    maxKHz: 30000,
    coverageKnown: true,
    source: 'manual-static-fallback'
  }));
}

export async function cachedReceiverDirectory(env, options = {}) {
  await ensureSchema(env);
  const trustedOnly = options.trustedOnly !== false;
  const cutoff = Date.now() - DISCOVERY_STALE_MS;
  const result = await db(env).prepare(`
    SELECT id,name,location,country,lat,lon,upstream_host AS upstreamHost,hostname,protocol,version,
           receiver_type AS receiverType,antenna,trusted,last_success_at AS lastSuccessAt
    FROM receivers
    WHERE last_discovered_at>=? ${trustedOnly ? 'AND trusted=1' : ''}
    ORDER BY country,location,name
  `).bind(cutoff).all();

  const rows = (result?.results || []).map((receiver) => ({
    ...receiver,
    minKHz: 10,
    maxKHz: 30000,
    coverageKnown: false,
    source: KIWI_PUBLIC_DIRECTORY_SOURCE
  }));
  return rows.length ? rows : staticFallbackReceivers();
}

export async function cachedReceiverById(env, receiverId, options = {}) {
  await ensureSchema(env);
  const id = String(receiverId || '').trim();
  if (!id || id.length > 180) return null;
  const trustedOnly = options.trustedOnly !== false;
  const cutoff = Date.now() - DISCOVERY_STALE_MS;
  const row = await db(env).prepare(`
    SELECT id,name,location,country,lat,lon,upstream_host AS upstreamHost,hostname,protocol,version,
           receiver_type AS receiverType,antenna,trusted,last_success_at AS lastSuccessAt
    FROM receivers
    WHERE id=? AND last_discovered_at>=? ${trustedOnly ? 'AND trusted=1' : ''}
    LIMIT 1
  `).bind(id, cutoff).first();
  if (row) return row;
  return staticFallbackReceivers().find((receiver) => receiver.id === id) || null;
}
