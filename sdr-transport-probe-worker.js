import { SDR_DIRECTORY_SEED } from './sdr-directory-seed.js';

const PROBE_TIMEOUT_MS = 3500;
const NEW_TSTAMP_SPACE = 1n << 62n;
const LOWER_TSTAMP_MASK = NEW_TSTAMP_SPACE - 1n;

function normalize(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const port = url.port || (url.protocol === 'https:' ? '443' : '80');
    return {
      id:`${url.hostname.toLowerCase()}:${port}`,
      protocol:url.protocol,
      host:url.host,
      hostname:url.hostname.toLowerCase()
    };
  } catch {
    return null;
  }
}

const ALLOWED = new Map();
for (const seed of SDR_DIRECTORY_SEED) {
  const normalized = normalize(seed.url);
  if (normalized) ALLOWED.set(String(seed.id).toLowerCase(), normalized);
}

function proxySafeTimestamp(timestamp) {
  const lower = BigInt(timestamp) & LOWER_TSTAMP_MASK;
  return (NEW_TSTAMP_SPACE | lower).toString();
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store, max-age=0'
    }
  });
}

export async function probeSdrTransport(request) {
  const url = new URL(request.url);
  const requestedId = String(url.searchParams.get('receiver') || '').toLowerCase();
  const receiver = ALLOWED.get(requestedId);
  if (!receiver) {
    return json({ ok:false, stage:'validation', receiverId:requestedId, error:'Receiver is not in the deployment-bundled diagnostic allowlist.' }, 400);
  }

  const timestamp = ((Date.now() / 1000) | 0) >>> 0;
  const upstreamTimestamp = proxySafeTimestamp(timestamp);
  const upstreamScheme = receiver.protocol === 'https:' ? 'https:' : 'http:';
  const upstreamUrl = `${upstreamScheme}//${receiver.host}/${upstreamTimestamp}/SND`;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('probe-timeout'), PROBE_TIMEOUT_MS);

  try {
    const response = await fetch(upstreamUrl, {
      headers:{
        Upgrade:'websocket',
        Origin:`${upstreamScheme}//${receiver.host}`,
        'User-Agent':'FreqBeacon/transport-probe'
      },
      signal:controller.signal
    });
    const elapsedMs = Date.now() - startedAt;
    const socket = response.webSocket;
    if (!socket) {
      return json({
        ok:false,
        stage:'upstream-handshake',
        receiverId:requestedId,
        resolvedHost:receiver.host,
        elapsedMs,
        status:response.status,
        error:'Upstream did not accept the WebSocket upgrade.'
      });
    }

    try {
      socket.accept();
      socket.close(1000, 'FreqBeacon transport probe');
    } catch {}

    return json({
      ok:true,
      stage:'upstream-handshake',
      receiverId:requestedId,
      resolvedHost:receiver.host,
      elapsedMs,
      status:response.status || 101
    });
  } catch (error) {
    return json({
      ok:false,
      stage:'upstream-fetch',
      receiverId:requestedId,
      resolvedHost:receiver.host,
      elapsedMs:Date.now() - startedAt,
      error:error?.name === 'AbortError' ? `Timed out after ${PROBE_TIMEOUT_MS} ms` : (error?.message || String(error))
    });
  } finally {
    clearTimeout(timer);
  }
}
