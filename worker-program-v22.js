import baseWorker from './worker-program-v21.js';
import {
  applySecurityHeaders,
  enforceAbuseLimits,
  securityResponse,
  validateSecurityRequest
} from './security-hardening.js';

function httpsRedirect(request) {
  const url = new URL(request.url);
  if (url.protocol !== 'http:') return null;
  url.protocol = 'https:';
  return applySecurityHeaders(Response.redirect(url.toString(), 308));
}

export default {
  async fetch(request, env, ctx) {
    const redirect = httpsRedirect(request);
    if (redirect) return redirect;

    const validation = validateSecurityRequest(request);
    if (!validation.ok) return securityResponse(validation.message, validation.status);

    const abuse = await enforceAbuseLimits(request, env);
    if (!abuse.ok) return securityResponse(abuse.message, abuse.status);

    const response = await baseWorker.fetch(request, env, ctx);
    return applySecurityHeaders(response);
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') {
      return baseWorker.scheduled(event, env, ctx);
    }
  }
};
