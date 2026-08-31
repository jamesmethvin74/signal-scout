(() => {
  const HEALTH_KEY = 'signalScout:sdrHealth:v1';
  const HEALTH_RETENTION_MS = 24 * 60 * 60 * 1000;
  const RECENT_SUCCESS_MS = 45 * 60 * 1000;
  const NativeFetch = window.fetch.bind(window);
  const NativeWebSocket = window.WebSocket;
  const decoder = new TextDecoder();

  function now() {
    return Date.now();
  }

  function loadHealth() {
    try {
      const parsed = JSON.parse(window.localStorage?.getItem(HEALTH_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const cutoff = now() - HEALTH_RETENTION_MS;
      const clean = {};
      for (const [id, entry] of Object.entries(parsed)) {
        if (!entry || typeof entry !== 'object') continue;
        const freshest = Math.max(Number(entry.lastSuccess || 0), Number(entry.lastFailure || 0));
        if (freshest && freshest < cutoff) continue;
        clean[id] = entry;
      }
      return clean;
    } catch {
      return {};
    }
  }

  function saveHealth(health) {
    try {
      window.localStorage?.setItem(HEALTH_KEY, JSON.stringify(health));
    } catch {
      // Health memory is an optimization only. SDR listening still works if
      // storage is unavailable or full.
    }
  }

  function failureMinutes(reason, failures) {
    if (reason === 'busy') return Math.min(8, 2 * failures);
    if (reason === 'offline') return 30;
    return Math.min(30, 5 * failures);
  }

  function markFailure(receiverId, reason = 'error') {
    if (!receiverId) return;
    const health = loadHealth();
    const previous = health[receiverId] || {};
    const failures = Math.min(5, Number(previous.failures || 0) + 1);
    const timestamp = now();
    health[receiverId] = {
      ...previous,
      failures,
      lastFailure: timestamp,
      lastFailureReason: reason,
      cooldownUntil: timestamp + failureMinutes(reason, failures) * 60 * 1000
    };
    saveHealth(health);
  }

  function markSuccess(receiverId) {
    if (!receiverId) return;
    const health = loadHealth();
    const previous = health[receiverId] || {};
    health[receiverId] = {
      ...previous,
      failures: 0,
      cooldownUntil: 0,
      lastSuccess: now(),
      successes: Math.min(100, Number(previous.successes || 0) + 1)
    };
    saveHealth(health);
  }

  function healthRank(receiver, index, health, timestamp) {
    const entry = health[receiver?.id] || {};
    const cooling = Number(entry.cooldownUntil || 0) > timestamp;
    const recentSuccess = Number(entry.lastSuccess || 0) > timestamp - RECENT_SUCCESS_MS;

    let score = index;
    if (cooling) score += 1000 + Number(entry.failures || 0) * 20;
    else if (recentSuccess) score -= 0.35;
    return { score, cooling, recentSuccess, entry };
  }

  function applyHealthToRecommendations(receivers) {
    if (!Array.isArray(receivers) || receivers.length < 2) return receivers;
    const health = loadHealth();
    const timestamp = now();
    const ranked = receivers.map((receiver, index) => ({
      receiver: { ...receiver },
      index,
      health: healthRank(receiver, index, health, timestamp)
    }));

    ranked.sort((a, b) => a.health.score - b.health.score || a.index - b.index);

    const preferred = ranked.find((item) => !item.health.cooling) || ranked[0];
    return ranked.map((item) => {
      const receiver = item.receiver;
      receiver.recommended = item === preferred;
      receiver.connectionHealth = item.health.cooling
        ? 'cooldown'
        : (item.health.recentSuccess ? 'recent-success' : 'unknown');
      if (item === preferred && item.index > 0) {
        receiver.reason = `${receiver.reason || 'Useful receiver for this frequency.'} Preferred now because a higher-ranked receiver reported that it was unavailable.`;
      }
      return receiver;
    });
  }

  function requestUrl(input) {
    try {
      if (typeof input === 'string') return new URL(input, window.location.href);
      if (input instanceof URL) return new URL(input.toString(), window.location.href);
      if (input?.url) return new URL(input.url, window.location.href);
    } catch {
      return null;
    }
    return null;
  }

  window.fetch = async (...args) => {
    const response = await NativeFetch(...args);
    const url = requestUrl(args[0]);
    if (!url || url.origin !== window.location.origin || url.pathname !== '/api/sdr/receivers') return response;

    try {
      const payload = await response.clone().json();
      if (!Array.isArray(payload?.receivers) || !payload.receivers.length) return response;
      const adjusted = {
        ...payload,
        receivers: applyHealthToRecommendations(payload.receivers)
      };
      const headers = new Headers(response.headers);
      headers.set('content-type', 'application/json; charset=utf-8');
      headers.set('cache-control', 'private, max-age=0, no-store');
      return new Response(JSON.stringify(adjusted), {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch {
      return response;
    }
  };

  function sdrReceiverId(rawUrl) {
    try {
      const url = new URL(String(rawUrl), window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== '/api/sdr/ws') return null;
      return url.searchParams.get('receiver') || null;
    } catch {
      return null;
    }
  }

  function inspectKiwiMessage(data) {
    try {
      if (data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(data);
        if (bytes.length < 3) return { audio: false, state: null };
        const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
        if (tag === 'SND') return { audio: bytes.length >= 10, state: null };
        if (tag === 'MSG') {
          const text = decoder.decode(bytes.subarray(4));
          if (/(?:^|\s)too_busy=1(?:\s|$)/.test(text)) return { audio: false, state: 'busy' };
          if (/(?:^|\s)down=1(?:\s|$)/.test(text)) return { audio: false, state: 'offline' };
        }
      } else if (typeof data === 'string') {
        if (data.startsWith('SND')) return { audio: true, state: null };
        if (/too_busy=1/.test(data)) return { audio: false, state: 'busy' };
        if (/down=1/.test(data)) return { audio: false, state: 'offline' };
      }
    } catch {
      // Malformed frames do not affect receiver health.
    }
    return { audio: false, state: null };
  }

  function HealthAwareWebSocket(url, protocols) {
    const socket = protocols === undefined
      ? new NativeWebSocket(url)
      : new NativeWebSocket(url, protocols);
    const receiverId = sdrReceiverId(url);
    if (!receiverId) return socket;

    let gotAudio = false;
    let confirmedFailure = false;

    const failOnce = (reason) => {
      if (confirmedFailure || gotAudio) return;
      confirmedFailure = true;
      markFailure(receiverId, reason);
    };

    socket.addEventListener('message', (event) => {
      const inspection = inspectKiwiMessage(event.data);
      if (inspection.audio && !gotAudio) {
        gotAudio = true;
        markSuccess(receiverId);
      } else if (inspection.state) {
        // Only receiver-confirmed busy/offline states influence ranking.
        // Browser/proxy errors and timeouts are not evidence that the remote
        // receiver itself is unhealthy.
        failOnce(inspection.state);
      }
    });

    // Observation only: this wrapper never closes a WebSocket and never starts
    // an independent connection timeout. sdr-player.js is the sole owner of
    // connection lifetime and failover.
    return socket;
  }

  HealthAwareWebSocket.prototype = NativeWebSocket.prototype;
  Object.defineProperties(HealthAwareWebSocket, {
    CONNECTING: { value: NativeWebSocket.CONNECTING },
    OPEN: { value: NativeWebSocket.OPEN },
    CLOSING: { value: NativeWebSocket.CLOSING },
    CLOSED: { value: NativeWebSocket.CLOSED }
  });

  window.WebSocket = HealthAwareWebSocket;
})();