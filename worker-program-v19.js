import baseWorker from './worker-program-v18.js';

const TRUST_STALE_MS = 7 * 86400000;
const DISCOVERY_STALE_MS = 14 * 86400000;

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

function selectedExploreReceiverId(request) {
  const cookie = String(request.headers.get('cookie') || '');
  const match = cookie.match(/(?:^|;\s*)fb_explore_receiver=([^;]+)/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]).slice(0, 180); } catch { return ''; }
}

function normalizeIdentityText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&amp;/g, ' and ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function coordinateKey(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(4) : '';
}

// ReceiverBook can publish the same physical Kiwi through more than one URL or
// proxy endpoint. For Explore, identical normalized label + location + physical
// coordinates is one receiver. Explicitly different labels (V1/V2, #1/#2,
// KiwiSDR 1/2, distinct callsigns, etc.) naturally remain separate.
function physicalReceiverKey(receiver) {
  const name = normalizeIdentityText(receiver?.name);
  const location = normalizeIdentityText(receiver?.location);
  return [
    name,
    location,
    coordinateKey(receiver?.lat),
    coordinateKey(receiver?.lon)
  ].join('|');
}

function receiverIsPreferred(candidate, current) {
  if (!current) return true;
  const candidateTrusted = Number(candidate?.trusted || 0);
  const currentTrusted = Number(current?.trusted || 0);
  if (candidateTrusted !== currentTrusted) return candidateTrusted > currentTrusted;

  const candidateSuccess = Number(candidate?.lastSuccessAt ?? candidate?.last_success_at ?? 0);
  const currentSuccess = Number(current?.lastSuccessAt ?? current?.last_success_at ?? 0);
  if (candidateSuccess !== currentSuccess) return candidateSuccess > currentSuccess;

  const candidateHealth = Number(candidate?.healthScore ?? candidate?.health_score ?? 0);
  const currentHealth = Number(current?.healthScore ?? current?.health_score ?? 0);
  if (candidateHealth !== currentHealth) return candidateHealth > currentHealth;

  const candidateObservations = Number(candidate?.observations || 0);
  const currentObservations = Number(current?.observations || 0);
  if (candidateObservations !== currentObservations) return candidateObservations > currentObservations;

  return String(candidate?.id || '').localeCompare(String(current?.id || '')) < 0;
}

function dedupePhysicalReceivers(rows) {
  const groups = new Map();
  for (const receiver of rows || []) {
    const key = physicalReceiverKey(receiver);
    if (!key || key === '|||') continue;
    const current = groups.get(key);
    if (receiverIsPreferred(receiver, current)) groups.set(key, receiver);
  }
  return [...groups.values()];
}

async function trustedReceiverRows(env) {
  if (!env?.RECEIVER_HEALTH_DB) return [];
  const now = Date.now();
  const result = await env.RECEIVER_HEALTH_DB.prepare(`
    SELECT id,name,location,country,lat,lon,
           receiver_type AS receiverType,antenna,trusted,
           last_success_at AS lastSuccessAt,health_score AS healthScore,
           observations
    FROM receivers
    WHERE trusted=1 AND last_success_at>=? AND last_discovered_at>=?
    ORDER BY country,location,name,last_success_at DESC,health_score DESC
  `).bind(now - TRUST_STALE_MS, now - DISCOVERY_STALE_MS).all();
  return result?.results || [];
}

async function trustedReceiverFeedResponse(request, env) {
  if (!env?.RECEIVER_HEALTH_DB) {
    return json({ error: 'Trusted receiver database is unavailable' }, 503);
  }

  try {
    const rows = await trustedReceiverRows(env);
    const uniqueRows = dedupePhysicalReceivers(rows);
    const features = uniqueRows
      .sort((a, b) =>
        String(a.country || '').localeCompare(String(b.country || '')) ||
        String(a.location || '').localeCompare(String(b.location || '')) ||
        String(a.name || '').localeCompare(String(b.name || ''))
      )
      .map((receiver) => ({
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
      trustedEndpoints: rows.length,
      duplicatesCollapsed: Math.max(0, rows.length - features.length),
      generatedAt: new Date().toISOString(),
      policy: 'trusted-only, physical-receiver-deduplicated'
    }), { status: 200, headers });
  } catch (error) {
    console.warn('FREQBEACON deduplicated trusted receiver feed failed', error?.message || error);
    return json({ error: 'Trusted receiver feed query failed' }, 503);
  }
}

async function healthStatusResponse(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  if (!response || !response.ok || request.method === 'HEAD') return response;
  try {
    const payload = await response.clone().json();
    const rows = await trustedReceiverRows(env);
    const uniqueRows = dedupePhysicalReceivers(rows);
    payload.trustedEndpoints = rows.length;
    payload.trustedReceivers = uniqueRows.length;
    payload.duplicatesCollapsed = Math.max(0, rows.length - uniqueRows.length);
    payload.receiverIdentityPolicy = 'unique normalized label + location + coordinates; explicitly distinct receiver labels remain separate';
    const headers = new Headers(response.headers);
    headers.set('cache-control', 'no-store, max-age=0');
    return new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  } catch {
    return response;
  }
}

async function suppressDuplicateReceiverEndpoints(env) {
  if (!env?.RECEIVER_HEALTH_DB) return { duplicateGroups: 0, suppressedEndpoints: 0 };
  const cutoff = Date.now() - DISCOVERY_STALE_MS;
  const result = await env.RECEIVER_HEALTH_DB.prepare(`
    SELECT id,name,location,country,lat,lon,trusted,last_success_at AS lastSuccessAt,
           health_score AS healthScore,observations
    FROM receivers
    WHERE last_discovered_at>=?
  `).bind(cutoff).all();
  const rows = result?.results || [];
  const groups = new Map();
  for (const receiver of rows) {
    const key = physicalReceiverKey(receiver);
    if (!key || key === '|||') continue;
    const group = groups.get(key) || [];
    group.push(receiver);
    groups.set(key, group);
  }

  const duplicateIds = [];
  let duplicateGroups = 0;
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    duplicateGroups += 1;
    let canonical = null;
    for (const receiver of group) {
      if (receiverIsPreferred(receiver, canonical)) canonical = receiver;
    }
    for (const receiver of group) {
      if (receiver.id !== canonical?.id) duplicateIds.push(receiver.id);
    }
  }

  for (let offset = 0; offset < duplicateIds.length; offset += 50) {
    const chunk = duplicateIds.slice(offset, offset + 50);
    const placeholders = chunk.map(() => '?').join(',');
    await env.RECEIVER_HEALTH_DB.prepare(`
      UPDATE receivers
      SET trusted=0, last_discovered_at=0
      WHERE id IN (${placeholders})
    `).bind(...chunk).run();
  }

  return { duplicateGroups, suppressedEndpoints: duplicateIds.length };
}

async function liveFailureResponse(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env?.RECEIVER_HEALTH_DB) return json({ error: 'Receiver health database unavailable' }, 503);

  const receiverId = selectedExploreReceiverId(request);
  if (!receiverId) return json({ error: 'No Explore receiver is selected' }, 409);

  try {
    // A real Zero SND/W/F failure is stronger evidence than an old background
    // success. Remove the receiver from the green trusted feed immediately. The
    // normal health proof cycle can promote it again after it proves usable.
    const result = await env.RECEIVER_HEALTH_DB.prepare(`
      UPDATE receivers SET
        trusted=0,
        consecutive_failures=CASE
          WHEN consecutive_failures < 8 THEN consecutive_failures + 1
          ELSE consecutive_failures
        END,
        snd_success=0,
        wf_success=0,
        health_score=MAX(0, health_score - 25)
      WHERE id=?
    `).bind(receiverId).run();

    return json({
      ok: true,
      receiverId,
      temporarilyHidden: true,
      changed: Number(result?.meta?.changes || 0)
    });
  } catch (error) {
    console.warn('FREQBEACON live receiver failure persistence failed', error?.message || error);
    return json({ error: 'Could not update receiver health' }, 503);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/explore/live-failure') {
      return liveFailureResponse(request, env);
    }
    if (url.pathname === '/api/explore/receivers' && (request.method === 'GET' || request.method === 'HEAD')) {
      return trustedReceiverFeedResponse(request, env);
    }
    if (url.pathname === '/api/explore/status' && (request.method === 'GET' || request.method === 'HEAD')) {
      return healthStatusResponse(request, env, ctx);
    }
    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    try {
      await suppressDuplicateReceiverEndpoints(env);
    } catch (error) {
      console.warn('FREQBEACON receiver duplicate suppression before health cycle failed', error?.message || error);
    }

    const result = typeof baseWorker.scheduled === 'function'
      ? await baseWorker.scheduled(event, env, ctx)
      : undefined;

    try {
      const cleanup = await suppressDuplicateReceiverEndpoints(env);
      if (cleanup.suppressedEndpoints > 0) {
        console.log('FREQBEACON duplicate receiver endpoints suppressed', JSON.stringify(cleanup));
      }
    } catch (error) {
      console.warn('FREQBEACON receiver duplicate suppression after health cycle failed', error?.message || error);
    }

    return result;
  }
};
