const RECEIVER = Object.freeze({
  id: 'ku4by-8074',
  name: 'KU4BY',
  place: 'Elizabeth City, North Carolina',
  host: 'kiwisdr.ku4by.com:8074',
  protocol: 'http:'
});

const VERSION = 'zero-cleanroom-1';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-freqbeacon-zero': VERSION
    }
  });
}

function upstreamBase() {
  return `${RECEIVER.protocol}//${RECEIVER.host}`;
}

async function bootstrap() {
  try {
    const response = await fetch(`${upstreamBase()}/VER`, {
      headers: {
        accept: 'application/json',
        'user-agent': 'FREQBEACON-ZERO/cleanroom'
      }
    });

    if (!response.ok) {
      return json({ ok: false, error: `RECEIVER VER FAILED (${response.status})` }, 502);
    }

    const text = await response.text();
    let version;
    try {
      version = JSON.parse(text);
    } catch {
      return json({ ok: false, error: 'RECEIVER VER INVALID' }, 502);
    }

    const sessionTs = String(version?.ts ?? '');
    if (!/^\d{8,20}$/.test(sessionTs)) {
      return json({ ok: false, error: 'RECEIVER SESSION TIMESTAMP MISSING' }, 502);
    }

    return json({
      ok: true,
      sessionTs,
      receiver: {
        id: RECEIVER.id,
        name: RECEIVER.name,
        place: RECEIVER.place
      },
      kiwi: {
        major: Number.isFinite(Number(version?.maj)) ? Number(version.maj) : null,
        minor: Number.isFinite(Number(version?.min)) ? Number(version.min) : null
      }
    });
  } catch (error) {
    return json({
      ok: false,
      error: `RECEIVER VER FAILED: ${error?.message || 'network error'}`
    }, 502);
  }
}

async function openKiwiSocket(request, url) {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('WEBSOCKET REQUIRED', { status: 426 });
  }

  const stream = url.searchParams.get('stream');
  const sessionTs = url.searchParams.get('ts') || '';

  if (stream !== 'SND' && stream !== 'W/F') {
    return new Response('UNKNOWN STREAM', { status: 400 });
  }
  if (!/^\d{8,20}$/.test(sessionTs)) {
    return new Response('BAD SESSION TIMESTAMP', { status: 400 });
  }

  const target = `${upstreamBase()}/ws/kiwi/${sessionTs}/${stream}`;

  try {
    const response = await fetch(target, {
      headers: {
        Upgrade: 'websocket',
        Origin: upstreamBase(),
        'User-Agent': 'FREQBEACON-ZERO/cleanroom'
      }
    });

    if (!response.webSocket) {
      return new Response(`${stream} REFUSED (${response.status})`, { status: 502 });
    }

    return response;
  } catch (error) {
    return new Response(`${stream} CONNECT FAILED: ${error?.message || 'network error'}`, {
      status: 502
    });
  }
}

export async function handleFreqbeaconZero(request) {
  const url = new URL(request.url);

  if (request.method === 'GET' && url.pathname === '/api/zero/bootstrap') {
    return bootstrap();
  }

  if (url.pathname === '/api/zero/ws') {
    return openKiwiSocket(request, url);
  }

  return json({ ok: false, error: 'ZERO ENDPOINT NOT FOUND' }, 404);
}
