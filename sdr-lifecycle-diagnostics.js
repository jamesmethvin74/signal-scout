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

  const nowIso = () => new Date().toISOString();
  const perf = () => Math.round(performance.now());

  function readStore() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch {
      return {};
    }
  }

  function sessions() {
    const value = readStore().sessions;
    return Array.isArray(value) ? value : [];
  }

  function save(list) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: VERSION,
        generatedAt: nowIso(),
        assetCheck,
        sessions: list.slice(-MAX_SESSIONS)
      }));
    } catch {}
  }

  function snapshotPlayer() {
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

  function summary(session) {
    if (!session) return '';
    const frames = session.frames;
    const outcome = session.localClose
      ? `LOCAL CLOSE ${session.localClose.code ?? ''} ${session.localClose.reason || ''}`.trim()
      : (session.close ? `REMOTE CLOSE ${session.close.code} ${session.close.reason || ''}`.trim() : 'OPEN');
    return [
      session.receiver || '?',
      `open ${session.timings.openMs ?? '?'}ms`,
      `sample ${session.timings.sampleRateMs ?? '?'}ms`,
      `SND ${frames.snd} (${frames.uncompressed} PCM / ${frames.compressed} comp)`,
      `playerAudio ${session.playerGotAudio ? 'yes' : 'no'}`,
      outcome,
      `patch ${assetCheck?.nativeSndHeader || 'checking'}`
    ].join(' · ');
  }

  function ensureUi() {
    const panel = document.getElementById('sdrPlayer');
    if (!panel || panel.querySelector('[data-sdr-lifecycle-box]')) return;
    const message = panel.querySelector('[data-sdr-message]');
    if (!message) return;

    if (!document.getElementById('freqbeacon-sdr-lifecycle-style')) {
      const style = document.createElement('style');
      style.id = 'freqbeacon-sdr-lifecycle-style';
      style.textContent = `
        [data-sdr-lifecycle-box]{margin-top:8px;padding:8px 9px;border:1px solid rgba(95,208,255,.18);border-radius:8px;background:rgba(4,14,24,.62);color:#829aab;font:9px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}
        [data-sdr-lifecycle-copy]{margin-top:7px;min-height:32px;border:1px solid rgba(95,208,255,.42);border-radius:6px;padding:6px 9px;background:rgba(95,208,255,.08);color:#bdeeff;font:800 9px/1 system-ui,-apple-system,sans-serif}
      `;
      document.head.appendChild(style);
    }

    const box = document.createElement('div');
    box.dataset.sdrLifecycleBox = '1';
    box.hidden = true;
    box.innerHTML = '<div data-sdr-lifecycle-summary></div><button type="button" data-sdr-lifecycle-copy>Copy SDR diagnostic</button>';
    message.insertAdjacentElement('afterend', box);
    box.querySelector('[data-sdr-lifecycle-copy]').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify(window.__freqbeaconSdrLifecycleDiagnostics.getReport(), null, 2));
        const button = box.querySelector('[data-sdr-lifecycle-copy]');
        button.textContent = 'Copied';
        setTimeout(() => { button.textContent = 'Copy SDR diagnostic'; }, 1200);
      } catch {
        box.querySelector('[data-sdr-lifecycle-copy]').textContent = 'Copy failed';
      }
    });
  }

  function showSession(session) {
    ensureUi();
    latestSummary = summary(session);
    const box = document.querySelector('[data-sdr-lifecycle-box]');
    const text = box?.querySelector('[data-sdr-lifecycle-summary]');
    if (text && text.textContent !== latestSummary) text.textContent = latestSummary;
    if (box) box.hidden = false;
  }

  function persist(session, show = false) {
    if (!session) return;
    const list = sessions().filter((item) => item.id !== session.id);
    list.push(session);
    save(list);
    if (show) showSession(session);
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

  function bytesFrom(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return null;
  }

  function mark(session, key) {
    if (session.timings[key] == null) session.timings[key] = perf() - session.startedPerf;
  }

  function inspectSend(session, raw) {
    if (typeof raw !== 'string') return;
    const text = raw.trim();
    if (text.startsWith('SET auth ')) {
      session.sends.auth += 1;
      mark(session, 'authSentMs');
    } else if (text === 'SET compression=0') {
      session.sends.compression0 += 1;
      session.sends.lastCompression0Ms = perf() - session.startedPerf;
    } else if (text.startsWith('SET mod=')) {
      session.sends.tuning += 1;
      session.sends.lastTuneMs = perf() - session.startedPerf;
      session.sends.lastTune = text.slice(0, 180);
    } else if (text === 'SET keepalive') {
      session.sends.keepalive += 1;
      session.sends.lastKeepaliveMs = perf() - session.startedPerf;
    } else if (text.startsWith('SET AR OK')) {
      session.sends.audioRateAck += 1;
      session.sends.lastAudioRateAck = text;
    }
  }

  function inspectMessage(session, data) {
    const bytes = bytesFrom(data);
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
      if (text.trim() && session.messages.length < 10) session.messages.push(text.trim().slice(0, 320));
      return;
    }

    if (tag !== 'SND') return;
    session.frames.snd += 1;
    session.frames.sndBytes += bytes.byteLength;
    session.frames.lastSndMs = perf() - session.startedPerf;
    mark(session, 'firstSndMs');
    if (bytes.length >= 4) {
      const flags = bytes[3];
      const hex = `0x${flags.toString(16).padStart(2, '0')}`;
      if (session.frames.firstFlags == null) session.frames.firstFlags = hex;
      session.frames.lastFlags = hex;
      if (flags & 0x10) session.frames.compressed += 1;
      else session.frames.uncompressed += 1;
      if (flags & 0x80) session.frames.littleEndian += 1;
      else session.frames.bigEndian += 1;
    }
  }

  function newSession(meta) {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
      close:null
    };
  }

  if (typeof NativeSocket === 'function') {
    function LifecycleNativeSocket(url, protocols) {
      const socket = protocols === undefined ? new NativeSocket(url) : new NativeSocket(url, protocols);
      const meta = parseMeta(url);
      if (!meta || meta.stream !== 'SND') return socket;

      const session = newSession(meta);
      sessionBySocket.set(socket, session);
      persist(session);

      const nativeSend = socket.send.bind(socket);
      const nativeClose = socket.close.bind(socket);

      socket.send = function lifecycleSend(data) {
        inspectSend(session, data);
        return nativeSend(data);
      };

      socket.close = function lifecycleClose(code, reason) {
        if (!session.localClose) {
          session.localClose = {
            at: nowIso(),
            elapsedMs: perf() - session.startedPerf,
            code: code ?? null,
            reason: reason || '',
            player: snapshotPlayer(),
            stack: (() => { try { return new Error('FREQBEACON local SND close').stack || ''; } catch { return ''; } })()
          };
          persist(session, true);
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
        session.error = { at:nowIso(), elapsedMs:perf() - session.startedPerf, readyState:socket.readyState, player:snapshotPlayer() };
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
          player: snapshotPlayer()
        };
        persist(session, true);
        setTimeout(() => {
          session.afterClosePlayer = snapshotPlayer();
          persist(session, true);
        }, 0);
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
    save(sessions());
    if (assetCheck?.nativeSndHeader === 'player-patch-miss') {
      const fake = { receiver:'ASSET CHECK', timings:{}, frames:{snd:0,uncompressed:0,compressed:0}, playerGotAudio:false, localClose:null, close:null };
      showSession(fake);
    }
  }

  window.__freqbeaconSdrLifecycleDiagnostics = {
    version: VERSION,
    clear() {
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      latestSummary = '';
      const box = document.querySelector('[data-sdr-lifecycle-box]');
      if (box) box.hidden = true;
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
