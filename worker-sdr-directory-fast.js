import baseWorker from './worker-program-v16.js';
import { SDR_DIRECTORY_SEED_VERSION, rankSeedReceivers } from './sdr-directory-seed.js';

const RECEIVER_RESPONSE_DEADLINE_MS = 2200;

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, max-age=0, no-store',
      'x-freqbeacon-sdr-directory': 'fast-fallback-v1'
    }
  });
}

function deadline(ms) {
  return new Promise((resolve) => setTimeout(() => resolve(null), ms));
}

async function usableReceiverResponse(response) {
  if (!response) return null;
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('application/json')) return response;

  try {
    const payload = await response.clone().json();
    if (Array.isArray(payload?.receivers) && payload.receivers.length > 3) return response;
  } catch {
    return response;
  }

  return null;
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
    warning: `Live receiver discovery did not answer quickly enough; using FREQBEACON built-in catalog ${SDR_DIRECTORY_SEED_VERSION}.`,
    generatedAt: new Date().toISOString()
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.pathname !== '/api/sdr/receivers') {
      return baseWorker.fetch(request, env, ctx);
    }

    const livePromise = Promise.resolve(baseWorker.fetch(request, env, ctx)).catch(() => null);
    const candidate = await Promise.race([
      livePromise,
      deadline(RECEIVER_RESPONSE_DEADLINE_MS)
    ]);

    const usable = await usableReceiverResponse(candidate);
    if (usable) return usable;

    // Do not hold the phone open while ReceiverBook is slow or unreachable.
    // The existing worker-v2 resolver already knows every bundled seed ID, so
    // these choices remain compatible with the proven SND/W/F proxy path.
    ctx?.waitUntil(livePromise.then(() => undefined));
    return rankedSeedResponse(request);
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') {
      return baseWorker.scheduled(event, env, ctx);
    }
  }
};
