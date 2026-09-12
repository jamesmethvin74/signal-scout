const RECEIVER = Object.freeze({
  id: 'ku4by-8074',
  name: 'KU4BY',
  place: 'Elizabeth City, North Carolina',
  host: 'kiwisdr.ku4by.com:8074',
  protocol: 'http:'
});

const VERSION = 'zero-cleanroom-2';

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

function parseStatusPairs(text) {
  const pairs = {};
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key) pairs[key] = value;
  }
  return pairs;
}

async function fetchUpstreamText(path, accept = 'text/plain') {
  const response = await fetch(`${upstreamBase()}${path}`, {
    headers: {
      accept,
      'user-agent': 'FREQBEACON-ZERO/cleanroom'
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${path} FAILED (${response.status})`);
  }
  return text;
}

async function bootstrap() {
  try {
    const text = await fetchUpstreamText('/VER', 'application/json');
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

async function receiverDiagnostics() {
  try {
    const [versionText, statusText] = await Promise.all([
      fetchUpstreamText('/VER', 'application/json'),
      fetchUpstreamText('/status', 'text/plain')
    ]);

    let version = null;
    try {
      version = JSON.parse(versionText);
    } catch {
      // Keep the status payload usable even if VER format changes.
    }

    return json({
      ok: true,
      observedAt: new Date().toISOString(),
      receiver: {
        id: RECEIVER.id,
        name: RECEIVER.name,
        place: RECEIVER.place,
        host: RECEIVER.host
      },
      kiwi: {
        major: Number.isFinite(Number(version?.maj)) ? Number(version.maj) : null,
        minor: Number.isFinite(Number(version?.min)) ? Number(version.min) : null,
        sessionTs: version?.ts != null ? String(version.ts) : null
      },
      status: parseStatusPairs(statusText)
    });
  } catch (error) {
    return json({
      ok: false,
      error: `RECEIVER DIAGNOSTICS FAILED: ${error?.message || 'network error'}`
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

  if (request.method === 'GET' && url.pathname === '/api/zero/diagnostics') {
    return receiverDiagnostics();
  }

  if (url.pathname === '/api/zero/ws') {
    return openKiwiSocket(request, url);
  }

  return json({ ok: false, error: 'ZERO ENDPOINT NOT FOUND' }, 404);
}
