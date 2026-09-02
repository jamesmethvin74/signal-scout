(() => {
  if (window.__freqbeaconNormalSdrDiagnostics?.version) return;

  const VERSION = 'sdr-normal-session-diagnostics-v1';
  const started = performance.now();
  const decoder = new TextDecoder();
  const sessions = [];
  const rfEvents = [];
  const playerEvents = [];
  const socketSessions = new WeakMap();
  let assetCheck = null;

  const elapsed = () => Math.round(performance.now() - started);
  const iso = () => new Date().toISOString();

  function bytesFrom(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return null;
  }

  function playerSnapshot() {
    const panel = document.getElementById('sdrPlayer');
    return {
      capturedMs: elapsed(),
      exists: Boolean(panel),
      hidden: panel ? Boolean(panel.hidden) : null,
      status: panel?.querySelector('[data-sdr-status]')?.textContent?.trim() || '',
      station: panel?.querySelector('.sdr-player-title strong')?.textContent?.trim() || '',
      frequency: panel?.querySelector('[data-sdr-frequency]')?.textContent?.trim() || '',
      receiver: panel?.querySelector('[data-sdr-receiver-button-name]')?.textContent?.trim() || '',
      receiverMeta: panel?.querySelector('.sdr-receiver-button-main span')?.textContent?.trim() || '',
      mode: panel?.querySelector('[data-sdr-mode]')?.value || '',
      rssi: panel?.querySelector('[data-sdr-rssi]')?.textContent?.trim() || '',
      message: panel?.querySelector('[data-sdr-message]')?.textContent?.trim() || '',
      toggle: panel?.querySelector('[data-sdr-toggle]')?.textContent?.trim() || '',
      rfCanvasPresent: Boolean(panel?.querySelector('[data-sdr-rf-v2-canvas]')),
      rfCanvasVisible: (() => {
        const canvas = panel?.querySelector('[data-sdr-rf-v2-canvas]');
        if (!canvas) return false;
        const style = getComputedStyle(canvas);
        return style.display !== 'none' && style.visibility !== 'hidden';
      })(),
      visibility: document.visibilityState,
      online: navigator.onLine
    };
  }

  function pushPlayerEvent(reason) {
    const snapshot = { reason, ...playerSnapshot() };
    const previous = playerEvents[playerEvents.length - 1];
    const key = JSON.stringify([snapshot.status, snapshot.frequency, snapshot.receiver, snapshot.mode, snapshot.rssi, snapshot.message, snapshot.toggle, snapshot.rfCanvasPresent]);
    const previousKey = previous?._key || '';
    if (key === previousKey && reason === 'mutation') return;
    snapshot._key = key;
    playerEvents.push(snapshot);
    if (playerEvents.length > 80) playerEvents.splice(0, playerEvents.length - 80);
    renderSummary();
  }

  function parseSocketMeta(detail) {
    try {
      const url = new URL(String(detail?.url || detail?.socket?.url || ''), location.href);
      return {
        receiver: detail?.receiverId || url.searchParams.get('receiver') || '',
        stream: url.searchParams.get('stream') || 'SND',
        timestamp: url.searchParams.get('ts') || '',
        url: url.pathname + url.search
      };
    } catch {
      return { receiver: detail?.receiverId || '', stream: 'SND', timestamp: '', url: String(detail?.url || '') };
    }
  }

  function attachSnd(detail) {
    const socket = detail?.socket;
    if (!socket) return null;
    if (socketSessions.has(socket)) return socketSessions.get(socket);
    const meta = parseSocketMeta(detail);
    if (meta.stream && meta.stream !== 'SND') return null;

    const session = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      receiver: meta.receiver,
      timestamp: meta.timestamp,
      url: meta.url,
      createdMs: elapsed(),
      openMs: null,
      readyMs: null,
      firstAudioSignalMs: null,
      firstSndMs: null,
      lastSndMs: null,
      sampleRateMs: null,
      audioRateMs: null,
      sampleRate: null,
      audioRate: null,
      frames: { total: 0, msg: 0, snd: 0, pcm: 0, compressed: 0, bytes: 0 },
      maxSndGapMs: 0,
      gapsOver100Ms: 0,
      gapsOver500Ms: 0,
      serverState: null,
      messages: [],
      playerAudioDetail: null,
      error: null,
      close: null
    };
    sessions.push(session);
    if (sessions.length > 8) sessions.splice(0, sessions.length - 8);
    socketSessions.set(socket, session);

    socket.addEventListener('open', () => {
      session.openMs = elapsed();
      pushPlayerEvent('snd-open');
    });

    socket.addEventListener('message', async (event) => {
      let data = event.data;
      if (data instanceof Blob) {
        try { data = await data.arrayBuffer(); } catch { return; }
      }
      const bytes = bytesFrom(data);
      if (!bytes || bytes.length < 3) return;
      const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
      session.frames.total += 1;

      if (tag === 'MSG') {
        session.frames.msg += 1;
        let text = '';
        try { text = decoder.decode(bytes.subarray(4)); } catch {}
        const sampleRate = text.match(/(?:^|\s)sample_rate=([0-9.]+)/)?.[1];
        const audioRate = text.match(/(?:^|\s)audio_rate=([0-9]+)/)?.[1];
        if (sampleRate && session.sampleRate == null) {
          session.sampleRate = Number(sampleRate);
          session.sampleRateMs = elapsed();
        }
        if (audioRate && session.audioRate == null) {
          session.audioRate = Number(audioRate);
          session.audioRateMs = elapsed();
        }
        if (/(?:^|\s)too_busy=(?:1|\d+)(?:\s|$)/.test(text)) session.serverState = 'busy';
        if (/(?:^|\s)down=(?:1|\d+)(?:\s|$)/.test(text)) session.serverState = 'offline';
        if (/(?:^|\s)badp=([1-9]\d*)(?:\s|$)/.test(text)) session.serverState = 'bad-password';
        if (/reason_disabled=\S+/.test(text)) session.serverState = 'disabled';
        if (/camp_disconnect/.test(text)) session.serverState = 'camp-disconnect';
        if (text.trim() && session.messages.length < 16) session.messages.push(text.trim().slice(0, 420));
        return;
      }

      if (tag !== 'SND') return;
      const now = elapsed();
      session.frames.snd += 1;
      session.frames.bytes += bytes.byteLength;
      const flags = bytes.length >= 4 ? bytes[3] : 0;
      if (flags & 0x10) session.frames.compressed += 1;
      else session.frames.pcm += 1;
      if (session.firstSndMs == null) session.firstSndMs = now;
      if (session.lastSndMs != null) {
        const gap = now - session.lastSndMs;
        session.maxSndGapMs = Math.max(session.maxSndGapMs, gap);
        if (gap >= 100) session.gapsOver100Ms += 1;
        if (gap >= 500) session.gapsOver500Ms += 1;
      }
      session.lastSndMs = now;
      if (session.frames.snd === 1 || session.frames.snd % 50 === 0) renderSummary();
    });

    socket.addEventListener('error', () => {
      session.error = { at: iso(), elapsedMs: elapsed(), readyState: socket.readyState, player: playerSnapshot() };
      pushPlayerEvent('snd-error');
    });

    socket.addEventListener('close', (event) => {
      session.close = {
        at: iso(), elapsedMs: elapsed(), code: event.code || 0,
        reason: event.reason || '', wasClean: Boolean(event.wasClean),
        lastSndAgeMs: session.lastSndMs == null ? null : elapsed() - session.lastSndMs,
        player: playerSnapshot()
      };
      pushPlayerEvent('snd-close');
    });

    pushPlayerEvent('snd-created');
    return session;
  }

  window.addEventListener('freqbeacon:snd-created', (event) => attachSnd(event.detail));
  window.addEventListener('freqbeacon:snd-ready', (event) => {
    const session = socketSessions.get(event.detail?.socket) || attachSnd(event.detail);
    if (session) session.readyMs = elapsed();
    pushPlayerEvent('snd-ready');
  });
  window.addEventListener('freqbeacon:snd-audio', (event) => {
    const session = socketSessions.get(event.detail?.socket) || attachSnd(event.detail);
    if (session) {
      session.firstAudioSignalMs ??= elapsed();
      session.playerAudioDetail = {
        audioContextState: event.detail?.audioContextState || null,
        audioContextCurrentTime: event.detail?.audioContextCurrentTime ?? null,
        sampleRate: event.detail?.sampleRate ?? null,
        nextPlayTime: event.detail?.nextPlayTime ?? null
      };
    }
    pushPlayerEvent('snd-audio');
  });

  window.addEventListener('freqbeacon:rf-stage', (event) => {
    rfEvents.push({ at: iso(), elapsedMs: elapsed(), ...(event.detail || {}), player: playerSnapshot() });
    if (rfEvents.length > 100) rfEvents.splice(0, rfEvents.length - 100);
    pushPlayerEvent(`rf-${event.detail?.stage || 'stage'}`);
  });

  function currentReport() {
    return {
      version: VERSION,
      generatedAt: iso(),
      pageLoadedAt: new Date(Date.now() - elapsed()).toISOString(),
      href: location.href,
      userAgent: navigator.userAgent,
      serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
      assetCheck,
      currentPlayer: playerSnapshot(),
      sndSessions: sessions.map((session) => ({ ...session, frames: { ...session.frames } })),
      rfEvents: rfEvents.map((event) => ({ ...event })),
      playerEvents: playerEvents.map(({ _key, ...event }) => ({ ...event })),
      summary: summaryText()
    };
  }

  function summaryText() {
    const snd = sessions[sessions.length - 1];
    const rf = rfEvents[rfEvents.length - 1];
    const player = playerSnapshot();
    if (!snd) return `Waiting for SND session · player ${player.status || 'idle'} · RF ${rf?.stage || 'none'}`;
    const socketState = snd.close ? `closed ${snd.close.code}${snd.close.reason ? ` ${snd.close.reason}` : ''}` : (snd.openMs != null ? 'open' : 'opening');
    return `${snd.receiver || '?'} · ${socketState} · SND ${snd.frames.snd} (${snd.frames.pcm} PCM/${snd.frames.compressed} comp) · max gap ${Math.round(snd.maxSndGapMs)} ms · player ${player.status || '?'} · RF ${rf?.stage || 'none'}`;
  }

  function ensureUi() {
    const panel = document.getElementById('sdrPlayer');
    const body = panel?.querySelector('.sdr-player-body');
    if (!body) return;
    let box = body.querySelector('[data-sdr-normal-diagnostics]');
    if (!box) {
      box = document.createElement('div');
      box.dataset.sdrNormalDiagnostics = 'true';
      box.innerHTML = `
        <div data-sdr-normal-diagnostic-summary style="margin-top:9px;padding:9px 10px;border:1px solid rgba(78,188,232,.28);border-radius:8px;background:rgba(4,18,27,.55);color:#a8c2d1;font:11px/1.45 monospace;white-space:normal"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px">
          <button type="button" data-sdr-normal-copy style="min-height:38px;border:1px solid rgba(78,188,232,.55);border-radius:7px;background:#0b2636;color:#d8f3ff;font-weight:800">Copy report</button>
          <button type="button" data-sdr-normal-show style="min-height:38px;border:1px solid rgba(78,188,232,.55);border-radius:7px;background:#0b2636;color:#d8f3ff;font-weight:800">Show report</button>
        </div>
        <pre data-sdr-normal-report hidden style="max-height:38vh;overflow:auto;margin:8px 0 0;padding:9px;border:1px solid rgba(78,188,232,.22);border-radius:7px;background:#02080c;color:#b8ceda;font:10px/1.4 monospace;white-space:pre-wrap;word-break:break-word"></pre>`;
      const note = body.querySelector('.sdr-context-note');
      if (note) body.insertBefore(box, note);
      else body.appendChild(box);
    }
    renderSummary();
  }

  function renderSummary() {
    const summary = document.querySelector('[data-sdr-normal-diagnostic-summary]');
    if (summary) summary.textContent = summaryText();
    const pre = document.querySelector('[data-sdr-normal-report]');
    if (pre && !pre.hidden) pre.textContent = JSON.stringify(currentReport(), null, 2);
  }

  async function copyReport(button) {
    const text = JSON.stringify(currentReport(), null, 2);
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {}
    if (!copied) {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      try { copied = document.execCommand('copy'); } catch {}
      area.remove();
    }
    if (button) {
      const original = button.textContent;
      button.textContent = copied ? 'Copied' : 'Copy failed — use Show report';
      setTimeout(() => { button.textContent = original; }, 1800);
    }
  }

  document.addEventListener('click', (event) => {
    const copy = event.target.closest('[data-sdr-normal-copy]');
    if (copy) {
      event.preventDefault();
      event.stopPropagation();
      copyReport(copy);
      return;
    }
    const show = event.target.closest('[data-sdr-normal-show]');
    if (show) {
      event.preventDefault();
      event.stopPropagation();
      const pre = document.querySelector('[data-sdr-normal-report]');
      if (!pre) return;
      pre.hidden = !pre.hidden;
      show.textContent = pre.hidden ? 'Show report' : 'Hide report';
      if (!pre.hidden) pre.textContent = JSON.stringify(currentReport(), null, 2);
    }
  }, true);

  const observer = new MutationObserver(() => {
    ensureUi();
    pushPlayerEvent('mutation');
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  async function inspectAssets() {
    try {
      const stamp = Date.now();
      const [player, rf] = await Promise.all([
        fetch(`/sdr-player.js?normaldiag=${stamp}`, { cache: 'no-store' }),
        fetch(`/sdr-rf-v2.js?normaldiag=${stamp}`, { cache: 'no-store' })
      ]);
      assetCheck = {
        checkedAt: iso(),
        playerStatus: player.status,
        playerStartupHeader: player.headers.get('x-freqbeacon-sdr-player-startup') || 'MISSING',
        playerDiagnosticHeader: player.headers.get('x-freqbeacon-sdr-normal-diagnostics') || 'MISSING',
        rfStatus: rf.status,
        rfDiagnosticHeader: rf.headers.get('x-freqbeacon-rf-normal-diagnostics') || 'MISSING'
      };
    } catch (error) {
      assetCheck = { checkedAt: iso(), error: error?.message || String(error) };
    }
    renderSummary();
  }

  window.__freqbeaconNormalSdrDiagnostics = {
    version: VERSION,
    getReport: currentReport,
    copyReport: () => copyReport(null)
  };

  ensureUi();
  pushPlayerEvent('diagnostic-loaded');
  inspectAssets();
})();
