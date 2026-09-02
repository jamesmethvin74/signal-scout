const PASSBANDS = {
  am: [-4900, 4900],
  sam: [-4900, 4900],
  usb: [300, 2700],
  lsb: [-2700, -300]
};

const HTTP_TIMEOUT_MS = 2500;
const WS_HANDSHAKE_TIMEOUT_MS = 3500;
const SESSION_STARTUP_TIMEOUT_MS = 5500;
const CADENCE_SAMPLE_MS = 10000;
const DIAG_VERSION = 'sdr-deep-diagnostics-v2';

function elapsed(start) {
  return Math.max(0, Math.round(performance.now() - start));
}

function safeClose(ws, code = 1000, reason = 'FREQBEACON diagnostic complete') {
  if (!ws) return;
  try { ws.close(code, reason); } catch {}
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-freqbeacon-sdr-diagnostics': DIAG_VERSION
    }
  });
}

function socketPath(variant, timestamp, stream = 'SND') {
  if (variant === 'external-api') return `/${timestamp}/${stream}`;
  if (variant === 'legacy-ui') return `/kiwi/${timestamp}/${stream}`;
  return `/ws/kiwi/${timestamp}/${stream}`;
}

async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function probeHttp(receiver) {
  const started = performance.now();
  const scheme = receiver.protocol === 'https:' ? 'https:' : 'http:';
  const url = `${scheme}//${receiver.upstreamHost}/`;
  try {
    const response = await fetchWithTimeout(url, {
      method: 'GET',
      redirect: 'manual',
      headers: {
        Accept: 'text/html,*/*;q=0.5',
        'User-Agent': 'FREQBEACON/1.0 SDR diagnostic'
      }
    }, HTTP_TIMEOUT_MS);
    return {
      ok: response.status >= 200 && response.status < 500,
      stage: 'http-response',
      status: response.status,
      statusText: response.statusText || '',
      elapsedMs: elapsed(started),
      url
    };
  } catch (error) {
    return {
      ok: false,
      stage: error?.name === 'AbortError' ? 'http-timeout' : 'http-error',
      error: error?.message || String(error),
      elapsedMs: elapsed(started),
      url
    };
  }
}

function decodeKiwiFrame(data) {
  try {
    let bytes = null;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    else if (typeof data === 'string') bytes = new TextEncoder().encode(data);
    if (!bytes || bytes.length < 3) return { tag:'', text:'', bytes:bytes?.length || 0, flags:0 };
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    const text = tag === 'MSG' && bytes.length > 4 ? new TextDecoder().decode(bytes.subarray(4)) : '';
    return { tag, text, bytes:bytes.length, flags:bytes.length >= 4 ? bytes[3] : 0 };
  } catch (error) {
    return { tag:'', text:'', bytes:0, flags:0, error:error?.message || String(error) };
  }
}

function configureSound(ws, frequency, mode, state) {
  if (state.configured) return;
  state.configured = true;
  const safeMode = PASSBANDS[mode] ? mode : 'am';
  const [lowCut, highCut] = PASSBANDS[safeMode];
  const commands = [
    'SET ident_user=FREQBEACON diagnostic',
    `SET mod=${safeMode} low_cut=${lowCut} high_cut=${highCut} freq=${Number(frequency).toFixed(3)}`,
    'SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50',
    'SET compression=0',
    'SET squelch=0 max=0',
    'SET genattn=0',
    'SET gen=0 mix=-1',
    'SET de_emp=0'
  ];
  for (const command of commands) {
    try { ws.send(command); } catch {}
  }
}

function inspectSession(ws, { frequency, mode, started }) {
  return new Promise((resolve) => {
    const result = {
      ok:false,
      stage:'awaiting-kiwi-session',
      authSentMs:null,
      sampleRateMs:null,
      firstSndMs:null,
      sampleRate:null,
      audioRate:null,
      firstSndBytes:null,
      sndFrames:0,
      cadenceSampleMs:0,
      expectedFrameMs:null,
      maxSndGapMs:0,
      gapsOver70Ms:0,
      gapsOver100Ms:0,
      averageSndGapMs:null,
      serverMessages:[],
      close:null,
      error:null
    };
    const state = {
      configured:false,
      finished:false,
      firstSndPerf:null,
      lastSndPerf:null,
      gapTotal:0,
      gapCount:0
    };
    let startupTimer = null;
    let cadenceTimer = null;
    let keepaliveTimer = null;

    const finish = (patch = {}) => {
      if (state.finished) return;
      state.finished = true;
      clearTimeout(startupTimer);
      clearTimeout(cadenceTimer);
      clearInterval(keepaliveTimer);
      if (state.gapCount) result.averageSndGapMs = Number((state.gapTotal / state.gapCount).toFixed(1));
      if (state.firstSndPerf != null) result.cadenceSampleMs = Math.round(performance.now() - state.firstSndPerf);
      Object.assign(result, patch, { elapsedMs:elapsed(started) });
      safeClose(ws);
      resolve(result);
    };

    const onMessage = (event) => {
      const frame = decodeKiwiFrame(event.data);
      if (frame.tag === 'MSG') {
        const text = String(frame.text || '').trim();
        if (text && result.serverMessages.length < 8) result.serverMessages.push(text.slice(0, 280));
        const sampleRate = text.match(/(?:^|\s)sample_rate=([0-9.]+)/)?.[1];
        const audioRate = text.match(/(?:^|\s)audio_rate=([0-9]+)/)?.[1];
        if (sampleRate && result.sampleRateMs == null) {
          result.sampleRate = Number(sampleRate);
          result.sampleRateMs = elapsed(started);
          result.stage = 'sample-rate-received';
          configureSound(ws, frequency, mode, state);
        }
        if (audioRate) {
          result.audioRate = Number(audioRate);
          try { ws.send(`SET AR OK in=${Number(audioRate)} out=48000`); } catch {}
        }
        if (/(?:^|\s)too_busy=(?:1|\d+)(?:\s|$)/.test(text)) {
          finish({ stage:'receiver-busy', error:'Kiwi reported too_busy' });
          return;
        }
        if (/(?:^|\s)down=(?:1|\d+)(?:\s|$)/.test(text)) {
          finish({ stage:'receiver-down', error:'Kiwi reported down' });
          return;
        }
        if (/(?:^|\s)badp=([1-9]\d*)(?:\s|$)/.test(text)) {
          finish({ stage:'auth-rejected', error:'Kiwi reported badp' });
          return;
        }
        if (/(?:^|\s)reason_disabled=\S+/.test(text)) {
          finish({ stage:'receiver-disabled', error:'Kiwi reported reason_disabled' });
        }
        return;
      }

      if (frame.tag !== 'SND' || frame.bytes < 10) return;

      const now = performance.now();
      result.sndFrames += 1;

      if (!(frame.flags & 0x10) && Number(result.sampleRate) > 1000) {
        const audioBytes = Math.max(0, frame.bytes - 10);
        const samples = Math.floor(audioBytes / 2);
        if (samples > 0) result.expectedFrameMs = Number((samples / result.sampleRate * 1000).toFixed(1));
      }

      if (state.lastSndPerf != null) {
        const gap = now - state.lastSndPerf;
        state.gapTotal += gap;
        state.gapCount += 1;
        result.maxSndGapMs = Math.max(result.maxSndGapMs, gap);
        if (gap >= 70) result.gapsOver70Ms += 1;
        if (gap >= 100) result.gapsOver100Ms += 1;
      }
      state.lastSndPerf = now;

      if (state.firstSndPerf == null) {
        state.firstSndPerf = now;
        result.firstSndMs = elapsed(started);
        result.firstSndBytes = frame.bytes;
        result.stage = 'sampling-snd-cadence';
        clearTimeout(startupTimer);
        cadenceTimer = setTimeout(() => finish({ ok:true, stage:'snd-cadence-sampled' }), CADENCE_SAMPLE_MS);
      }
    };

    ws.addEventListener('message', onMessage);
    ws.addEventListener('error', (event) => {
      result.error = event?.message || 'WebSocket error after upgrade';
    });
    ws.addEventListener('close', (event) => {
      result.close = { code:event?.code || 0, reason:event?.reason || '', wasClean:Boolean(event?.wasClean) };
      if (!state.finished) finish({
        stage:state.firstSndPerf == null ? 'socket-closed-before-snd' : 'socket-closed-before-cadence-sample-complete',
        error:result.error || event?.reason || `closed ${event?.code || 0}`
      });
    });

    startupTimer = setTimeout(() => {
      const stage = result.sampleRateMs == null ? 'no-sample-rate' : 'no-snd-after-config';
      finish({ stage, error:`No usable SND frame within ${SESSION_STARTUP_TIMEOUT_MS} ms` });
    }, SESSION_STARTUP_TIMEOUT_MS);

    try {
      ws.send('SET auth t=kiwi p=#');
      result.authSentMs = elapsed(started);
      result.stage = 'auth-sent';
      ws.send('SET keepalive');
      keepaliveTimer = setInterval(() => {
        try { ws.send('SET keepalive'); } catch {}
      }, 2500);
    } catch (error) {
      finish({ stage:'auth-send-failed', error:error?.message || String(error) });
    }
  });
}

async function probeWebSocket(receiver, { timestamp, variant, frequency, mode, deep }) {
  const started = performance.now();
  const scheme = receiver.protocol === 'https:' ? 'https:' : 'http:';
  const path = socketPath(variant, timestamp, 'SND');
  const url = `${scheme}//${receiver.upstreamHost}${path}`;
  let response;
  try {
    response = await fetchWithTimeout(url, {
      headers: {
        Upgrade: 'websocket',
        Origin: `${scheme}//${receiver.upstreamHost}`,
        'User-Agent': 'FREQBEACON/1.0 SDR diagnostic'
      }
    }, WS_HANDSHAKE_TIMEOUT_MS);
  } catch (error) {
    return {
      ok:false,
      variant,
      stage:error?.name === 'AbortError' ? 'ws-handshake-timeout' : 'ws-handshake-error',
      error:error?.message || String(error),
      elapsedMs:elapsed(started),
      url
    };
  }

  const result = {
    ok:Boolean(response.webSocket),
    variant,
    stage:response.webSocket ? 'ws-upgraded' : 'ws-not-upgraded',
    status:response.status,
    statusText:response.statusText || '',
    elapsedMs:elapsed(started),
    url
  };

  if (!response.webSocket) {
    try { result.body = (await response.text()).slice(0, 300); } catch {}
    return result;
  }

  const ws = response.webSocket;
  ws.binaryType = 'arraybuffer';
  try {
    ws.accept({ allowHalfOpen:true });
  } catch (error) {
    return { ...result, ok:false, stage:'ws-accept-failed', error:error?.message || String(error) };
  }

  if (!deep) {
    safeClose(ws);
    return result;
  }

  const session = await inspectSession(ws, { frequency, mode, started });
  return { ...result, ...session, variant, url, status:response.status, statusText:response.statusText || '' };
}

async function probeWaterfall(receiver, { timestamp }) {
  const started = performance.now();
  const scheme = receiver.protocol === 'https:' ? 'https:' : 'http:';
  const url = `${scheme}//${receiver.upstreamHost}${socketPath('native-ui', timestamp, 'W/F')}`;
  try {
    const response = await fetchWithTimeout(url, {
      headers: {
        Upgrade:'websocket',
        Origin:`${scheme}//${receiver.upstreamHost}`,
        'User-Agent':'FREQBEACON/1.0 SDR diagnostic'
      }
    }, WS_HANDSHAKE_TIMEOUT_MS);
    const result = {
      ok:Boolean(response.webSocket),
      stage:response.webSocket ? 'wf-upgraded' : 'wf-not-upgraded',
      status:response.status,
      statusText:response.statusText || '',
      elapsedMs:elapsed(started),
      url
    };
    if (response.webSocket) {
      const ws = response.webSocket;
      try { ws.accept({ allowHalfOpen:true }); } catch {}
      safeClose(ws);
    } else {
      try { result.body = (await response.text()).slice(0, 300); } catch {}
    }
    return result;
  } catch (error) {
    return {
      ok:false,
      stage:error?.name === 'AbortError' ? 'wf-handshake-timeout' : 'wf-handshake-error',
      error:error?.message || String(error),
      elapsedMs:elapsed(started),
      url
    };
  }
}

export async function handleSdrDiagnostic(request, { resolveReceiver, proxySafeTimestamp }) {
  const requestStarted = performance.now();
  const url = new URL(request.url);
  const receiverId = String(url.searchParams.get('receiver') || 'km4rt.ddns.net:8073').trim().toLowerCase();
  const frequency = Number(url.searchParams.get('frequency') || 5990);
  const modeInput = String(url.searchParams.get('mode') || 'am').toLowerCase();
  const mode = PASSBANDS[modeInput] ? modeInput : 'am';

  if (!receiverId || receiverId.length > 180 || !Number.isFinite(frequency) || frequency < 10 || frequency > 30000) {
    return jsonResponse({ ok:false, version:DIAG_VERSION, error:'Invalid receiver or frequency' }, 400);
  }

  let receiver;
  try {
    receiver = await resolveReceiver(receiverId);
  } catch (error) {
    return jsonResponse({
      ok:false,
      version:DIAG_VERSION,
      receiverId,
      stage:'receiver-resolution-error',
      error:error?.message || String(error),
      totalElapsedMs:elapsed(requestStarted)
    }, 502);
  }
  if (!receiver?.upstreamHost) {
    return jsonResponse({
      ok:false,
      version:DIAG_VERSION,
      receiverId,
      stage:'receiver-not-resolved',
      totalElapsedMs:elapsed(requestStarted)
    }, 404);
  }

  const clientTimestamp = (Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 10000)) >>> 0;
  const timestamp = proxySafeTimestamp(String(clientTimestamp));
  const http = await probeHttp(receiver);
  const nativeUi = await probeWebSocket(receiver, { timestamp, variant:'native-ui', frequency, mode, deep:true });
  const waterfall = nativeUi.ok
    ? await probeWaterfall(receiver, { timestamp })
    : { ok:false, stage:'wf-skipped-because-snd-failed' };

  // Comparison handshakes are intentionally shallow and sequential so the
  // diagnostic does not occupy several receiver channels at once.
  const comparisonTimestamp1 = proxySafeTimestamp(String((clientTimestamp + 1) >>> 0));
  const externalApi = await probeWebSocket(receiver, { timestamp:comparisonTimestamp1, variant:'external-api', frequency, mode, deep:false });
  const comparisonTimestamp2 = proxySafeTimestamp(String((clientTimestamp + 2) >>> 0));
  const legacyUi = await probeWebSocket(receiver, { timestamp:comparisonTimestamp2, variant:'legacy-ui', frequency, mode, deep:false });

  const ok = Boolean(nativeUi.ok && nativeUi.firstSndMs != null);
  return jsonResponse({
    ok,
    version:DIAG_VERSION,
    generatedAt:new Date().toISOString(),
    receiverId,
    resolvedReceiver:{
      upstreamHost:receiver.upstreamHost,
      hostname:receiver.hostname,
      protocol:receiver.protocol
    },
    frequency,
    mode,
    clientTimestamp,
    upstreamTimestamp:timestamp,
    stages:{ http, nativeUi, waterfall, externalApi, legacyUi },
    verdict: ok
      ? `Cloudflare sampled ${nativeUi.sndFrames || 0} upstream Kiwi SND frames for about ${nativeUi.cadenceSampleMs || 0} ms.`
      : `Cloudflare Worker failed at ${nativeUi.stage || 'unknown-stage'}.`,
    totalElapsedMs:elapsed(requestStarted)
  });
}
