const RECEIVERS = {
  florida: '22315.proxy.kiwisdr.com',
  'north-carolina': '22904.proxy.kiwisdr.com',
  pennsylvania: '22479.proxy.kiwisdr.com'
};

function closeQuietly(socket, code = 1000, reason = '') {
  try { socket.close(code, reason); } catch {}
}

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
  let upstreamResponse;
  try {
    upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        Upgrade: 'websocket',
        'User-Agent': 'SignalScout/1.0'
      }
    });
  } catch {
    return new Response('Receiver unavailable', { status: 502 });
  }

  const upstream = upstreamResponse.webSocket;
  if (!upstream) {
    return new Response(`Receiver refused WebSocket (${upstreamResponse.status})`, { status: 502 });
  }

  const pair = new WebSocketPair();
  const client = pair[0];
  const server = pair[1];
  server.accept();
  upstream.accept();

  server.addEventListener('message', (event) => {
    try { upstream.send(event.data); } catch { closeQuietly(server, 1011, 'Upstream send failed'); }
  });
  upstream.addEventListener('message', (event) => {
    try { server.send(event.data); } catch { closeQuietly(upstream, 1000, 'Client gone'); }
  });
  server.addEventListener('close', () => closeQuietly(upstream, 1000, 'Client closed'));
  upstream.addEventListener('close', () => closeQuietly(server, 1000, 'Receiver closed'));
  server.addEventListener('error', () => closeQuietly(upstream, 1011, 'Client error'));
  upstream.addEventListener('error', () => closeQuietly(server, 1011, 'Receiver error'));

  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/sdr/ws') return proxySdrWebSocket(request);
    return env.ASSETS.fetch(request);
  }
};
