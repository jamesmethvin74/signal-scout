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

async function liveReceiverResponse(request, env, ctx) {
  const liveUrl = new URL(request.url);
  liveUrl.pathname = '/api/sdr/receivers';
  const liveRequest = new Request(liveUrl.toString(), request);
  const response = await baseWorker.fetch(liveRequest, env, ctx);
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'private, max-age=0, no-store');
  headers.set('x-freqbeacon-sdr-live-refresh', 'receiverbook-background-v1');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/sdr/receivers/live') {
      // Background-only live discovery. This intentionally bypasses the outer
      // immediate seed response while preserving worker-v2's proven ReceiverBook
      // parsing, resolver validation, and stale/fallback behavior.
      return liveReceiverResponse(request, env, ctx);
    }

    if (request.method === 'GET' && url.pathname === '/api/sdr/receivers') {
      // Keep the synchronous server fallback for diagnostics and clients that
      // do not have the receiver runtime. Normal app selection is satisfied
      // immediately from the client cache and refreshed above in the background.
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