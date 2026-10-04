import baseWorker from './worker-program-v21.js';
import {
  applySecurityHeaders,
  enforceAbuseLimits,
  securityResponse,
  validateSecurityRequest
} from './security-hardening.js';
import { kiwiDirectoryStatus, refreshKiwiPublicDirectory } from './kiwi-public-directory.js';
import { receiverHealthSummary, runExploreBackfillCycle } from './receiver-health-backfill.js';

const RECEIVER_HEALTH_CRON = '* * * * *';

function proofXml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function proofRegion(receiver) {
  const lat = Number(receiver?.lat), lon = Number(receiver?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat >= 13 && lat <= 84 && lon >= -170 && lon <= -50) return 'North America';
  if (lat >= -56 && lat < 13 && lon >= -82 && lon <= -34) return 'South America';
  if (lat >= 35 && lat <= 72 && lon >= -25 && lon <= 52) return 'Europe';
  if (lat >= -35 && lat < 35 && lon >= -20 && lon <= 52) return 'Africa';
  if (lat >= -10 && lat <= 72 && lon > 52 && lon <= 180) return 'Asia';
  if (lat >= -50 && lat < -10 && lon >= 110 && lon <= 180) return 'Oceania';
  return null;
}

async function proofInventory(env) {
  const cutoff = Date.now() - 14 * 86400000;
  const countRow = await env.RECEIVER_HEALTH_DB.prepare(`
    SELECT COUNT(*) AS inventory, SUM(CASE WHEN trusted=1 THEN 1 ELSE 0 END) AS trusted
    FROM receivers WHERE last_discovered_at>=?
  `).bind(cutoff).first();
  const rows = (await env.RECEIVER_HEALTH_DB.prepare(`
    SELECT id,name,location,country,lat,lon,trusted FROM receivers
    WHERE last_discovered_at>=? ORDER BY id LIMIT 2000
  `).bind(cutoff).all())?.results || [];
  const samples = [], seen = new Set();
  for (const receiver of rows) {
    const region = proofRegion(receiver);
    if (!region || seen.has(region)) continue;
    seen.add(region);
    samples.push({ region, ...receiver });
    if (samples.length >= 6) break;
  }
  return { inventory:Number(countRow?.inventory || 0), trusted:Number(countRow?.trusted || 0), samples };
}

async function saveRuntimeProof(env, payload) {
  await env.RECEIVER_HEALTH_DB.prepare(`
    CREATE TABLE IF NOT EXISTS receiver_directory_runtime_proof (
      id INTEGER PRIMARY KEY,
      captured_at INTEGER NOT NULL,
      payload TEXT NOT NULL
    )
  `).run();
  await env.RECEIVER_HEALTH_DB.prepare(`
    INSERT INTO receiver_directory_runtime_proof (id,captured_at,payload)
    VALUES (1,?,?)
    ON CONFLICT(id) DO UPDATE SET captured_at=excluded.captured_at,payload=excluded.payload
  `).bind(Date.now(), JSON.stringify(payload)).run();
}

async function loadRuntimeProof(env) {
  try {
    const row = await env.RECEIVER_HEALTH_DB.prepare(
      'SELECT captured_at AS capturedAt,payload FROM receiver_directory_runtime_proof WHERE id=1 LIMIT 1'
    ).first();
    return row ? { capturedAt:Number(row.capturedAt || 0), ...JSON.parse(String(row.payload || '{}')) } : null;
  } catch {
    return null;
  }
}

async function dropRuntimeProof(env) {
  await env.RECEIVER_HEALTH_DB.prepare('DROP TABLE IF EXISTS receiver_directory_runtime_proof').run();
}

function proofMetricValue(payload, metric) {
  const d = payload?.first?.diagnostics || {};
  const samples = payload?.inventory?.samples || [];
  const regionBits = { 'North America':1, 'South America':2, Europe:4, Africa:8, Asia:16, Oceania:32 };
  const regionMask = samples.reduce((mask,item)=>mask | (regionBits[item.region] || 0), 0);
  const map = {
    firstStatus: payload?.first?.status === 'refreshed' ? 1 : payload?.first?.status === 'error' ? 2 : payload?.first?.status === 'cached' ? 3 : 0,
    httpStatus: Number(d.httpStatus || 0),
    gzipMagic: d.gzipMagic === true ? 1 : 0,
    responseBytes100: Math.round(Number(d.responseBytes || 0) / 100),
    directoryEntries: Number(d.directoryEntries || 0),
    extApiFields: Number(d.extApiFields || 0),
    rawExtApiZero: Number(d.rawExtApiZero || 0),
    parsedExtApiZero: Number(d.parsedExtApiZero || 0),
    parsedMinExtApi: Number(d.parsedMinExtApi || 0),
    receiverCount: Number(payload?.first?.receiverCount || 0),
    d1Inventory: Number(payload?.inventory?.inventory || 0),
    d1Trusted: Number(payload?.inventory?.trusted || 0),
    secondCached: payload?.second?.status === 'cached' ? 1 : 0,
    feedCount: Number(payload?.feedCount || 0),
    feedHttpStatus: Number(payload?.feedStatus || 0),
    probeTested: Number(payload?.probes?.tested || 0),
    probeSuccessful: Number(payload?.probes?.successful || 0),
    probe1Success: payload?.probes?.results?.[0]?.success ? 1 : 0,
    probe1ConnectMs: Number(payload?.probes?.results?.[0]?.connectMs || 0),
    probe2Success: payload?.probes?.results?.[1]?.success ? 1 : 0,
    probe2ConnectMs: Number(payload?.probes?.results?.[1]?.connectMs || 0),
    regionMask
  };
  return Number.isFinite(map[metric]) ? Math.max(0, Math.floor(map[metric])) : 0;
}

async function proofMetricSvg(request, env) {
  const payload = await loadRuntimeProof(env);
  const metric = new URL(request.url).searchParams.get('metric') || '';
  const value = proofMetricValue(payload, metric);
  const targetBytes = Math.round((10 + Math.min(value, 10000) * 0.1) * 1024);
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><rect width="100%" height="100%" fill="#07131c"/><text x="10" y="40" font-family="monospace" font-size="16" fill="#d8f8ff">${proofXml(metric)}=${value}</text></svg>`;
  const pad=Math.max(0,targetBytes-new TextEncoder().encode(svg).length-7);
  svg += `<!--${'x'.repeat(pad)}-->`;
  return applySecurityHeaders(new Response(svg,{status:200,headers:{'content-type':'image/svg+xml; charset=utf-8','cache-control':'no-store, max-age=0'}}));
}

async function proofCleanupSvg(env) {
  await dropRuntimeProof(env);
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="400" height="80"><text x="10" y="40">proof state removed</text></svg>';
  return applySecurityHeaders(new Response(svg,{status:200,headers:{'content-type':'image/svg+xml; charset=utf-8','cache-control':'no-store, max-age=0'}}));
}

async function directoryProofSvg(request, env) {
  const first = await refreshKiwiPublicDirectory(env);
  const second = await refreshKiwiPublicDirectory(env);
  const state = await kiwiDirectoryStatus(env);
  const before = await receiverHealthSummary(env);
  const probes = await runExploreBackfillCycle(env, { limit: 2 });
  const after = await receiverHealthSummary(env);
  const inventory = await proofInventory(env);
  const feedResponse = await baseWorker.fetch(new Request(new URL('/api/explore/receivers', request.url).toString()), env, {});
  let feed = {};
  try { feed = await feedResponse.json(); } catch {}
  const proofPayload = {
    first, second, state, before, probes, after, inventory,
    feedStatus: feedResponse.status,
    feedCount: Number(feed?.count || 0),
    feedPolicy: feed?.policy || ''
  };
  await saveRuntimeProof(env, proofPayload);
  const d = first?.diagnostics || {};
  const lines = [
    'FREQBEACON KiwiSDR authorized-directory runtime proof',
    `first refresh: ${first?.status || 'unknown'} | parsed=${Number(first?.receiverCount || 0)} | error=${first?.error || 'none'}`,
    `authorized URL: ${d.requestedUrl || 'cached/no-network-fetch'}`,
    `ACL/HTTP: ${d.httpStatus ?? 'cached'} | response URL: ${d.responseUrl || 'cached'}`,
    `gzip magic: ${d.gzipMagic ?? 'cached'} | encoding: ${d.contentEncoding || '(none)'} | bytes: ${d.responseBytes ?? 'cached'}`,
    `raw entries: ${d.directoryEntries ?? 'cached'} | ext_api fields: ${d.extApiFields ?? 'cached'}`,
    `raw ext_api=0: ${d.rawExtApiZero ?? 'cached'} | parsed ext_api<1: ${d.parsedExtApiZero ?? 'cached'} | min parsed ext_api: ${d.parsedMinExtApi ?? 'cached'}`,
    `D1 inventory: ${inventory.inventory} | D1 trusted: ${inventory.trusted} | state count: ${Number(state?.receiverCount || 0)}`,
    `state last success: ${state?.lastSuccessAt ? new Date(Number(state.lastSuccessAt)).toISOString() : 'none'}`,
    `state last attempt: ${state?.lastAttemptAt ? new Date(Number(state.lastAttemptAt)).toISOString() : 'none'} | last error=${state?.lastError || 'none'}`,
    `immediate second refresh: ${second?.status || 'unknown'} | count=${Number(second?.receiverCount || 0)}`,
    `health before: inventory=${before.inventory} trusted=${before.trustedReceivers} untested=${before.untested}`,
    `health probes: tested=${probes.tested} successful=${probes.successful} promoted=${probes.promoted} demoted=${probes.demoted}`,
    ...((probes.results || []).map((item, index) => `probe ${index+1}: ${item.id} success=${item.success} trusted=${item.trusted} connectMs=${item.connectMs ?? 'n/a'} error=${item.error || 'none'}`)),
    `health after: inventory=${after.inventory} trusted=${after.trustedReceivers} tested24h=${after.testedLast24h}`,
    `trusted Explore feed: HTTP ${feedResponse.status} count=${Number(feed?.count || 0)} policy=${feed?.policy || 'unknown'}`,
    ...inventory.samples.map((item) => `sample ${item.region}: ${item.id} | ${item.location || item.name || ''} | trusted=${Boolean(Number(item.trusted))}`)
  ];
  const lineHeight=24, height=Math.max(720,50+lines.length*lineHeight);
  const texts=lines.map((line,i)=>`<text x="20" y="${38+i*lineHeight}" font-family="monospace" font-size="16" fill="#d8f8ff">${proofXml(line)}</text>`).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="${height}" viewBox="0 0 1600 ${height}"><rect width="100%" height="100%" fill="#07131c"/>${texts}</svg>`;
  return applySecurityHeaders(new Response(svg,{status:200,headers:{'content-type':'image/svg+xml; charset=utf-8','cache-control':'no-store, max-age=0'}}));
}

async function directoryStateSvg(env) {
  const state = await kiwiDirectoryStatus(env);
  const error = String(state?.lastError || '');
  let targetBytes = 1024;
  const http = error.match(/^Kiwi public list HTTP (\d+)$/);
  const parser = error.match(/^Kiwi public list parser returned only (\d+) usable receivers$/);
  if (http) {
    const status = Number(http[1]);
    targetBytes = Math.round((10 + Math.max(0, Math.min(199, status - 400)) * 0.1) * 1024);
  } else if (parser) {
    targetBytes = Math.round((6 + Math.min(24, Number(parser[1])) * 0.1) * 1024);
  } else if (/gzip|decompression/i.test(error)) {
    targetBytes = 9 * 1024;
  } else if (/D1|SQL|database|no such|constraint/i.test(error)) {
    targetBytes = 10 * 1024;
  } else if (/fetch|network|connect|timeout|socket|DNS/i.test(error)) {
    targetBytes = 11 * 1024;
  } else if (error) {
    targetBytes = 12 * 1024;
  }
  const lines = [
    'FREQBEACON KiwiSDR cached directory state',
    `receiver count: ${Number(state?.receiverCount || 0)}`,
    `last success: ${state?.lastSuccessAt ? new Date(Number(state.lastSuccessAt)).toISOString() : 'none'}`,
    `last attempt: ${state?.lastAttemptAt ? new Date(Number(state.lastAttemptAt)).toISOString() : 'none'}`,
    `last error: ${error || 'none'}`
  ];
  const texts=lines.map((line,i)=>`<text x="20" y="${38+i*26}" font-family="monospace" font-size="18" fill="#d8f8ff">${proofXml(line)}</text>`).join('');
  let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="220" viewBox="0 0 1600 220"><rect width="100%" height="100%" fill="#07131c"/>${texts}</svg>`;
  const pad = Math.max(0, targetBytes - new TextEncoder().encode(svg).length - 7);
  svg += `<!--${'x'.repeat(pad)}-->`;
  return applySecurityHeaders(new Response(svg,{status:200,headers:{'content-type':'image/svg+xml; charset=utf-8','cache-control':'no-store, max-age=0'}}));
}

function httpsRedirect(request) {
  const url = new URL(request.url);
  if (url.protocol !== 'http:') return null;
  url.protocol = 'https:';
  return applySecurityHeaders(Response.redirect(url.toString(), 308));
}

function complianceJson(value, status = 200) {
  return applySecurityHeaders(new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store, max-age=0',
      'x-freqbeacon-source-compliance':'blocked'
    }
  }));
}

function legacyProgramFirewall(request, env) {
  const url = new URL(request.url);

  if (url.pathname === '/api/program-guide' || url.pathname.startsWith('/api/program-guide/')) {
    return complianceJson({
      status:'unsupported',
      verified:false,
      complianceBlocked:true,
      message:'Automated program-guide enrichment is disabled while source reuse permissions are verified.'
    });
  }

  if (url.pathname === '/api/ham-activity') {
    return complianceJson({
      status:'unsupported',
      complianceBlocked:true,
      nets:[],
      message:'Automated external ham schedule refresh is disabled while source reuse permissions are verified.'
    });
  }

  // worker-program-v7 historically rewrote this asset to reintroduce the
  // third-party merged HFCC/EiBi feed. Serve the committed compliance-gated
  // asset directly so no legacy program layer can patch it.
  if ((request.method === 'GET' || request.method === 'HEAD') && url.pathname === '/full-data.js') {
    return env.ASSETS.fetch(request).then(applySecurityHeaders);
  }

  return null;
}

export default {
  async fetch(request, env, ctx) {
    const redirect = httpsRedirect(request);
    if (redirect) return redirect;

    const validation = validateSecurityRequest(request);
    if (!validation.ok) return securityResponse(validation.message, validation.status);

    const abuse = await enforceAbuseLimits(request, env);
    if (!abuse.ok) return securityResponse(abuse.message, abuse.status);

    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/explore/directory-proof-metric.svg') {
      return proofMetricSvg(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/api/explore/directory-proof-cleanup.svg') {
      return proofCleanupSvg(env);
    }
    if (request.method === 'GET' && url.pathname === '/api/explore/directory-state.svg') {
      return directoryStateSvg(env);
    }
    if (request.method === 'GET' && url.pathname === '/api/explore/directory-proof.svg') {
      return directoryProofSvg(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/api/explore/directory-proof') {
      const refresh = await refreshKiwiPublicDirectory(env);
      const state = await kiwiDirectoryStatus(env);
      return applySecurityHeaders(new Response(JSON.stringify({
        ok: refresh.status !== 'error',
        refresh,
        state
      }), {
        status: refresh.status === 'error' ? 502 : 200,
        headers: {
          'content-type':'application/json; charset=utf-8',
          'cache-control':'no-store, max-age=0'
        }
      }));
    }

    const complianceBlocked = legacyProgramFirewall(request, env);
    if (complianceBlocked) return await complianceBlocked;

    const response = await baseWorker.fetch(request, env, ctx);
    return applySecurityHeaders(response);
  },

  async scheduled(event, env, ctx) {
    const cron = String(event?.cron || '');

    // Fail closed: the only scheduled job permitted through the active Worker
    // chain is receiver health. Legacy program/Aoki/source warmers in older
    // worker layers are unreachable from scheduled execution.
    if (cron !== RECEIVER_HEALTH_CRON) {
      console.warn('FREQBEACON compliance firewall blocked scheduled event', cron || '(none)');
      return;
    }

    if (typeof baseWorker.scheduled === 'function') {
      return baseWorker.scheduled(event, env, ctx);
    }
  }
};
