(() => {
  if (window.__freqbeaconSdrLifecycleDiagnostics?.version) return;

  const VERSION = 'sdr-lifecycle-diagnostics-v1';
  const STORAGE_KEY = 'freqbeacon:sdr-lifecycle:v1';
  const MAX_SESSIONS = 8;
  const NativeSocket = window.__signalScoutNativeWebSocket;
  const decoder = new TextDecoder();
  const sessionBySocket = new WeakMap();
  let assetCheck = null;
  let latestSummary = '';

  function nowIso() { return new Date().toISOString(); }
  function perf() { return Math.round(performance.now()); }

  function readStore() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  function writeStore(sessions) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: VERSION,
        generatedAt: nowIso(),
        assetCheck,
        sessions: sessions.slice(-MAX_SESSIONS)
      }));
    } catch {}
  }

  function savedSessions() {
    const store = readStore();
    return Array.isArray(store.sessions) ? store.sessions : [];
  }

  function persist(session) {
    if (!session) return;
    const sessions = savedSessions().filter((item) => item.id !== session.id);
    sessions.push(session);
    writeStore(sessions);
    updateUi(session);
  }

  function parseMeta(rawUrl) {
    try {
      const url = new URL(String(rawUrl), location.href);
      if (url.origin !== location.origin || url.pathname !== '/api/sdr/ws') return null;
      return {
        receiver: url.searchParams.get('receiver') || '',
        stream: url.searchParams.get('stream') || '',
        timestamp: url.searchParams.get('ts') || '',
        url: url.pathname + url.search
      };
    } catch {
      return null;
    }
  }

  function playerSnapshot() {
    const panel = document.getElementById('sdrPlayer');
    return {
      status: panel?.querySelector('[data-sdr-status]')?.textContent?.trim() || '',
      receiver: panel?.querySelector('[data-sdr-receiver-button-name]')?.textContent?.trim() || '',
      frequency: panel?.querySelector('[data-sdr-frequency]')?.textContent?.trim() || '',
      message: panel?.querySelector('[data-sdr-message]')?.textContent?.trim() || '',
      toggle: panel?.querySelector('[data-sdr-toggle]')?.textContent?.trim() || '',
      visibility: document.visibilityState,
      online: navigator.onLine
    };
  }

  function frameBytes(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return null;
  }

  function mark(session, key) {
    if (session.timings[key] == null) session.timings[key] = perf() - session.startedPerf;
  }

  function inspectSend(session, raw) {
    if (!session || typeof raw !== 'string') return;
    const text = raw.trim();
    if (text.startsWith('SET auth ')) {
      session.sends.auth += 1;
      mark(session, 'authSentMs');
    } else if (text === 'SET compression=0') {
      session.sends.compression0 += 1;
      session.sends.lastCompression0Ms = perf() - session.startedPerf;
    } else if (text.startsWith('SET mod=')) {
      session.sends.tuning += 1;
      session.sends.lastTune = text.slice(0, 180);
      session.sends.lastTuneMs = perf() - session.startedPerf;
    } else if (text === 'SET keepalive') {
      session.sends.keepalive += 1;
      session.sends.lastKeepaliveMs = perf() - session.startedPerf;
    } else if (text.startsWith('SET AR OK')) {
      session.sends.audioRateAck += 1;
      session.sends.lastAudioRateAck = text;
    }
  }

  function inspectMessage(session, data) {
    const bytes = frameBytes(data);
    if (!bytes || bytes.length < 3) return;
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    session.frames.total += 1;
    session.frames.lastFrameMs = perf() - session.startedPerf;

    if (tag === 'MSG') {
      session.frames.msg += 1;
      let text = '';
      try { text = decoder.decode(bytes.subarray(4)); } catch {}
      const sampleRate = text.match(/(?:^|\s)sample_rate=([0-9.]+)/)?.[1];
      const audioRate = text.match(/(?:^|\s)audio_rate=([0-9]+)/)?.[1];
      if (sampleRate) {
        session.sampleRate = Number(sampleRate);
        mark(session, 'sampleRateMs');
      }
      if (audioRate) session.audioRate = Number(audioRate);
      if (/(?:^|\s)too_busy=(?:1|\d+)(?:\s|$)/.test(text)) session.serverState = 'busy';
      if (/(?:^|\s)down=(?:1|\d+)(?:\s|$)/.test(text)) session.serverState = 'offline';
      if (/(?:^|\s)badp=([1-9]\d*)(?:\s|$)/.test(text)) session.serverState = 'bad-password';
      if (/camp_disconnect/.test(text)) session.serverState = 'camp-disconnect';
      if (session.messages.length < 10 && text.trim()) session.messages.push(text.trim().slice(0, 320));
      return;
    }

    if (tag !== 'SND') return;
    session.frames.snd += 1;
    session.frames.sndBytes += bytes.byteLength;
    mark(session, 'firstSndMs');
    session.frames.lastSndMs = perf() - session.startedPerf;
    if (bytes.length >= 4) {
      const flags = bytes[3];
      if (session.frames.firstFlags == null) session.frames.firstFlags = `0x${flags.toString(16).padStart(2, '0')}`;
      session.frames.lastFlags = `0x${flags.toString(16).padStart(2, '0')}`;
      if (flags & 0x10) session.frames.compressed += 1;
      else session.frames.uncompressed += 1;
      if (flags & 0x80) session.frames.littleEndian += 1;
      else session.frames.bigEndian += 1;
    }
  }

  function summaryFor(session) {
    if (!session) return '';
    const f = session.frames;
    const close = session.close;
    const local = session.localClose;
    const patch = assetCheck?.nativeSndHeader || 'asset?';
    return [
      `Diag ${session.receiver || '?'}`,
      `open ${session.timings.openMs ?? '?'}ms`,
      `sample ${session.timings.sampleRateMs ?? '?'}ms`,
      `SND ${f.snd} (${f.uncompressed} PCM / ${f.compressed} comp)`,
      `playerAudio ${session.playerGotAudio ? 'yes' : 'no'}`,
      local ? `LOCAL CLOSE ${local.code ?? ''} ${local.reason || ''}`.trim() : (close ? `REMOTE CLOSE ${close.code} ${close.reason || ''}`.trim() : 'open'),
      `patch ${patch}`
    ].join(' · ');
  }

  function ensureUi() {
    const panel = document.getElementById('sdrPlayer');
    if (!panel || panel.querySelector('[data-sdr-lifecycle-box]')) return;
    const message = panel.querySelector('[data-sdr-message]');
    if (!message) return;

    const box = document.createElement('div');
    box.dataset.sdrLifecycleBox = '1';
    box.hidden = true;
    box.innerHTML = '<div data-sdr-lifecycle-summary></div><button type="button" data-sdr-lifecycle-copy>Copy SDR diagnostic</button>';
    message.insertAdjacentElement('afterend', box);

    if (!document.getElementById('freqbeacon-sdr-lifecycle-style')) {
      const style = document.createElement('style');
      style.id = 'freqbeacon-sdr-lifecycle-style';
      style.textContent = `
        [data-sdr-lifecycle-box]{margin-top:8px;padding:8px 9px;border:1px solid rgba(95,208,255,.18);border-radius:8px;background:rgba(4,14,24,.62);color:#829aab;font:9px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}
        [data-sdr-lifecycle-copy]{margin-top:7px;min-height:32px;border:1px solid rgba(95,208,255,.42);border-radius:6px;padding:6px 9px;background:rgba(95,208,255,.08);color:#bdeeff;font:800 9px/1 system-ui,-apple-system,sans-serif}
      `;
      document.head.appendChild(style);
    }

    box.querySelector('[data-sdr-lifecycle-copy]').addEventListener('click', async () => {
      const report = window.__freqbeaconSdrLifecycleDiagnostics.getReport();
      try {
        await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
        const button = box.querySelector('[data-sdr-lifecycle-copy]');
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = 'Copy SDR diagnostic'; }, 1200);
      } catch {
        box.querySelector('[data-sdr-lifecycle-copy]').textContent = 'Copy failed';
      }
    });
  }

  function updateUi(session) {
    ensureUi();
    const panel = document.getElementById('sdrPlayer');
    const box = panel?.querySelector('[data-sdr-lifecycle-box]');
    if (!box) return;
    latestSummary = summaryFor(session);
    box.querySelector('[data-sdr-lifecycle-summary]').textContent = latestSummary;
    const status = panel.querySelector('[data-sdr-status]')?.textContent?.trim().toLowerCase() || '';
    const terminal = ['disconnected', 'unavailable', 'stopped'].includes(status) || Boolean(session?.close || session?.localClose);
    box.hidden = !terminal;
  }

  async function inspectServedPlayer() {
    try {
      const response = await fetch(`/sdr-player.js?v=10&lifecycle=${Date.now()}`, { cache:'no-store' });
      const text = await response.text();
      assetCheck = {
        checkedAt: nowIso(),
        status: response.status,
        nativeSndHeader: response.headers.get('x-freqbeacon-native-snd') || 'MISSING',
        directRankingHeader: response.headers.get('x-freqbeacon-direct-ranking') || 'MISSING',
        hasNativeCtor: text.includes('window.__signalScoutNativeWebSocket || window.WebSocket'),
        hasNativeSocketConstruction: text.includes('new NativeSocket(socketUrl)'),
        hasSndCreatedEvent: text.includes('freqbeacon:snd-created'),
        hasSndAudioEvent: text.includes('freqbeacon:snd-audio')
      };
    } catch (error) {
      assetCheck = { checkedAt:nowIso(), error:error?.message || String(error) };
    }
    writeStore(savedSessions());
  }

  function createSession(meta) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
      id,
      version: VERSION,
      createdAt: nowIso(),
      startedPerf: perf(),
      receiver: meta.receiver,
      stream: meta.stream,
      timestamp: meta.timestamp,
      url: meta.url,
      timings: { openMs:null, authSentMs:null, sampleRateMs:null, firstSndMs:null, playerReadyMs:null, playerAudioMs:null },
      frames: { total:0, msg:0, snd:0, sndBytes:0, compressed:0, uncompressed:0, littleEndian:0, bigEndian:0, firstFlags:null, lastFlags:null, lastFrameMs:null, lastSndMs:null },
      sends: { auth:0, compression0:0, tuning:0, keepalive:0, audioRateAck:0, lastCompression0Ms:null, lastKeepaliveMs:null, lastTuneMs:null, lastTune:null, lastAudioRateAck:null },
      sampleRate:null,
      audioRate:null,
      serverState:null,
      messages:[],
      playerReady:false,
      playerGotAudio:false,
      error:null,
      localClose:null,
      close:null,
      finalPlayer:null
    };
  }

  if (typeof NativeSocket === 'function') {
    function LifecycleNativeSocket(url, protocols) {
      const socket = protocols === undefined ? new NativeSocket(url) : new NativeSocket(url, protocols);
      const meta = parseMeta(url);
      if (!meta || meta.stream !== 'SND') return socket;

      const session = createSession(meta);
      sessionBySocket.set(socket, session);
      persist(session);

      const nativeSend = socket.send.bind(socket);
      const nativeClose = socket.close.bind(socket);

      socket.send = function lifecycleSend(data) {
        inspectSend(session, data);
        persist(session);
        return nativeSend(data);
      };

      socket.close = function lifecycleClose(code, reason) {
        if (!session.localClose) {
          session.localClose = {
            at: nowIso(),
            elapsedMs: perf() - session.startedPerf,
            code: code ?? null,
            reason: reason || '',
            player: playerSnapshot(),
            stack: (() => { try { return new Error('FREQBEACON local SND close').stack || ''; } catch { return ''; } })()
          };
          persist(session);
        }
        return nativeClose(code, reason);
      };

      socket.addEventListener('open', () => {
        mark(session, 'openMs');
        persist(session);
      });
      socket.addEventListener('message', async (event) => {
        let data = event.data;
        if (data instanceof Blob) {
          try { data = await data.arrayBuffer(); } catch { return; }
        }
        inspectMessage(session, data);
        if (session.frames.snd <= 3 || session.frames.snd % 25 === 0 || session.frames.msg <= 3) persist(session);
      });
      socket.addEventListener('error', () => {
        session.error = { at:nowIso(), elapsedMs:perf() - session.startedPerf, readyState:socket.readyState, player:playerSnapshot() };
        persist(session);
      });
      socket.addEventListener('close', (event) => {
        session.close = {
          at: nowIso(),
          elapsedMs: perf() - session.startedPerf,
          code: event.code || 0,
          reason: event.reason || '',
          wasClean: Boolean(event.wasClean),
          localCloseAlreadyRecorded: Boolean(session.localClose),
          lastSndAgeMs: session.frames.lastSndMs == null ? null : (perf() - session.startedPerf - session.frames.lastSndMs),
          player: playerSnapshot()
        };
        session.finalPlayer = playerSnapshot();
        persist(session);
      });

      return socket;
    }

    LifecycleNativeSocket.prototype = NativeSocket.prototype;
    Object.defineProperties(LifecycleNativeSocket, {
      CONNECTING: { value:NativeSocket.CONNECTING },
      OPEN: { value:NativeSocket.OPEN },
      CLOSING: { value:NativeSocket.CLOSING },
      CLOSED: { value:NativeSocket.CLOSED }
    });
    window.__signalScoutNativeWebSocket = LifecycleNativeSocket;
  }

  window.addEventListener('freqbeacon:snd-ready', (event) => {
    const session = sessionBySocket.get(event.detail?.socket);
    if (!session) return;
    session.playerReady = true;
    mark(session, 'playerReadyMs');
    persist(session);
  });

  window.addEventListener('freqbeacon:snd-audio', (event) => {
    const session = sessionBySocket.get(event.detail?.socket);
    if (!session) return;
    session.playerGotAudio = true;
    mark(session, 'playerAudioMs');
    persist(session);
  });

  document.addEventListener('visibilitychange', () => {
    const sessions = savedSessions();
    const latest = sessions[sessions.length - 1];
    if (!latest || latest.close) return;
    latest.visibilityEvents ||= [];
    latest.visibilityEvents.push({ at:nowIso(), elapsedMs:perf() - latest.startedPerf, state:document.visibilityState });
    persist(latest);
  });

  const observer = new MutationObserver(() => {
    ensureUi();
    const sessions = savedSessions();
    const latest = sessions[sessions.length - 1];
    if (latest) updateUi(latest);
  });
  observer.observe(document.documentElement, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['class','hidden'] });

  window.__freqbeaconSdrLifecycleDiagnostics = {
    version: VERSION,
    clear() {
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      latestSummary = '';
    },
    getReport() {
      const store = readStore();
      return {
        version: VERSION,
        generatedAt: nowIso(),
        location: location.href,
        userAgent: navigator.userAgent,
        standalone: matchMedia('(display-mode: standalone)').matches,
        assetCheck: store.assetCheck || assetCheck,
        latestSummary,
        sessions: Array.isArray(store.sessions) ? store.sessions : []
      };
    }
  };

  ensureUi();
  inspectServedPlayer();
})();
