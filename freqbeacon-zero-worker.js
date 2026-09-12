const RECEIVERS = Object.freeze({
  zero: Object.freeze({
    id: 'ku4by-8074',
    name: 'KU4BY',
    place: 'Elizabeth City, North Carolina',
    host: 'kiwisdr.ku4by.com:8074',
    protocol: 'http:'
  }),
  bench: Object.freeze({
    id: 'n2yo-8073',
    name: 'N2YO',
    place: 'Chantilly, Virginia',
    host: 'kiwisdr.n2yo.net:8073',
    protocol: 'http:',
    requiredMode: 'rx4.wf4'
  })
});

const VERSION = 'zero-cleanroom-3';

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

function upstreamBase(receiver) {
  return `${receiver.protocol}//${receiver.host}`;
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

async function fetchUpstreamText(receiver, path, accept = 'text/plain') {
  const response = await fetch(`${upstreamBase(receiver)}${path}`, {
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

async function bootstrap(receiver) {
  try {
    const [versionText, statusText] = receiver.requiredMode
      ? await Promise.all([
          fetchUpstreamText(receiver, '/VER', 'application/json'),
          fetchUpstreamText(receiver, '/status', 'text/plain')
        ])
      : [await fetchUpstreamText(receiver, '/VER', 'application/json'), null];

    let version;
    try {
      version = JSON.parse(versionText);
    } catch {
      return json({ ok: false, error: 'RECEIVER VER INVALID' }, 502);
    }

    const sessionTs = String(version?.ts ?? '');
    if (!/^\d{8,20}$/.test(sessionTs)) {
      return json({ ok: false, error: 'RECEIVER SESSION TIMESTAMP MISSING' }, 502);
    }

    if (receiver.requiredMode) {
      const status = parseStatusPairs(statusText);
      const observedMode = String(status.mode || '').trim();
      if (observedMode !== receiver.requiredMode) {
        return json({
          ok: false,
          error: `QUALIFICATION RECEIVER MODE ${observedMode || 'UNKNOWN'}; NEED ${receiver.requiredMode}`,
          receiver: {
            id: receiver.id,
            name: receiver.name,
            place: receiver.place
          },
          status: {
            mode: observedMode || null,
            users: Number.isFinite(Number(status.users)) ? Number(status.users) : null,
            usersMax: Number.isFinite(Number(status.users_max)) ? Number(status.users_max) : null
          }
        }, 409);
      }
    }

    return json({
      ok: true,
      sessionTs,
      receiver: {
        id: receiver.id,
        name: receiver.name,
        place: receiver.place
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

async function receiverDiagnostics(receiver) {
  try {
    const [versionText, statusText] = await Promise.all([
      fetchUpstreamText(receiver, '/VER', 'application/json'),
      fetchUpstreamText(receiver, '/status', 'text/plain')
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
        id: receiver.id,
        name: receiver.name,
        place: receiver.place,
        host: receiver.host
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

async function openKiwiSocket(request, url, receiver) {
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

  const target = `${upstreamBase(receiver)}/ws/kiwi/${sessionTs}/${stream}`;

  try {
    const response = await fetch(target, {
      headers: {
        Upgrade: 'websocket',
        Origin: upstreamBase(receiver),
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
  const isBench = url.pathname.startsWith('/api/zero-bench/');
  const receiver = isBench ? RECEIVERS.bench : RECEIVERS.zero;

  if (request.method === 'GET' && (url.pathname === '/api/zero/bootstrap' || url.pathname === '/api/zero-bench/bootstrap')) {
    return bootstrap(receiver);
  }

  if (request.method === 'GET' && (url.pathname === '/api/zero/diagnostics' || url.pathname === '/api/zero-bench/diagnostics')) {
    return receiverDiagnostics(receiver);
  }

  if (url.pathname === '/api/zero/ws' || url.pathname === '/api/zero-bench/ws') {
    return openKiwiSocket(request, url, receiver);
  }

  return json({ ok: false, error: 'ZERO ENDPOINT NOT FOUND' }, 404);
}
