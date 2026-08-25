const RECEIVERS = {
  florida: '22315.proxy.kiwisdr.com',
  'north-carolina': '22904.proxy.kiwisdr.com',
  pennsylvania: '22479.proxy.kiwisdr.com'
};

async function proxySdrWebSocket(request) {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected WebSocket upgrade', { status: 426 });
  }

  const url = new URL(request.url);
  const receiverId = url.searchParams.get('receiver') || '';
  const host = RECEIVERS[receiverId];
  const stream = url.searchParams.get('stream') || 'SND';
  const timestamp = url.searchParams.get('ts') || '';

  if (!host || stream !== 'SND' || !/^\d{1,10}$/.test(timestamp)) {
    return new Response('Invalid SDR request', { status: 400 });
  }

  const upstreamUrl = `http://${host}/${timestamp}/${stream}`;

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        Upgrade: 'websocket',
        Origin: `http://${host}`,
        'User-Agent': 'SignalScout/1.0'
      }
    });

    // Cloudflare can transparently proxy an accepted upstream WebSocket by
    // returning the upgrade response directly. Do not terminate the socket in
    // the Worker and manually shuttle frames; that makes the Kiwi handshake
    // unnecessarily fragile and can cause the browser side to see a dead
    // connection even when the receiver accepted it.
    if (!upstreamResponse.webSocket) {
      return new Response(`Receiver refused WebSocket (${upstreamResponse.status})`, { status: 502 });
    }

    return upstreamResponse;
  } catch (error) {
    return new Response(`Receiver unavailable: ${error?.message || 'connection failed'}`, { status: 502 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/sdr/ws') return proxySdrWebSocket(request);
    return env.ASSETS.fetch(request);
  }
};
