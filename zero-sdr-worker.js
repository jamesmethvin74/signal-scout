const RECEIVERS = {
  houston: { name: 'Houston, Texas', host: '22156.proxy.kiwisdr.com:8073', protocol: 'http:' },
  wheeling: { name: 'Wheeling, Illinois', host: '22222.proxy.kiwisdr.com:8073', protocol: 'http:' },
  carolina: { name: 'Elizabeth City, North Carolina', host: 'kiwisdr.ku4by.com:8073', protocol: 'http:' }
};

const NEW_TIMESTAMP_SPACE = 1n << 62n;
const LOWER_TIMESTAMP_MASK = NEW_TIMESTAMP_SPACE - 1n;

function upstreamTimestamp(raw) {
  const value = BigInt(raw) & LOWER_TIMESTAMP_MASK;
  return (NEW_TIMESTAMP_SPACE | value).toString();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

async function proxySocket(request, url) {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('WebSocket required', { status: 426 });
  }

  const receiverId = url.searchParams.get('receiver') || 'houston';
  const stream = url.searchParams.get('stream') || '';
  const ts = url.searchParams.get('ts') || '';
  const receiver = RECEIVERS[receiverId];

  if (!receiver) return new Response('Unknown receiver', { status: 404 });
  if (stream !== 'SND' && stream !== 'W/F') return new Response('Unknown stream', { status: 400 });
  if (!/^\d{1,13}$/.test(ts)) return new Response('Bad session', { status: 400 });

  const scheme = receiver.protocol;
  const target = `${scheme}//${receiver.host}/${upstreamTimestamp(ts)}/${stream}`;

  try {
    const upstream = await fetch(target, {
      headers: {
        Upgrade: 'websocket',
        Origin: `${scheme}//${receiver.host}`,
        'User-Agent': 'FREQBEACON-ZERO/1.0'
      }
    });
    if (!upstream.webSocket) {
      return new Response(`Receiver refused ${stream} (${upstream.status})`, { status: 502 });
    }
    return upstream;
  } catch (error) {
    return new Response(`Receiver connection failed: ${error?.message || 'unknown error'}`, { status: 502 });
  }
}

export async function handleZeroSdr(request) {
  const url = new URL(request.url);
  if (url.pathname === '/api/zero-sdr/receivers') {
    return json({
      receivers: Object.entries(RECEIVERS).map(([id, receiver]) => ({ id, name: receiver.name }))
    });
  }
  if (url.pathname === '/api/zero-sdr/ws') return proxySocket(request, url);
  return null;
}
