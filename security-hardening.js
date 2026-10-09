const RECEIVER_ID_RE = /^[A-Za-z0-9._:[\]-]{1,180}$/;
const SDR_STREAMS = new Set(['SND', 'W/F']);
const CSP = [
  "default-src 'self' https: data: blob:",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https:",
  "connect-src 'self' https: wss:",
  "media-src 'self' data: blob: https:",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'"
].join('; ');

function verdict(ok, status = 200, message = '') {
  return { ok, status, message };
}

function methodAllowed(method, allowed) {
  return allowed.includes(String(method || 'GET').toUpperCase());
}

function presentNumber(url, name, min, max) {
  if (!url.searchParams.has(name)) return true;
  const raw = url.searchParams.get(name);
  if (raw == null || raw.length > 32 || raw.trim() === '') return false;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max;
}

function selectedReceiverPreference(request) {
  const cookie = String(request.headers.get('cookie') || '');
  const match = cookie.match(/(?:^|;\s*)fb_explore_receiver=([^;]+)/);
  if (!match) return '';
  try {
    const value = decodeURIComponent(match[1]);
    return value.length <= 180 && RECEIVER_ID_RE.test(value) ? value : '';
  } catch {
    return '';
  }
}

export function validateSecurityRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = String(request.method || 'GET').toUpperCase();

  if (!path.startsWith('/api/')) return verdict(true);

  if (path === '/api/sdr/probe') {
    return verdict(false, 404, 'Not found');
  }

  if (path === '/api/program-guide/health') {
    return verdict(false, 404, 'Not found');
  }

  if (path === '/api/sdr/ws') {
    if (!methodAllowed(method, ['GET'])) return verdict(false, 405, 'Method not allowed');
    if (String(request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') {
      return verdict(false, 426, 'WebSocket upgrade required');
    }
    const receiverId = url.searchParams.get('receiver') || '';
    const stream = url.searchParams.get('stream') || '';
    const timestamp = url.searchParams.get('ts') || '';
    if (!RECEIVER_ID_RE.test(receiverId)) return verdict(false, 400, 'Invalid receiver');
    if (!SDR_STREAMS.has(stream)) return verdict(false, 400, 'Invalid stream');
    if (!/^\d{1,10}$/.test(timestamp)) return verdict(false, 400, 'Invalid timestamp');
    return verdict(true);
  }

  if (path === '/api/sdr/receivers') {
    if (!methodAllowed(method, ['GET', 'HEAD'])) return verdict(false, 405, 'Method not allowed');
    const frequency = url.searchParams.get('frequency');
    if (frequency == null || frequency.length > 32) return verdict(false, 400, 'Invalid frequency');
    const value = Number(frequency);
    if (!Number.isFinite(value) || value < 10 || value > 30000) return verdict(false, 400, 'Invalid frequency');
    if (!presentNumber(url, 'lat', -90, 90) || !presentNumber(url, 'lon', -180, 180)
      || !presentNumber(url, 'txLat', -90, 90) || !presentNumber(url, 'txLon', -180, 180)) {
      return verdict(false, 400, 'Invalid coordinates');
    }
    return verdict(true);
  }

  if (path === '/api/zero/ws' || path === '/api/zero-bench/ws') {
    if (!methodAllowed(method, ['GET'])) return verdict(false, 405, 'Method not allowed');
    if (String(request.headers.get('upgrade') || '').toLowerCase() !== 'websocket') {
      return verdict(false, 426, 'WebSocket upgrade required');
    }
    const stream = url.searchParams.get('stream') || '';
    const timestamp = url.searchParams.get('ts') || '';
    if (!SDR_STREAMS.has(stream)) return verdict(false, 400, 'Invalid stream');
    if (!/^\d{8,20}$/.test(timestamp)) return verdict(false, 400, 'Invalid timestamp');
    return verdict(true);
  }

  if (
    path === '/api/zero/bootstrap'
    || path === '/api/zero/diagnostics'
    || path === '/api/zero-bench/bootstrap'
    || path === '/api/zero-bench/diagnostics'
  ) {
    return methodAllowed(method, ['GET'])
      ? verdict(true)
      : verdict(false, 405, 'Method not allowed');
  }

  if (path === '/api/explore/live-failure') {
    if (!methodAllowed(method, ['POST'])) return verdict(false, 405, 'Method not allowed');
    const declaredLength = request.headers.get('content-length');
    const length = declaredLength === null ? null : Number(declaredLength);
    if (length !== null && (!Number.isSafeInteger(length) || length < 0 || length > 2048)) {
      return verdict(false, 413, 'Request too large');
    }
    const contentType = String(request.headers.get('content-type') || '').toLowerCase();
    if (!/^application\/json(?:\s*;|\s*$)/.test(contentType)) {
      return verdict(false, 415, 'JSON required');
    }
    const rawCookie = String(request.headers.get('cookie') || '');
    if (/fb_explore_receiver=/.test(rawCookie) && !selectedReceiverPreference(request)) {
      return verdict(false, 400, 'Invalid receiver preference');
    }
    return verdict(true);
  }

  if (path === '/api/explore/recommendation') {
    if (!methodAllowed(method, ['GET', 'HEAD'])) return verdict(false, 405, 'Method not allowed');
    const previousId = url.searchParams.get('previousId');
    if (previousId && !RECEIVER_ID_RE.test(previousId)) return verdict(false, 400, 'Invalid receiver');
    if (!presentNumber(url, 'lat', -90, 90) || !presentNumber(url, 'lon', -180, 180)) {
      return verdict(false, 400, 'Invalid coordinates');
    }
    return verdict(true);
  }

  if (path === '/api/explore/receivers' || path === '/api/explore/status') {
    return methodAllowed(method, ['GET', 'HEAD'])
      ? verdict(true)
      : verdict(false, 405, 'Method not allowed');
  }

  if (path === '/api/ham-activity') {
    if (!methodAllowed(method, ['GET', 'HEAD'])) return verdict(false, 405, 'Method not allowed');
    if (url.searchParams.has('refresh')) return verdict(false, 400, 'Manual refresh is not public');
    return verdict(true);
  }

  if (path === '/api/program-guide') {
    if (!methodAllowed(method, ['GET', 'HEAD'])) return verdict(false, 405, 'Method not allowed');
    const station = String(url.searchParams.get('station') || '');
    const frequency = String(url.searchParams.get('frequency') || '');
    const at = String(url.searchParams.get('at') || '');
    const tz = String(url.searchParams.get('tz') || '');
    if (!station || station.length > 160) return verdict(false, 400, 'Invalid station');
    if (!frequency || frequency.length > 32) return verdict(false, 400, 'Invalid frequency');
    const numericFrequency = Number(frequency);
    if (!Number.isFinite(numericFrequency) || numericFrequency < 100 || numericFrequency > 30000) {
      return verdict(false, 400, 'Invalid frequency');
    }
    if (at.length > 64 || (at && Number.isNaN(new Date(at).getTime()))) return verdict(false, 400, 'Invalid timestamp');
    if (tz.length > 80) return verdict(false, 400, 'Invalid time zone');
    return verdict(true);
  }

  // No legacy/new API route may silently inherit permissive access.
  return verdict(false, 404, 'Not found');
}

function clientIdentity(request) {
  const ip = String(request.headers.get('cf-connecting-ip') || '').trim();
  return ip && ip.length <= 64 ? ip : 'unknown-client';
}

function sessionIdentity(request) {
  const url = new URL(request.url);
  const receiver = url.searchParams.get('receiver') || selectedReceiverPreference(request) || 'fixed-zero';
  // Timestamp is caller controlled and changes across legitimate reconnects.
  // Including it would create a fresh limiter key on every retry.
  return `${clientIdentity(request)}|${url.pathname}|${receiver}`;
}

async function checkLimiter(binding, key) {
  if (!binding || typeof binding.limit !== 'function') return { success: false, unavailable: true };
  try {
    const result = await binding.limit({ key });
    return { success: Boolean(result?.success), unavailable: false };
  } catch {
    return { success: false, unavailable: true };
  }
}

export async function enforceAbuseLimits(request, env) {
  const path = new URL(request.url).pathname;
  const isSocket = path === '/api/sdr/ws' || path === '/api/zero/ws' || path === '/api/zero-bench/ws';
  const isExplore = path === '/api/explore/receivers'
    || path === '/api/explore/status'
    || path === '/api/explore/recommendation'
    || path === '/api/explore/live-failure';
  const isControl = path === '/api/sdr/receivers'
    || path === '/api/zero/bootstrap'
    || path === '/api/zero/diagnostics'
    || path === '/api/zero-bench/bootstrap'
    || path === '/api/zero-bench/diagnostics';

  if (!isSocket && !isControl && !isExplore) return verdict(true);

  // This bucket covers every public Explore API call as one budget, not a
  // different budget per endpoint. Fail closed before any D1/upstream work.
  if (isExplore) {
    const explore = await checkLimiter(env?.EXPLORE_API_RATE_LIMITER, `explore|${clientIdentity(request)}`);
    if (explore.unavailable) return verdict(false, 503, 'Explore protection unavailable');
    if (!explore.success) return verdict(false, 429, 'Too many Explore requests');
  }

  if (isSocket) {
    const client = await checkLimiter(env?.SDR_CLIENT_RATE_LIMITER, `socket|${clientIdentity(request)}`);
    if (client.unavailable) return verdict(false, 503, 'SDR protection unavailable');
    if (!client.success) return verdict(false, 429, 'Too many receiver connection attempts');

    const session = await checkLimiter(env?.SDR_SESSION_RATE_LIMITER, `session|${sessionIdentity(request)}`);
    if (session.unavailable) return verdict(false, 503, 'SDR protection unavailable');
    if (!session.success) return verdict(false, 429, 'Too many connection attempts for this receiver session');
  }

  if (isControl) {
    const control = await checkLimiter(env?.SDR_CONTROL_RATE_LIMITER, `control|${clientIdentity(request)}`);
    if (control.unavailable) return verdict(false, 503, 'SDR protection unavailable');
    if (!control.success) return verdict(false, 429, 'Too many SDR control requests');
  }

  return verdict(true);
}

export function securityResponse(message, status) {
  return applySecurityHeaders(new Response(message, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store, max-age=0'
    }
  }));
}

export function applySecurityHeaders(response) {
  if (!response || response.status === 101 || response.webSocket) return response;
  const headers = new Headers(response.headers);
  headers.set('content-security-policy', CSP);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-freqbeacon-security-policy', 'api-cost-guard-v1');
  headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('permissions-policy', 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()');
  headers.set('x-frame-options', 'DENY');
  headers.set('strict-transport-security', 'max-age=31536000');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function receiverPreferenceFromRequest(request) {
  return selectedReceiverPreference(request);
}
