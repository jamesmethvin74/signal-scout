(() => {
  if (window.__freqbeaconSdrAudioTiming?.version) return;

  const VERSION = 'sdr-audio-timing-diagnostics-v1';
  const decoder = new TextDecoder();
  const sessions = new WeakMap();
  let active = null;
  let longTaskCount = 0;
  let longTaskMaxMs = 0;

  function bytesFrom(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return null;
  }

  function snapshot() {
    if (!active) return { version: VERSION, receiverId: '', sndFrames: 0, maxSndGapMs: 0, gapsOver70Ms: 0, gapsOver100Ms: 0, expectedFrameMs: null, longTaskCount, longTaskMaxMs };
    return {
      version: VERSION,
      receiverId: active.receiverId,
      sndFrames: active.sndFrames,
      maxSndGapMs: Math.round(active.maxSndGapMs),
      gapsOver70Ms: active.gapsOver70Ms,
      gapsOver100Ms: active.gapsOver100Ms,
      expectedFrameMs: Number.isFinite(active.expectedFrameMs) ? Number(active.expectedFrameMs.toFixed(1)) : null,
      sampleRate: active.sampleRate,
      lastSndAgeMs: active.lastSndAt == null ? null : Math.round(performance.now() - active.lastSndAt),
      longTaskCount,
      longTaskMaxMs: Math.round(longTaskMaxMs),
      likelyMainThreadStarvation: active.gapsOver100Ms > 0 || longTaskMaxMs >= 80
    };
  }

  function updateDiagnosticStatus() {
    const el = document.querySelector('[data-sdr-diagnostic-status-v5]');
    if (!el || !active) return;
    const s = snapshot();
    const starvation = s.likelyMainThreadStarvation ? ' · MAIN-THREAD JITTER' : '';
    el.textContent = `${active.receiverId || '?'} · SND ${s.sndFrames} · max gap ${s.maxSndGapMs}ms · >100ms ${s.gapsOver100Ms} · long task ${s.longTaskMaxMs}ms${starvation}`;
  }

  function attach(detail) {
    const socket = detail?.socket;
    if (!socket || sessions.has(socket)) return;
    const session = { socket, receiverId: detail?.receiverId || '', sampleRate: 12000, sndFrames: 0, lastSndAt: null, maxSndGapMs: 0, gapsOver70Ms: 0, gapsOver100Ms: 0, expectedFrameMs: null };
    sessions.set(socket, session);
    active = session;
    longTaskCount = 0;
    longTaskMaxMs = 0;

    socket.addEventListener('message', async (event) => {
      let data = event.data;
      if (data instanceof Blob) {
        try { data = await data.arrayBuffer(); } catch { return; }
      }
      const bytes = bytesFrom(data);
      if (!bytes || bytes.length < 3) return;
      const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
      if (tag === 'MSG') {
        try {
          const text = decoder.decode(bytes.subarray(4));
          const rate = Number(text.match(/(?:^|\s)sample_rate=([0-9.]+)/)?.[1]);
          if (Number.isFinite(rate) && rate > 1000) session.sampleRate = rate;
        } catch {}
        return;
      }
      if (tag !== 'SND' || bytes.length < 11) return;

      const now = performance.now();
      const flags = bytes[3] || 0;
      if (!(flags & 0x10)) {
        const audioBytes = Math.max(0, bytes.length - 10);
        const samples = Math.floor(audioBytes / 2);
        if (samples > 0) session.expectedFrameMs = samples / session.sampleRate * 1000;
      }
      if (session.lastSndAt != null) {
        const gap = now - session.lastSndAt;
        session.maxSndGapMs = Math.max(session.maxSndGapMs, gap);
        if (gap >= 70) session.gapsOver70Ms += 1;
        if (gap >= 100) session.gapsOver100Ms += 1;
      }
      session.lastSndAt = now;
      session.sndFrames += 1;
      if (session.sndFrames <= 5 || session.sndFrames % 10 === 0) updateDiagnosticStatus();
    });

    socket.addEventListener('close', updateDiagnosticStatus, { once: true });
    updateDiagnosticStatus();
  }

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTaskCount += 1;
        longTaskMaxMs = Math.max(longTaskMaxMs, entry.duration || 0);
      }
      updateDiagnosticStatus();
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {}

  window.addEventListener('freqbeacon:snd-created', (event) => attach(event.detail));

  function reportText() {
    let base = {};
    try { base = window.__freqbeaconSdrLifecycleV3?.getReport?.() || {}; } catch {}
    return JSON.stringify({ ...base, audioTiming: snapshot() }, null, 2);
  }

  function textareaFor(button) {
    return button.closest('[data-sdr-diagnostic-control-v5]')?.querySelector('[data-sdr-diagnostic-report-v5]') || null;
  }

  async function copyReport(button) {
    const text = reportText();
    let copied = false;
    try { await navigator.clipboard?.writeText?.(text); copied = true; } catch {}
    if (!copied) {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01;z-index:2147483647';
      document.body.appendChild(area);
      area.focus(); area.select();
      try { copied = document.execCommand('copy'); } catch {}
      area.remove();
    }
    button.textContent = copied ? 'Copied — paste into ChatGPT' : 'Copy blocked — use Show report';
    setTimeout(() => { button.textContent = 'Copy report'; }, 2200);
  }

  function toggleReport(button) {
    const area = textareaFor(button);
    if (!area) return;
    if (!area.hidden) {
      area.hidden = true;
      button.textContent = 'Show report';
      return;
    }
    area.value = reportText();
    area.hidden = false;
    button.textContent = 'Hide report';
    area.scrollTop = 0;
  }

  document.addEventListener('click', (event) => {
    const copy = event.target.closest?.('[data-sdr-diagnostic-copy-v6]');
    if (copy) {
      event.preventDefault(); event.stopPropagation(); copyReport(copy); return;
    }
    const show = event.target.closest?.('[data-sdr-diagnostic-show-v5]');
    if (show) {
      event.preventDefault(); event.stopPropagation(); toggleReport(show);
    }
  }, true);

  window.__freqbeaconSdrAudioTiming = { version: VERSION, getReport: snapshot };
})();
