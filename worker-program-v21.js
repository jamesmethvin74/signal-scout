import baseWorker from './worker-program-v20.js';
import {
  createWindowLimiter,
  validReceiverId,
  validateProgramGuideUrl,
  validateSdrSocketUrl,
  validateZeroSocketUrl
} from './security-policy.js';

const RECOMMENDATION_PATH = '/api/explore/recommendation';
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

function finiteCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function recommendationRequest(request) {
  const url = new URL(request.url);
  if (url.pathname !== RECOMMENDATION_PATH || (request.method !== 'GET' && request.method !== 'HEAD')) return request;
  if (url.searchParams.has('lat') && url.searchParams.has('lon')) return request;

  const lat = finiteCoordinate(request.cf?.latitude, -90, 90);
  const lon = finiteCoordinate(request.cf?.longitude, -180, 180);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return request;

  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  return new Request(url.toString(), request);
}

function clientKey(request) {
  const raw = String(request.headers.get('CF-Connecting-IP') || 'anonymous').slice(0, 80);
  return raw.replace(/[^A-Za-z0-9:._-]/g, '_') || 'anonymous';
}

function consume(request, bucket, limit, windowMs) {
  return limiter.allow(`${clientKey(request)}|${bucket}`, limit, windowMs);
}

function rateResponse(result) {
  return json({ error: 'Too many requests; retry shortly.' }, 429, {
    'retry-after': String(result.retryAfterSeconds || 1)
  });
}

function validOptionalCoordinate(url, name, min, max) {
  if (!url.searchParams.has(name)) return true;
  return finiteCoordinate(url.searchParams.get(name), min, max) != null;
}

function guardApiRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/api/sdr/probe') return json({ error: 'Not found' }, 404);

  if (path === '/api/sdr/ws') {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }
    const validated = validateSdrSocketUrl(url);
    if (!validated.ok) return json({ error: validated.error }, 400);
    const clientBudget = consume(request, 'sdr-ws-open', 30, 60000);
    if (!clientBudget.allowed) return rateResponse(clientBudget);
    const sessionBudget = consume(request, `sdr-session|${validated.receiverId}|${validated.ts}`, 6, 30000);
    if (!sessionBudget.allowed) return rateResponse(sessionBudget);
    return null;
  }

  if (path === '/api/zero/ws' || path === '/api/zero-bench/ws') {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WEBSOCKET REQUIRED', { status: 426 });
    }
    const validated = validateZeroSocketUrl(url);
    if (!validated.ok) return json({ error: validated.error }, 400);
    const clientBudget = consume(request, 'zero-ws-open', 30, 60000);
    if (!clientBudget.allowed) return rateResponse(clientBudget);
    const sessionBudget = consume(request, `zero-session|${validated.ts}`, 6, 30000);
    if (!sessionBudget.allowed) return rateResponse(sessionBudget);
    return null;
  }

  if (
    path === '/api/zero/bootstrap'
    || path === '/api/zero-bench/bootstrap'
    || path === '/api/zero/diagnostics'
    || path === '/api/zero-bench/diagnostics'
  ) {
    if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
    const diagnostics = path.endsWith('/diagnostics');
    const budget = consume(request, diagnostics ? 'zero-diagnostics' : 'zero-bootstrap', diagnostics ? 8 : 30, 60000);
    if (!budget.allowed) return rateResponse(budget);
    return null;
  }

  if (path === '/api/explore/live-failure') {
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    const budget = consume(request, 'explore-live-failure', 60, 60000);
    return budget.allowed ? null : rateResponse(budget);
  }

  if (path === RECOMMENDATION_PATH) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed' }, 405);
    const previousId = url.searchParams.get('previousId');
    if (previousId && !validReceiverId(previousId)) return json({ error: 'Invalid receiver ID' }, 400);
    if (!validOptionalCoordinate(url, 'lat', -90, 90)) return json({ error: 'Invalid latitude' }, 400);
    if (!validOptionalCoordinate(url, 'lon', -180, 180)) return json({ error: 'Invalid longitude' }, 400);
    return null;
  }

  if (path === '/api/explore/receivers' || path === '/api/explore/status') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed' }, 405);
    return null;
  }

  if (path === '/api/sdr/receivers') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed' }, 405);
    const frequency = Number(url.searchParams.get('frequency'));
    if (!Number.isFinite(frequency) || frequency < 10 || frequency > 30000) return json({ error: 'Invalid SDR frequency' }, 400);
    if (!validOptionalCoordinate(url, 'lat', -90, 90) || !validOptionalCoordinate(url, 'txLat', -90, 90)) return json({ error: 'Invalid latitude' }, 400);
    if (!validOptionalCoordinate(url, 'lon', -180, 180) || !validOptionalCoordinate(url, 'txLon', -180, 180)) return json({ error: 'Invalid longitude' }, 400);
    return null;
  }

  if (path === '/api/program-guide') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed' }, 405);
    if (!validateProgramGuideUrl(url)) return json({ error: 'Invalid program-guide request' }, 400);
    const budget = consume(request, 'program-guide', 120, 60000);
    return budget.allowed ? null : rateResponse(budget);
  }

  if (path === '/api/program-guide/health' || path === '/api/ham-activity') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Method not allowed' }, 405);
    const refresh = url.searchParams.get('refresh');
    if (refresh != null && refresh !== '0' && refresh !== '1') return json({ error: 'Invalid refresh value' }, 400);
  }

  return null;
}

export default {
  async fetch(request, env, ctx) {
    const effectiveRequest = recommendationRequest(request);
    const guarded = guardApiRequest(effectiveRequest);
    if (guarded) return guarded;
    return baseWorker.fetch(effectiveRequest, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(event, env, ctx);
    return undefined;
  }
};
