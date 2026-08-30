import baseWorker from './worker-program-v16.js';
import { SDR_DIRECTORY_SEED_VERSION, rankSeedReceivers } from './sdr-directory-seed.js';

function jsonResponse(value, status = 200, marker = 'bundled-seed-immediate-v1') {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'private, max-age=0, no-store',
      'x-freqbeacon-sdr-directory': marker
    }
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
    source: 'bundled-seed-immediate',
    warning: `Using FREQBEACON built-in public SDR catalog ${SDR_DIRECTORY_SEED_VERSION} for immediate receiver selection.`,
    generatedAt: new Date().toISOString()
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/sdr/receivers') {
      // Receiver options must never block on live ReceiverBook parsing. The
      // bundled catalog is already geographically ranked for the user's
      // location, transmitter path and frequency, and worker-v2 can resolve
      // every bundled receiver ID directly for Kiwi WebSocket connections.
      return rankedSeedResponse(request);
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') {
      return baseWorker.scheduled(event, env, ctx);
    }
  }
};
