import baseWorker from './worker-program-v21.js';
import {
  SECURITY_HEADERS,
  createWindowLimiter,
  validateProgramGuideUrl,
  validateSdrSocketUrl,
  validateZeroSocketUrl
} from './security-policy.js';

const limiter = createWindowLimiter();

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

function methodAllowed(request, methods) {
  return methods.includes(request.method);
}

function clientKey(request) {
  const raw = String(request.headers.get('CF-Connecting-IP') || 'anonymous').slice(0, 80);
  return raw.replace(/[^A-Za-z0-9:._-]/g, '_') || 'anonymous';
}

function rateResponse(result) {
  return json(
    { error: 'Too many requests; retry shortly.' },
    429,
    { 'retry-after': String(result.retryAfterSeconds || 1) }
  );
}

function consume(request, bucket, limit, windowMs) {
  return limiter.allow(`${clientKey(request)}|${bucket}`, limit, windowMs);
}

function guardApiRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  // The old public probe opens a real upstream Kiwi WebSocket and is not needed
  // by normal listening. Keep it unavailable at the outermost production layer.
  if (path === '/api/sdr/probe') {
    return json({ error: 'Not found' }, 404);
  }

  if (path === '/api/sdr/ws') {
    if (!methodAllowed(request, ['GET'])) return json({ error: 'Method not allowed' }, 405);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    const validated = validateSdrSocketUrl(url);
    if (!validated.ok) return json({ error: validated.error }, 400);

    const clientBudget = consume(request, 'sdr-ws-open', 30, 60_000);
    if (!clientBudget.allowed) return rateResponse(clientBudget);
    const sessionBudget = consume(
      request,
      `sdr-session|${validated.receiverId}|${validated.ts}`,
      6,
      30_000
    );
    if (!sessionBudget.allowed) return rateResponse(sessionBudget);
    return null;
  }

  if (path === '/api/zero/ws' || path === '/api/zero-bench/ws') {
    if (!methodAllowed(request, ['GET'])) return json({ error: 'Method not allowed' }, 405);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WEBSOCKET REQUIRED', { status: 426 });
    }
    const validated = validateZeroSocketUrl(url);
    if (!validated.ok) return json({ error: validated.error }, 400);

    const clientBudget = consume(request, 'zero-ws-open', 30, 60_000);
    if (!clientBudget.allowed) return rateResponse(clientBudget);
    const sessionBudget = consume(request, `zero-session|${validated.ts}`, 6, 30_000);
    if (!sessionBudget.allowed) return rateResponse(sessionBudget);
    return null;
  }

  if (
    path === '/api/zero/bootstrap'
    || path === '/api/zero-bench/bootstrap'
    || path === '/api/zero/diagnostics'
    || path === '/api/zero-bench/diagnostics'
  ) {
    if (!methodAllowed(request, ['GET'])) return json({ error: 'Method not allowed' }, 405);
    const isDiagnostics = path.endsWith('/diagnostics');
    const budget = consume(request, isDiagnostics ? 'zero-diagnostics' : 'zero-bootstrap', isDiagnostics ? 8 : 30, 60_000);
    if (!budget.allowed) return rateResponse(budget);
    return null;
  }

  if (path === '/api/explore/live-failure') {
    if (!methodAllowed(request, ['POST'])) return json({ error: 'Method not allowed' }, 405);
    const budget = consume(request, 'explore-live-failure', 60, 60_000);
    if (!budget.allowed) return rateResponse(budget);
    return null;
  }

  if (
    path === '/api/explore/receivers'
    || path === '/api/explore/status'
    || path === '/api/explore/recommendation'
    || path === '/api/sdr/receivers'
  ) {
    if (!methodAllowed(request, ['GET', 'HEAD'])) return json({ error: 'Method not allowed' }, 405);
    if (path === '/api/explore/recommendation') {
      const previousId = url.searchParams.get('previousId');
      const lat = url.searchParams.get('lat');
      const lon = url.searchParams.get('lon');
      if (previousId && !/^[A-Za-z0-9._:[\\]-]{1,180}$/.test(previousId)) return json({ error: 'Invalid receiver ID' }, 400);
      if (lat != null && (!Number.isFinite(Number(lat)) || Number(lat) < -90 || Number(lat) > 90)) return json({ error: 'Invalid latitude' }, 400);
      if (lon != null && (!Number.isFinite(Number(lon)) || Number(lon) < -180 || Number(lon) > 180)) return json({ error: 'Invalid longitude' }, 400);
    }
    return null;
  }

  if (path === '/api/program-guide') {
    if (!methodAllowed(request, ['GET', 'HEAD'])) return json({ error: 'Method not allowed' }, 405);
    if (!validateProgramGuideUrl(url)) return json({ error: 'Invalid program-guide request' }, 400);
    const budget = consume(request, 'program-guide', 120, 60_000);
    if (!budget.allowed) return rateResponse(budget);
    return null;
  }

  if (path.startsWith('/api/program-guide/') || path === '/api/ham-activity') {
    if (!methodAllowed(request, ['GET', 'HEAD'])) return json({ error: 'Method not allowed' }, 405);
  }

  return null;
}

function addSecurityHeaders(request, response) {
  if (!response || response.status === 101 || response.webSocket) return response;

  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  if (new URL(request.url).protocol === 'https:') {
    headers.set('Strict-Transport-Security', 'max-age=31536000');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const guarded = guardApiRequest(request);
    if (guarded) return addSecurityHeaders(request, guarded);

    const response = await baseWorker.fetch(request, env, ctx);
    return addSecurityHeaders(request, response);
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(event, env, ctx);
    return undefined;
  }
};
