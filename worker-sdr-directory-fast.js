import baseWorker from './worker-program-v16.js';
import { SDR_DIRECTORY_SEED_VERSION, rankSeedReceivers } from './sdr-directory-seed.js';

const RECEIVER_RESPONSE_DEADLINE_MS = 2200;

function jsonResponse(value, status = 200, marker = 'fast-fallback-v2') {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, max-age=0, no-store',
      'x-freqbeacon-sdr-directory': marker
    }
  });
}

function deadline(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(null), ms));
}

async function fullyBufferedUsableReceiverResponse(request, env, ctx) {
  const response = await baseWorker.fetch(request, env, ctx);
  if (!response || !response.ok) return null;

  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('application/json')) return null;

  // IMPORTANT: the deadline must cover the BODY too, not just receipt of HTTP
  // headers. Returning a Response whose JSON stream is still pending can leave
  // Android waiting until the client-side 6.5s abort, which then triggers the
  // three legacy receivers in sdr-player.js.
  const payload = await response.json();
  if (!Array.isArray(payload?.receivers) || payload.receivers.length <= 3) return null;

  // Re-buffer the successful live payload into a complete local Response so the
  // browser never receives a partially-open upstream body stream.
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'private, max-age=0, no-store');
  headers.set('x-freqbeacon-sdr-directory', 'live-buffered-v2');
  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function rankedSeedResponse(request) {
  const url = new URL(request.url);
  const receivers = rankSeedReceivers({
    frequencyKHz: url.searchParams.get('frequency'),
    userLat: url.searchParams.get('lat'),
    userLon: url.searchParams.get('lon'),
    txLat: url.searchParams.get('txLat'),
    txLon: url.searchParams.get('txLon')
  });

  if (!receivers.length) {
    return jsonResponse({ error: 'No built-in SDR covers this frequency' }, 503);
  }

  return jsonResponse({
    receivers,
    source: 'bundled-seed-fast',
    warning: `Live receiver discovery did not finish within ${RECEIVER_RESPONSE_DEADLINE_MS} ms; using FREQBEACON built-in catalog ${SDR_DIRECTORY_SEED_VERSION}.`,
    generatedAt: new Date().toISOString()
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/api/sdr/receivers') {
      return baseWorker.fetch(request, env, ctx);
    }

    // Race the COMPLETE usable live payload (including response.json()), not
    // merely baseWorker.fetch() resolving with headers.
    const livePromise = fullyBufferedUsableReceiverResponse(request, env, ctx).catch(() => null);
    const usable = await Promise.race([
      livePromise,
      deadline(RECEIVER_RESPONSE_DEADLINE_MS)
    ]);

    if (usable) return usable;

    // Keep the live request running in the background so its internal directory
    // cache can still warm, while the phone gets a complete ranked response now.
    ctx?.waitUntil(livePromise.then(() => undefined));
    return rankedSeedResponse(request);
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') {
      return baseWorker.scheduled(event, env, ctx);
    }
  }
};
