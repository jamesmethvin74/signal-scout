import baseWorker from './worker-sdr-km4rt-alias-fix.js';

const MARKER = 'sdr-reliability-ranking-v1';

function jsResponse(response, source, headerName, headerValue) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/javascript; charset=utf-8');
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set(headerName, headerValue);
  return new Response(source, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function patchRuntime(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;

  return response.text().then((source) => {
    let patched = source;

    // The active health observer writes v2. The ranking runtime was still
    // reading the abandoned v1 key, so recent successes never influenced rank.
    patched = patched.replace(
      "  const HEALTH_KEY = 'signalScout:sdrHealth:v1';",
      "  const HEALTH_KEY = 'signalScout:sdrHealth:v2';\n  const CONNECTION_USABILITY_KEY = 'freqbeacon:sdrConnectionUsability:v1';\n  const CONNECTION_FAILURE_WINDOW_MS = 2 * 60 * 60 * 1000;\n  const CONNECTION_SUCCESS_WINDOW_MS = 6 * 60 * 60 * 1000;"
    );

    const normalizeAnchor = '  function normalizeReceiver(receiver, liveEvidence = false) {';
    if (patched.includes(normalizeAnchor) && !patched.includes('function loadConnectionUsability()')) {
      const helpers = `  function canonicalUsabilityId(value) {\n    const id = String(value || '').trim().toLowerCase();\n    return id === '64.22.14.214:8073' ? 'km4rt.ddns.net:8073' : id;\n  }\n\n  function loadConnectionUsability() {\n    try {\n      const parsed = JSON.parse(window.localStorage?.getItem(CONNECTION_USABILITY_KEY) || '{}');\n      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};\n    } catch { return {}; }\n  }\n\n  function saveConnectionUsability(history) {\n    try { window.localStorage?.setItem(CONNECTION_USABILITY_KEY, JSON.stringify(history)); } catch {}\n  }\n\n  function noteConnectionFailure(receiverId, reason = 'connection-failed') {\n    const id = canonicalUsabilityId(receiverId);\n    if (!id) return;\n    const history = loadConnectionUsability();\n    const previous = history[id] || {};\n    const now = Date.now();\n    const priorFailure = Number(previous.lastFailure || 0);\n    const failures = priorFailure > now - CONNECTION_FAILURE_WINDOW_MS\n      ? Math.min(5, Number(previous.failures || 0) + 1)\n      : 1;\n    history[id] = { ...previous, failures, lastFailure: now, lastFailureReason: String(reason || 'connection-failed') };\n    saveConnectionUsability(history);\n  }\n\n  function noteConnectionSuccess(receiverId) {\n    const id = canonicalUsabilityId(receiverId);\n    if (!id) return;\n    const history = loadConnectionUsability();\n    const previous = history[id] || {};\n    history[id] = { ...previous, failures: 0, lastSuccess: Date.now(), successes: Math.min(100, Number(previous.successes || 0) + 1) };\n    saveConnectionUsability(history);\n  }\n\n  window.addEventListener('freqbeacon:snd-attempt-failed', (event) => {\n    noteConnectionFailure(event.detail?.receiverId, event.detail?.reason);\n  });\n  window.addEventListener('freqbeacon:snd-audio', (event) => {\n    noteConnectionSuccess(event.detail?.receiverId);\n  });\n\n`;
      patched = patched.replace(normalizeAnchor, helpers + normalizeAnchor);
    }

    patched = patched.replace(
      '    const health = loadHealth(), now = Date.now(), local = frequency < 2000;',
      '    const health = loadHealth(), connectionUsability = loadConnectionUsability(), now = Date.now(), local = frequency < 2000;'
    );

    const oldHealthBlock = `      const entry = health[receiver.id] || {};\n      const cooling = Number(entry.cooldownUntil || 0) > now;\n      const recentSuccess = Number(entry.lastSuccess || 0) > now - RECENT_SUCCESS_MS;\n      return { ...receiver, userDistance, txDistance, pathSimilarity, solar, score, cooling, recentSuccess, failures: Number(entry.failures || 0) };`;
    const newHealthBlock = `      const entry = health[receiver.id] || health[canonicalUsabilityId(receiver.id)] || {};\n      const cooling = Number(entry.cooldownUntil || 0) > now;\n      const recentSuccess = Number(entry.lastSuccess || 0) > now - RECENT_SUCCESS_MS;\n      const usability = connectionUsability[canonicalUsabilityId(receiver.id)] || {};\n      const recentConnectionSuccess = Number(usability.lastSuccess || 0) > now - CONNECTION_SUCCESS_WINDOW_MS;\n      const recentConnectionFailure = Number(usability.lastFailure || 0) > now - CONNECTION_FAILURE_WINDOW_MS\n        && Number(usability.lastFailure || 0) > Number(usability.lastSuccess || 0);\n      const connectionFailures = recentConnectionFailure ? Math.max(1, Number(usability.failures || 1)) : 0;\n      const connectionPenalty = recentConnectionFailure ? Math.min(18, 6 + connectionFailures * 4) : 0;\n      const connectionBonus = recentConnectionSuccess ? 6 : 0;\n      const effectiveScore = score + connectionBonus - connectionPenalty;\n      const proxyEndpoint = /\\.proxy\\.kiwisdr\\.com(?::|$)/i.test(String(receiver.id || ''));\n      return { ...receiver, userDistance, txDistance, pathSimilarity, solar, score, effectiveScore, cooling, recentSuccess, recentConnectionSuccess, recentConnectionFailure, connectionFailures, proxyEndpoint, failures: Number(entry.failures || 0) };`;
    patched = patched.replace(oldHealthBlock, newHealthBlock);

    const oldHamSort = `        return hamBucket(ad) - hamBucket(bd)\n          || (ad + (a.cooling ? 450 + a.failures * 120 : 0) - (a.recentSuccess ? 90 : 0))\n             - (bd + (b.cooling ? 450 + b.failures * 120 : 0) - (b.recentSuccess ? 90 : 0))\n          || b.score - a.score;`;
    const newHamSort = `        return hamBucket(ad) - hamBucket(bd)\n          || (ad + (a.cooling ? 450 + a.failures * 120 : 0) + (a.recentConnectionFailure ? Math.min(120, 35 + a.connectionFailures * 25) : 0) - (a.recentSuccess || a.recentConnectionSuccess ? 90 : 0))\n             - (bd + (b.cooling ? 450 + b.failures * 120 : 0) + (b.recentConnectionFailure ? Math.min(120, 35 + b.connectionFailures * 25) : 0) - (b.recentSuccess || b.recentConnectionSuccess ? 90 : 0))\n          || b.effectiveScore - a.effectiveScore;`;
    patched = patched.replace(oldHamSort, newHamSort);

    const oldNormalSort = '      eligible.sort((a, b) => b.score - a.score || Number(b.recentSuccess) - Number(a.recentSuccess) || (a.userDistance ?? Infinity) - (b.userDistance ?? Infinity));';
    const newNormalSort = `      eligible.sort((a, b) => {\n        const scoreGap = b.effectiveScore - a.effectiveScore;\n        if (Math.abs(scoreGap) <= 8) {\n          const aWorked = Boolean(a.recentConnectionSuccess || a.recentSuccess);\n          const bWorked = Boolean(b.recentConnectionSuccess || b.recentSuccess);\n          if (aWorked !== bWorked) return Number(bWorked) - Number(aWorked);\n          if (a.recentConnectionFailure !== b.recentConnectionFailure) return Number(a.recentConnectionFailure) - Number(b.recentConnectionFailure);\n          // When two receivers are otherwise close, prefer a direct Kiwi host\n          // over a proxy endpoint. This keeps geography first while avoiding an\n          // extra intermediary when it buys essentially no RF advantage.\n          if (a.proxyEndpoint !== b.proxyEndpoint) return Number(a.proxyEndpoint) - Number(b.proxyEndpoint);\n        }\n        return scoreGap || Number(b.recentSuccess) - Number(a.recentSuccess) || (a.userDistance ?? Infinity) - (b.userDistance ?? Infinity);\n      });`;
    patched = patched.replace(oldNormalSort, newNormalSort);

    const applied = patched !== source
      && patched.includes("const HEALTH_KEY = 'signalScout:sdrHealth:v2'")
      && patched.includes('freqbeacon:sdrConnectionUsability:v1')
      && patched.includes('recentConnectionFailure')
      && patched.includes('proxyEndpoint');

    return jsResponse(response, patched, 'x-freqbeacon-sdr-reliability-ranking', applied ? MARKER : 'runtime-patch-miss');
  });
}

function patchPlayer(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;

  return response.text().then((source) => {
    const oldStart = `  function failCurrentReceiver(message) {\n    if (sdr.manualStop) return;\n    disconnectSocket();`;
    const newStart = `  function failCurrentReceiver(message) {\n    if (sdr.manualStop) return;\n    const failedReceiver = currentReceiver();\n    window.dispatchEvent(new CustomEvent('freqbeacon:snd-attempt-failed', {\n      detail: {\n        receiverId: failedReceiver?.id || sdr.socketReceiverId || '',\n        reason: /timed out/i.test(String(message || '')) ? 'timeout' : /connection failed/i.test(String(message || '')) ? 'connection-failed' : /did not answer/i.test(String(message || '')) ? 'no-answer' : 'open-failed'\n      }\n    }));\n    disconnectSocket();`;

    const patched = source.replace(oldStart, newStart);
    const applied = patched !== source && patched.includes('freqbeacon:snd-attempt-failed');
    return jsResponse(response, patched, 'x-freqbeacon-sdr-reliability-ranking', applied ? MARKER : 'player-patch-miss');
  });
}

function patchRoot(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;

  return response.text().then((html) => {
    html = html.replace(/sdr-receiver-runtime-v3\.js\?v=\d+/g, 'sdr-receiver-runtime-v3.js?v=9');
    html = html.replace(/sdr-player\.js\?v=\d+/g, 'sdr-player.js?v=12');
    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-sdr-reliability-ranking', MARKER);
    return new Response(html, { status: response.status, statusText: response.statusText, headers });
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await baseWorker.fetch(request, env, ctx);

    if (request.method === 'GET' && url.pathname === '/sdr-receiver-runtime-v3.js') return patchRuntime(response);
    if (request.method === 'GET' && url.pathname === '/sdr-player.js') return patchPlayer(response);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return patchRoot(response);
    return response;
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(event, env, ctx);
  }
};
