import baseWorker from './worker-program-v21.js';
import {
  applySecurityHeaders,
  enforceAbuseLimits,
  securityResponse,
  validateSecurityRequest
} from './security-hardening.js';

const RECEIVER_HEALTH_CRON = '* * * * *';

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
