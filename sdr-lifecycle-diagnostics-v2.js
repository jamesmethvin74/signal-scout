(() => {
  if (window.__freqbeaconSdrLifecycleV2?.version) return;

  const VERSION = 'sdr-lifecycle-diagnostics-v2';
  const STORAGE_KEY = 'freqbeacon:sdr-lifecycle:v2';
  const BaseSocket = window.__signalScoutNativeWebSocket || window.WebSocket;
  const decoder = new TextDecoder();
  const socketSessions = new WeakMap();
  const pageStarted = performance.now();
  const report = {
    version: VERSION,
    pageLoadedAt: new Date().toISOString(),
    href: location.href,
    userAgent: navigator.userAgent,
    standalone: matchMedia('(display-mode: standalone)').matches,
    serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
    baseSocketName: BaseSocket?.name || '',
    assetCheck: null,
    sessions: []
  };

  const elapsed = () => Math.round(performance.now() - pageStarted);
  const nowIso = () => new Date().toISOString();

  function playerSnapshot() {
    const panel = document.getElementById('sdrPlayer');
    return {
      exists: Boolean(panel),
      hidden: panel ? Boolean(panel.hidden) : null,
      status: panel?.querySelector('[data-sdr-status]')?.textContent?.trim() || '',
      receiver: panel?.querySelector('[data-sdr-receiver-button-name]')?.textContent?.trim() || '',
      frequency: panel?.querySelector('[data-sdr-frequency]')?.textContent?.trim() || '',
      message: panel?.querySelector('[data-sdr-message]')?.textContent?.trim() || '',
      toggle: panel?.querySelector('[data-sdr-toggle]')?.textContent?.trim() || '',
      visibility: document.visibilityState,
      online: navigator.onLine
    };
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...report, capturedAt: nowIso(), player: playerSnapshot() }));
    } catch {}
  }

  function lastSession() {
    return report.sessions[report.sessions.length - 1] || null;
  }

  function sessionSummary(session = lastSession()) {
    if (!session) {
      const marker = report.assetCheck?.nativeSndHeader || 'checking player patch';
      return `Diagnostic armed · no SND session yet · ${marker}`;
    }
    const close = session.localClose
      ? `LOCAL CLOSE ${session.localClose.code ?? ''} ${session.localClose.reason || ''}`.trim()
      : session.close
        ? `REMOTE CLOSE ${session.close.code} ${session.close.reason || ''}`.trim()
        : 'socket open';
    return `${session.receiver} · SND ${session.frames.snd} (${session.frames.pcm} PCM / ${session.frames.compressed} comp) · player audio ${session.playerAudio ? 'yes' : 'no'} · ${close}`;
  }

  function ensureUi() {
    const panel = document.getElementById('sdrPlayer');
    const message = panel?.querySelector('[data-sdr-message]');
    if (!panel || !message) return null;

    let box = panel.querySelector('[data-sdr-lifecycle-v2]');
    if (box) return box;

    if (!document.getElementById('freqbeacon-sdr-lifecycle-v2-style')) {
      const style = document.createElement('style');
      style.id = 'freqbeacon-sdr-lifecycle-v2-style';
      style.textContent = `
        [data-sdr-lifecycle-v2]{margin-top:9px;padding:9px 10px;border:1px solid rgba(95,208,255,.30);border-radius:9px;background:rgba(5,18,31,.78);color:#9bb2c3;font:9px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace}
        [data-sdr-lifecycle-v2-summary]{overflow-wrap:anywhere}
        [data-sdr-lifecycle-v2-copy]{display:block;width:100%;margin-top:8px;min-height:38px;border:1px solid rgba(95,208,255,.62);border-radius:7px;padding:8px 10px;background:rgba(95,208,255,.12);color:#d8f5ff;font:850 11px/1 system-ui,-apple-system,sans-serif}
      `;
      document.head.appendChild(style);
    }

    box = document.createElement('div');
    box.dataset.sdrLifecycleV2 = '1';
    box.innerHTML = '<div data-sdr-lifecycle-v2-summary>Diagnostic armed.</div><button type="button" data-sdr-lifecycle-v2-copy>Copy SDR diagnostic</button>';
    message.insertAdjacentElement('afterend', box);

    box.querySelector('[data-sdr-lifecycle-v2-copy]').addEventListener('click', async () => {
      const button = box.querySelector('[data-sdr-lifecycle-v2-copy]');
      const payload = JSON.stringify(window.__freqbeaconSdrLifecycleV2.getReport(), null, 2);
      let copied = false;
      try {
        await navigator.clipboard.writeText(payload);
        copied = true;
      } catch {}
      if (!copied) {
        try {
          const ta = document.createElement('textarea');
          ta.value = payload;
          ta.style.cssText = 'position:fixed;left:-9999px;top:0';
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          copied = document.execCommand('copy');
          ta.remove();
        } catch {}
      }
      button.textContent = copied ? 'Copied SDR diagnostic' : 'Copy failed — tap again';
      setTimeout(() => { button.textContent = 'Copy SDR diagnostic'; }, 1400);
    });
    return box;
  }

  function updateUi() {
    const box = ensureUi();
    const summary = box?.querySelector('[data-sdr-lifecycle-v2-summary]');
    if (summary) summary.textContent = sessionSummary();
  }

  function persist() {
    save();
    updateUi();
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

  function inspectMessage(session, data) {
    const bytes = bytesFrom(data);
    if (!bytes || bytes.length < 3) return;
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    session.frames.total += 1;
    session.frames.lastFrameMs = elapsed();

    if (tag === 'MSG') {
      session.frames.msg += 1;
      let text = '';
      try { text = decoder.decode(bytes.subarray(4)); } catch {}
      const sampleRate = text.match(/(?:^|\s)sample_rate=([0-9.]+)/)?.[1];
      const audioRate = text.match(/(?:^|\s)audio_rate=([0-9]+)/)?.[1];
      if (sampleRate && session.sampleRate == null) {
        session.sampleRate = Number(sampleRate);
        session.timings.sampleRateMs = elapsed();
      }
      if (audioRate) session.audioRate = Number(audioRate);
      if (/(?:^|\s)too_busy=(?:1|\d+)(?:\s|$)/.test(text)) session.serverState = 'busy';
      if (/(?:^|\s)down=(?:1|\d+)(?:\s|$)/.test(text)) session.serverState = 'offline';
      if (/(?:^|\s)badp=([1-9]\d*)(?:\s|$)/.test(text)) session.serverState = 'bad-password';
      if (/camp_disconnect/.test(text)) session.serverState = 'camp-disconnect';
      if (text.trim() && session.messages.length < 12) session.messages.push(text.trim().slice(0, 360));
      return;
    }

    if (tag !== 'SND') return;
    session.frames.snd += 1;
    session.frames.bytes += bytes.byteLength;
    session.frames.lastSndMs = elapsed();
    if (session.timings.firstSndMs == null) session.timings.firstSndMs = elapsed();
    const flags = bytes.length >= 4 ? bytes[3] : 0;
    session.frames.lastFlags = `0x${flags.toString(16).padStart(2, '0')}`;
    if (session.frames.firstFlags == null) session.frames.firstFlags = session.frames.lastFlags;
    if (flags & 0x10) session.frames.compressed += 1;
    else session.frames.pcm += 1;
  }

  function inspectSend(session, data) {
    if (typeof data !== 'string') return;
    const text = data.trim();
    if (text.startsWith('SET auth ')) session.sends.auth += 1;
    else if (text === 'SET compression=0') session.sends.compression0 += 1;
    else if (text.startsWith('SET mod=')) {
      session.sends.tune += 1;
      session.sends.lastTune = text.slice(0, 200);
    } else if (text === 'SET keepalive') {
      session.sends.keepalive += 1;
      session.sends.lastKeepaliveMs = elapsed();
    } else if (text.startsWith('SET AR OK')) {
      session.sends.audioRateAck += 1;
      session.sends.lastAudioRateAck = text;
    }
  }

  function makeSession(meta) {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: nowIso(),
      receiver: meta.receiver,
      timestamp: meta.timestamp,
      url: meta.url,
      timings: { createdMs:elapsed(), openMs:null, sampleRateMs:null, firstSndMs:null, playerReadyMs:null, playerAudioMs:null },
      frames: { total:0, msg:0, snd:0, bytes:0, pcm:0, compressed:0, firstFlags:null, lastFlags:null, lastFrameMs:null, lastSndMs:null },
      sends: { auth:0, compression0:0, tune:0, keepalive:0, audioRateAck:0, lastTune:null, lastKeepaliveMs:null, lastAudioRateAck:null },
      sampleRate:null,
      audioRate:null,
      serverState:null,
      messages:[],
      playerReady:false,
      playerAudio:false,
      error:null,
      localClose:null,
      close:null
    };
  }

  if (typeof BaseSocket === 'function') {
    function DiagnosticNativeSocket(url, protocols) {
      const socket = protocols === undefined ? new BaseSocket(url) : new BaseSocket(url, protocols);
      const meta = parseMeta(url);
      if (!meta || meta.stream !== 'SND') return socket;

      const session = makeSession(meta);
      report.sessions.push(session);
      if (report.sessions.length > 8) report.sessions.splice(0, report.sessions.length - 8);
      socketSessions.set(socket, session);
      persist();

      const originalSend = socket.send.bind(socket);
      const originalClose = socket.close.bind(socket);
      socket.send = function diagnosticSend(data) {
        inspectSend(session, data);
        return originalSend(data);
      };
      socket.close = function diagnosticClose(code, reason) {
        if (!session.localClose) {
          session.localClose = {
            at: nowIso(),
            elapsedMs: elapsed(),
            code: code ?? null,
            reason: reason || '',
            player: playerSnapshot(),
            stack: (() => { try { return new Error('FREQBEACON local SND close').stack || ''; } catch { return ''; } })()
          };
          persist();
        }
        return originalClose(code, reason);
      };

      socket.addEventListener('open', () => {
        session.timings.openMs = elapsed();
        persist();
      });
      socket.addEventListener('message', async (event) => {
        let data = event.data;
        if (data instanceof Blob) {
          try { data = await data.arrayBuffer(); } catch { return; }
        }
        inspectMessage(session, data);
        if (session.frames.snd <= 3 || session.frames.snd % 25 === 0 || session.frames.msg <= 3) persist();
      });
      socket.addEventListener('error', () => {
        session.error = { at:nowIso(), elapsedMs:elapsed(), readyState:socket.readyState, player:playerSnapshot() };
        persist();
      });
      socket.addEventListener('close', (event) => {
        session.close = {
          at: nowIso(),
          elapsedMs: elapsed(),
          code: event.code || 0,
          reason: event.reason || '',
          wasClean: Boolean(event.wasClean),
          localCloseAlreadyRecorded: Boolean(session.localClose),
          lastSndAgeMs: session.frames.lastSndMs == null ? null : elapsed() - session.frames.lastSndMs,
          player: playerSnapshot()
        };
        persist();
      });
      return socket;
    }

    DiagnosticNativeSocket.prototype = BaseSocket.prototype;
    Object.defineProperties(DiagnosticNativeSocket, {
      CONNECTING: { value:BaseSocket.CONNECTING },
      OPEN: { value:BaseSocket.OPEN },
      CLOSING: { value:BaseSocket.CLOSING },
      CLOSED: { value:BaseSocket.CLOSED }
    });
    window.__signalScoutNativeWebSocket = DiagnosticNativeSocket;
  }

  window.addEventListener('freqbeacon:snd-ready', (event) => {
    const session = socketSessions.get(event.detail?.socket);
    if (!session) return;
    session.playerReady = true;
    session.timings.playerReadyMs = elapsed();
    persist();
  });

  window.addEventListener('freqbeacon:snd-audio', (event) => {
    const session = socketSessions.get(event.detail?.socket);
    if (!session) return;
    session.playerAudio = true;
    session.timings.playerAudioMs = elapsed();
    persist();
  });

  async function inspectAssets() {
    try {
      const response = await fetch(`/sdr-player.js?v=10&diagv2=${Date.now()}`, { cache:'no-store' });
      const text = await response.text();
      report.assetCheck = {
        checkedAt: nowIso(),
        playerStatus: response.status,
        nativeSndHeader: response.headers.get('x-freqbeacon-native-snd') || 'MISSING',
        directRankingHeader: response.headers.get('x-freqbeacon-direct-ranking') || 'MISSING',
        hasNativeCtor: text.includes('window.__signalScoutNativeWebSocket || window.WebSocket'),
        hasNativeSocketConstruction: text.includes('new NativeSocket(socketUrl)'),
        hasSndCreatedEvent: text.includes('freqbeacon:snd-created'),
        hasSndAudioEvent: text.includes('freqbeacon:snd-audio'),
        loadedScripts: [...document.scripts].map((script) => script.src).filter(Boolean).filter((src) => /sdr-(?:player|rf|health|tuning|lifecycle|receiver)/.test(src))
      };
    } catch (error) {
      report.assetCheck = { checkedAt:nowIso(), error:error?.message || String(error) };
    }
    persist();
  }

  window.__freqbeaconSdrLifecycleV2 = {
    version: VERSION,
    getReport() {
      let legacy = null;
      try { legacy = window.__freqbeaconSdrLifecycleDiagnostics?.getReport?.() || null; } catch {}
      return {
        ...report,
        capturedAt: nowIso(),
        player: playerSnapshot(),
        summary: sessionSummary(),
        legacyV1: legacy
      };
    }
  };

  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  ensureUi();
  updateUi();
  save();
  inspectAssets();
})();
