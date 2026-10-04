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
