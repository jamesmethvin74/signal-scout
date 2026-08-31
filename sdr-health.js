(() => {
  if (window.__freqbeaconReceiverHealth) return;

  const HEALTH_KEY = 'signalScout:sdrHealth:v2';
  const LEGACY_HEALTH_KEY = 'signalScout:sdrHealth:v1';
  const HEALTH_RETENTION_MS = 48 * 60 * 60 * 1000;
  const RECENT_SUCCESS_MS = 45 * 60 * 1000;
  const MAX_FAILURES = 6;

  function now() {
    return Date.now();
  }

  function readRaw(key) {
    try {
      const parsed = JSON.parse(window.localStorage?.getItem(key) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function prune(health, timestamp = now()) {
    const cutoff = timestamp - HEALTH_RETENTION_MS;
    const clean = {};
    for (const [id, entry] of Object.entries(health || {})) {
      if (!entry || typeof entry !== 'object') continue;
      const freshest = Math.max(Number(entry.lastSuccess || 0), Number(entry.lastFailure || 0));
      if (freshest && freshest < cutoff) continue;
      clean[id] = entry;
    }
    return clean;
  }

  function load() {
    const current = readRaw(HEALTH_KEY);
    if (Object.keys(current).length) return prune(current);

    // One-time compatibility with health evidence accumulated by the previous
    // runtime. No fetch or WebSocket monkey-patching is restored.
    const legacy = prune(readRaw(LEGACY_HEALTH_KEY));
    if (Object.keys(legacy).length) save(legacy);
    return legacy;
  }

  function save(health) {
    try {
      window.localStorage?.setItem(HEALTH_KEY, JSON.stringify(prune(health)));
    } catch {
      // Connection health is an optimization. Listening must not depend on
      // localStorage being available.
    }
  }

  function cooldownMinutes(reason, failures) {
    if (reason === 'busy') return Math.min(10, Math.max(2, failures * 2));
    if (reason === 'offline') return 30;
    if (reason === 'refused') return Math.min(30, 6 + failures * 4);
    if (reason === 'timeout') return Math.min(30, Math.round(7 * Math.pow(1.55, Math.max(0, failures - 1))));
    return Math.min(25, Math.round(5 * Math.pow(1.5, Math.max(0, failures - 1))));
  }

  function get(receiverId) {
    if (!receiverId) return {};
    return load()[receiverId] || {};
  }

  function markFailure(receiverId, reason = 'error', detail = '') {
    if (!receiverId) return null;
    const health = load();
    const previous = health[receiverId] || {};
    const failures = Math.min(MAX_FAILURES, Math.max(0, Number(previous.failures || 0)) + 1);
    const timestamp = now();
    const entry = {
      ...previous,
      failures,
      lastFailure: timestamp,
      lastFailureReason: String(reason || 'error'),
      lastFailureDetail: String(detail || '').slice(0, 180),
      cooldownUntil: timestamp + cooldownMinutes(reason, failures) * 60 * 1000
    };
    health[receiverId] = entry;
    save(health);
    return entry;
  }

  function markSuccess(receiverId) {
    if (!receiverId) return null;
    const health = load();
    const previous = health[receiverId] || {};
    const entry = {
      ...previous,
      failures: 0,
      cooldownUntil: 0,
      lastSuccess: now(),
      successes: Math.min(500, Math.max(0, Number(previous.successes || 0)) + 1)
    };
    health[receiverId] = entry;
    save(health);
    return entry;
  }

  function state(receiverId, timestamp = now()) {
    const entry = get(receiverId);
    return {
      entry,
      cooling: Number(entry.cooldownUntil || 0) > timestamp,
      recentSuccess: Number(entry.lastSuccess || 0) > timestamp - RECENT_SUCCESS_MS,
      failures: Math.max(0, Number(entry.failures || 0)),
      cooldownUntil: Number(entry.cooldownUntil || 0),
      lastSuccess: Number(entry.lastSuccess || 0),
      lastFailure: Number(entry.lastFailure || 0),
      lastFailureReason: String(entry.lastFailureReason || '')
    };
  }

  function snapshot() {
    return load();
  }

  function clear(receiverId) {
    const health = load();
    if (receiverId) delete health[receiverId];
    else Object.keys(health).forEach((id) => delete health[id]);
    save(health);
  }

  window.__freqbeaconReceiverHealth = Object.freeze({
    version: 'receiver-health-v2-source',
    key: HEALTH_KEY,
    recentSuccessMs: RECENT_SUCCESS_MS,
    get,
    state,
    snapshot,
    markFailure,
    markSuccess,
    clear
  });
})();
