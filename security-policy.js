export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss:",
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'"
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=()',
  'X-Frame-Options': 'DENY'
});

const RECEIVER_ID_RE = /^[A-Za-z0-9._:[\\]-]{1,180}$/;

export function validReceiverId(value) {
  return RECEIVER_ID_RE.test(String(value || ''));
}

export function validateSdrSocketUrl(url) {
  const receiverId = url.searchParams.get('receiver') || '';
  const stream = url.searchParams.get('stream') || 'SND';
  const ts = url.searchParams.get('ts') || '';
  if (!validReceiverId(receiverId)) return { ok: false, error: 'Invalid receiver ID' };
  if (!['SND', 'W/F'].includes(stream)) return { ok: false, error: 'Invalid SDR stream' };
  if (!/^\\d{1,10}$/.test(ts)) return { ok: false, error: 'Invalid SDR session timestamp' };
  return { ok: true, receiverId, stream, ts };
}

export function validateZeroSocketUrl(url) {
  const stream = url.searchParams.get('stream') || '';
  const ts = url.searchParams.get('ts') || '';
  if (!['SND', 'W/F'].includes(stream)) return { ok: false, error: 'Invalid Zero stream' };
  if (!/^\\d{8,20}$/.test(ts)) return { ok: false, error: 'Invalid Zero session timestamp' };
  return { ok: true, stream, ts };
}

export function validateProgramGuideUrl(url) {
  const station = String(url.searchParams.get('station') || '');
  const language = String(url.searchParams.get('language') || '');
  const tz = String(url.searchParams.get('tz') || '');
  const at = String(url.searchParams.get('at') || '');
  const frequencyRaw = url.searchParams.get('frequency');
  if (station.length > 160 || language.length > 80 || tz.length > 96 || at.length > 80) return false;
  if (frequencyRaw != null) {
    const frequency = Number(frequencyRaw);
    if (!Number.isFinite(frequency) || frequency < 100 || frequency > 30000) return false;
  }
  if (at && Number.isNaN(new Date(at).getTime())) return false;
  if (tz) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date()); }
    catch { return false; }
  }
  return true;
}

export function createWindowLimiter(maxEntries = 4096) {
  const windows = new Map();

  function prune(now) {
    if (windows.size <= maxEntries) return;
    const ordered = [...windows.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (const [key, item] of ordered) {
      if (windows.size <= Math.floor(maxEntries * 0.8)) break;
      if (item.expiresAt <= now || windows.size > maxEntries) windows.delete(key);
    }
  }

  return {
    allow(key, limit, windowMs, now = Date.now()) {
      const safeLimit = Math.max(1, Math.floor(Number(limit) || 1));
      const safeWindow = Math.max(1000, Math.floor(Number(windowMs) || 1000));
      let current = windows.get(key);
      if (!current || current.expiresAt <= now) {
        current = { count: 0, expiresAt: now + safeWindow };
        windows.set(key, current);
      }
      if (current.count >= safeLimit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((current.expiresAt - now) / 1000))
        };
      }
      current.count += 1;
      prune(now);
      return {
        allowed: true,
        remaining: Math.max(0, safeLimit - current.count),
        retryAfterSeconds: 0
      };
    },
    size() {
      return windows.size;
    }
  };
}
