(() => {
  const BaseWebSocket = window.WebSocket;
  const decoder = new TextDecoder();
  const WF_BINS = 1024;
  const RF_TIMEOUT_MS = 12000;
  const state = {
    sndSocket: null,
    wfSocket: null,
    keepaliveTimer: null,
    timeoutTimer: null,
    generation: 0,
    targetKHz: null,
    centerKHz: null,
    spanKHz: 29.296875,
    zoom: 10,
    gotFrame: false,
    canvas: null,
    unsupportedFrameLength: null
  };

  window.__SIGNAL_SCOUT_REAL_RF__ = true;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function parseSocketUrl(raw) {
    try {
      const url = new URL(String(raw), window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== '/api/sdr/ws') return null;
      return {
        receiverId: url.searchParams.get('receiver') || '',
        stream: url.searchParams.get('stream') || 'SND',
        timestamp: url.searchParams.get('ts') || ''
      };
    } catch {
      return null;
    }
  }

  function currentFrequencyKHz() {
    const text = document.querySelector('[data-sdr-frequency]')?.textContent || '';
    const match = text.match(/([0-9][0-9,.]*)\s*kHz/i);
    if (!match) return null;
    const value = Number(match[1].replace(/,/g, ''));
    return Number.isFinite(value) ? value : null;
  }

  function currentMode() {
    const value = String(document.querySelector('[data-sdr-mode]')?.value || 'am').toLowerCase();
    if (value === 'usb' || value === 'lsb') return value;
    return value === 'sam' ? 'sam' : 'am';
  }

  function zoomForMode(mode) {
    return mode === 'usb' || mode === 'lsb' ? 11 : 10;
  }

  function formatAxisFrequency(kHz) {
    if (!Number.isFinite(kHz)) return '--';
    if (kHz >= 1000) return `${(kHz / 1000).toFixed(3)} MHz`;
    return `${kHz.toFixed(kHz >= 100 ? 1 : 2)} kHz`;
  }

  function messageEl() {
    return document.querySelector('[data-sdr-message]');
  }

  function setPlayerMessage(text, isError = false) {
    const el = messageEl();
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-error', isError);
  }

  function audioIsLive() {
    return String(document.querySelector('[data-sdr-status]')?.textContent || '').trim().toLowerCase() === 'live rf';
  }

  function setRfMessage(text, isError = false) {
    if (audioIsLive()) setPlayerMessage(text, isError);
  }

  function ensureCanvas() {
    const wrap = document.querySelector('.sdr-spectrum-wrap');
    const original = wrap?.querySelector('[data-sdr-canvas]');
    if (!wrap || !original) return null;

    wrap.style.position = 'relative';
    original.style.opacity = '0';

    let canvas = wrap.querySelector('[data-sdr-rf-canvas]');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.dataset.sdrRfCanvas = 'true';
      canvas.setAttribute('aria-label', 'Live KiwiSDR RF spectrum and waterfall');
      canvas.style.setProperty('position', 'absolute', 'important');
      canvas.style.setProperty('inset', '0', 'important');
      canvas.style.setProperty('width', '100%', 'important');
      canvas.style.setProperty('height', '100%', 'important');
      canvas.style.setProperty('display', 'block', 'important');
      canvas.style.setProperty('z-index', '4', 'important');
      canvas.style.setProperty('pointer-events', 'none', 'important');
      wrap.appendChild(canvas);
    }

    const label = wrap.querySelector('.sdr-spectrum-label');
    if (label) {
      label.textContent = 'Live RF spectrum / waterfall';
      label.style.setProperty('z-index', '5', 'important');
    }

    state.canvas = canvas;
    return canvas;
  }

  function canvasMetrics(canvas) {
    const wrap = canvas.parentElement;
    const rect = wrap?.getBoundingClientRect() || canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const cssWidth = Math.max(300, rect.width || 300);
    const cssHeight = Math.max(150, rect.height || 150);
    const width = Math.round(cssWidth * dpr);
    const height = Math.round(cssHeight * dpr);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return { width, height, dpr };
  }

  function drawStatus(label, detail = '') {
    const canvas = ensureCanvas();
    if (!canvas) return;
    const { width, height, dpr } = canvasMetrics(canvas);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#06111a';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(138,200,242,.12)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += width / 8) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y <= height; y += height / 5) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.fillStyle = '#b8dff7';
    ctx.font = `700 ${10 * dpr}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(label, width / 2, height / 2 - 4 * dpr);
    if (detail) {
      ctx.fillStyle = 'rgba(184,223,247,.65)';
      ctx.font = `${8 * dpr}px monospace`;
      ctx.fillText(detail, width / 2, height / 2 + 14 * dpr);
    }
  }

  function rfColor(t) {
    const n = clamp(t, 0, 1);
    const stops = [
      [0.00, [3, 10, 18]], [0.18, [9, 35, 75]], [0.36, [0, 105, 168]],
      [0.54, [0, 184, 185]], [0.70, [70, 208, 121]], [0.84, [225, 213, 71]],
      [0.94, [242, 120, 42]], [1.00, [255, 239, 226]]
    ];
    for (let i = 1; i < stops.length; i += 1) {
      if (n <= stops[i][0]) {
        const [p0, c0] = stops[i - 1];
        const [p1, c1] = stops[i];
        const mix = (n - p0) / (p1 - p0 || 1);
        return c0.map((v, j) => Math.round(v + (c1[j] - v) * mix));
      }
    }
    return stops[stops.length - 1][1];
  }

  function renderFrame(samples) {
    if (!samples || samples.length < WF_BINS) return;
    const canvas = ensureCanvas();
    if (!canvas) return;
    const { width, height, dpr } = canvasMetrics(canvas);
    const ctx = canvas.getContext('2d');
    const bins = samples.subarray(0, WF_BINS);
    const db = Array.from(bins, b => b - 255);
    const sorted = [...db].sort((a, b) => a - b);
    const noise = sorted[Math.floor(sorted.length * 0.25)] ?? -120;
    const peak = sorted[Math.floor(sorted.length * 0.995)] ?? -70;
    const minDb = clamp(noise - 10, -155, -80);
    const maxDb = Math.max(minDb + 42, clamp(peak + 5, -105, -20));
    const range = maxDb - minDb;
    const spectrumH = Math.round(height * 0.56);
    const waterfallTop = spectrumH + 1;
    const waterfallH = height - waterfallTop;

    if (!state.gotFrame) {
      ctx.fillStyle = '#06111a';
      ctx.fillRect(0, 0, width, height);
    }

    if (waterfallH > 3) {
      ctx.drawImage(canvas, 0, waterfallTop, width, Math.max(1, waterfallH - 2), 0, waterfallTop + 2, width, Math.max(1, waterfallH - 2));
      const row = ctx.createImageData(width, 2);
      for (let x = 0; x < width; x += 1) {
        const bi = Math.min(WF_BINS - 1, Math.floor(x / Math.max(1, width - 1) * (WF_BINS - 1)));
        const [r, g, b] = rfColor((db[bi] - minDb) / range);
        for (let yy = 0; yy < 2; yy += 1) {
          const p = (yy * width + x) * 4;
          row.data[p] = r; row.data[p + 1] = g; row.data[p + 2] = b; row.data[p + 3] = 255;
        }
      }
      ctx.putImageData(row, 0, waterfallTop);
    }

    ctx.fillStyle = '#06111a';
    ctx.fillRect(0, 0, width, spectrumH);
    ctx.strokeStyle = 'rgba(138,200,242,.10)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += width / 8) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, spectrumH); ctx.stroke();
    }
    for (let y = 0; y <= spectrumH; y += spectrumH / 4) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    ctx.beginPath();
    for (let i = 0; i < WF_BINS; i += 1) {
      const x = i / (WF_BINS - 1) * width;
      const n = clamp((db[i] - minDb) / range, 0, 1);
      const y = spectrumH - 9 * dpr - n * (spectrumH - 20 * dpr);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#8ac8f2';
    ctx.lineWidth = Math.max(1, 1.25 * dpr);
    ctx.stroke();

    const startKHz = state.centerKHz - state.spanKHz / 2;
    const stopKHz = state.centerKHz + state.spanKHz / 2;
    if (Number.isFinite(state.targetKHz)) {
      const markerX = (state.targetKHz - startKHz) / state.spanKHz * width;
      if (markerX >= 0 && markerX <= width) {
        ctx.strokeStyle = 'rgba(242,247,250,.82)';
        ctx.beginPath(); ctx.moveTo(markerX, 15 * dpr); ctx.lineTo(markerX, spectrumH); ctx.stroke();
      }
    }

    ctx.fillStyle = 'rgba(203,221,233,.72)';
    ctx.font = `${8 * dpr}px monospace`;
    ctx.textAlign = 'left'; ctx.fillText(formatAxisFrequency(startKHz), 5 * dpr, spectrumH - 5 * dpr);
    ctx.textAlign = 'center'; ctx.fillText(formatAxisFrequency(state.centerKHz), width / 2, spectrumH - 5 * dpr);
    ctx.textAlign = 'right'; ctx.fillText(formatAxisFrequency(stopKHz), width - 5 * dpr, spectrumH - 5 * dpr);

    state.gotFrame = true;
    window.clearTimeout(state.timeoutTimer);
    const label = document.querySelector('.sdr-spectrum-label');
    if (label) label.textContent = `Live RF spectrum / waterfall · ${state.spanKHz.toFixed(1)} kHz span`;
    setRfMessage('Actual receiver audio · RF spectrum and waterfall are live from this receiver.');
  }

  function sendWf(message) {
    if (state.wfSocket?.readyState === BaseWebSocket.OPEN) {
      try { state.wfSocket.send(message); } catch {}
    }
  }

  function configureWaterfall() {
    const target = currentFrequencyKHz();
    if (!Number.isFinite(target)) return;
    const mode = currentMode();
    const zoom = zoomForMode(mode);
    const maxKHz = 30000;
    const span = maxKHz / (2 ** zoom);
    const center = clamp(target, span / 2, maxKHz - span / 2);
    state.targetKHz = target;
    state.centerKHz = center;
    state.spanKHz = span;
    state.zoom = zoom;
    state.gotFrame = false;
    state.unsupportedFrameLength = null;

    sendWf('SET ident_user=SignalScout');
    sendWf('SERVER DE CLIENT SignalScout W/F');
    sendWf('SET wf_comp=0');
    sendWf('SET send_dB=1');
    sendWf(`SET zoom=${zoom} cf=${center.toFixed(3)}`);
    sendWf('SET maxdb=-10 mindb=-130');
    sendWf('SET interp=13');
    sendWf('SET wf_speed=2');
    sendWf('SET keepalive');
    drawStatus('WAITING FOR RF DATA', `${formatAxisFrequency(center)} · ${span.toFixed(1)} kHz span`);
  }

  function msgText(bytes) {
    return decoder.decode(bytes.subarray(4));
  }

  function failureFromMsg(text) {
    if (/(?:^|\s)too_busy=(?:1|\d+)(?:\s|$)/.test(text)) return 'RF WATERFALL BUSY';
    if (/(?:^|\s)down=1(?:\s|$)/.test(text)) return 'RF RECEIVER OFFLINE';
    if (/(?:^|\s)badp=\d+(?:\s|$)/.test(text)) return 'RF ACCESS DENIED';
    if (/(?:^|\s)reason_disabled=\S+/.test(text)) return 'RF WATERFALL DISABLED';
    if (/(?:^|\s)camp_disconnect=\S+/.test(text)) return 'RF SESSION CLOSED';
    return null;
  }

  function waterfallSamples(bytes) {
    if (bytes.length === 4 + WF_BINS) return bytes.subarray(4, 4 + WF_BINS);
    if (bytes.length === 16 + WF_BINS) return bytes.subarray(16, 16 + WF_BINS);
    // A few compatible servers add small metadata headers. With compression
    // explicitly disabled, the final 1024 bytes are still the direct bins.
    if (bytes.length > 4 + WF_BINS && bytes.length <= 64 + WF_BINS) {
      return bytes.subarray(bytes.length - WF_BINS);
    }
    return null;
  }

  function handleBytes(bytes) {
    if (!bytes || bytes.length < 4) return;
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    if (tag === 'MSG') {
      const text = msgText(bytes);
      const failure = failureFromMsg(text);
      if (failure) {
        drawStatus(failure);
        setRfMessage(`Actual receiver audio is live. ${failure.toLowerCase()}.`, true);
        return;
      }
      if (/(?:^|\s)wf_setup(?:=\S*)?(?:\s|$)/.test(text)) configureWaterfall();
      return;
    }
    if (tag !== 'W/F') return;
    const samples = waterfallSamples(bytes);
    if (!samples) {
      if (state.unsupportedFrameLength !== bytes.length) {
        state.unsupportedFrameLength = bytes.length;
        drawStatus('UNSUPPORTED RF FRAME', `${bytes.length} bytes · requested uncompressed W/F`);
        setRfMessage(`Actual receiver audio is live. RF data arrived, but this receiver returned an unsupported ${bytes.length}-byte waterfall frame.`, true);
      }
      return;
    }
    renderFrame(samples);
  }

  function handleMessage(event) {
    if (event.data instanceof ArrayBuffer) handleBytes(new Uint8Array(event.data));
    else if (event.data instanceof Blob) event.data.arrayBuffer().then(buffer => handleBytes(new Uint8Array(buffer))).catch(() => {});
    else if (typeof event.data === 'string') handleBytes(new TextEncoder().encode(event.data));
  }

  function closeWaterfall() {
    window.clearInterval(state.keepaliveTimer);
    window.clearTimeout(state.timeoutTimer);
    state.keepaliveTimer = null;
    state.timeoutTimer = null;
    const socket = state.wfSocket;
    state.wfSocket = null;
    if (socket) {
      socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null;
      try { socket.close(1000, 'Signal Scout RF close'); } catch {}
    }
    state.gotFrame = false;
  }

  function startWaterfall(meta, sndSocket) {
    const generation = ++state.generation;
    closeWaterfall();
    state.sndSocket = sndSocket;
    state.targetKHz = currentFrequencyKHz();
    ensureCanvas();
    drawStatus('CONNECTING RF SOCKET');
    setRfMessage('Actual receiver audio is live · connecting the receiver’s RF spectrum and waterfall…');

    if (!meta?.receiverId || !meta?.timestamp) {
      drawStatus('RF SOCKET INFO MISSING');
      return;
    }

    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wfUrl = `${scheme}//${window.location.host}/api/sdr/ws?receiver=${encodeURIComponent(meta.receiverId)}&stream=${encodeURIComponent('W/F')}&ts=${encodeURIComponent(meta.timestamp)}`;
    let socket;
    try {
      // Deliberately use the WebSocket implementation captured before the SDR
      // health wrapper loads. W/F is a companion RF stream and must never be
      // judged by the SND/audio health timeout.
      socket = new BaseWebSocket(wfUrl);
      socket.binaryType = 'arraybuffer';
    } catch (error) {
      drawStatus('RF SOCKET FAILED');
      setRfMessage(`Actual receiver audio is live. RF socket could not be opened${error?.message ? `: ${error.message}` : '.'}`, true);
      return;
    }
    state.wfSocket = socket;

    socket.onopen = () => {
      if (generation !== state.generation) return;
      drawStatus('RF SOCKET OPEN', 'authenticating / configuring');
      try { socket.send('SET auth t=kiwi p=#'); } catch {}
      configureWaterfall();
      state.keepaliveTimer = window.setInterval(() => sendWf('SET keepalive'), 5000);
      state.timeoutTimer = window.setTimeout(() => {
        if (generation !== state.generation || state.gotFrame) return;
        if (state.unsupportedFrameLength) return;
        drawStatus('NO RF FRAMES RECEIVED', 'audio is live · W/F stream did not start');
        setRfMessage('Actual receiver audio is live. The receiver accepted the RF socket, but no waterfall frames arrived.', true);
      }, RF_TIMEOUT_MS);
    };
    socket.onmessage = event => { if (generation === state.generation) handleMessage(event); };
    socket.onerror = () => {
      if (generation !== state.generation) return;
      drawStatus('RF SOCKET ERROR');
      setRfMessage('Actual receiver audio is live. The RF waterfall socket failed.', true);
    };
    socket.onclose = event => {
      if (generation !== state.generation) return;
      window.clearInterval(state.keepaliveTimer);
      window.clearTimeout(state.timeoutTimer);
      if (!state.gotFrame) {
        const detail = event?.code ? `close ${event.code}${event.reason ? ` · ${event.reason}` : ''}` : '';
        drawStatus('RF STREAM CLOSED', detail);
        setRfMessage(`Actual receiver audio is live. The RF waterfall stream closed${detail ? ` (${detail})` : ''}.`, true);
      }
    };
  }

  function RfAwareWebSocket(url, protocols) {
    const socket = protocols === undefined ? new BaseWebSocket(url) : new BaseWebSocket(url, protocols);
    const meta = parseSocketUrl(url);
    if (meta?.stream === 'SND') {
      socket.addEventListener('open', () => startWaterfall(meta, socket), { once: true });
      socket.addEventListener('close', () => {
        if (state.sndSocket === socket) {
          state.generation += 1;
          state.sndSocket = null;
          closeWaterfall();
        }
      });
    }
    return socket;
  }

  RfAwareWebSocket.prototype = BaseWebSocket.prototype;
  Object.defineProperties(RfAwareWebSocket, {
    CONNECTING: { value: BaseWebSocket.CONNECTING },
    OPEN: { value: BaseWebSocket.OPEN },
    CLOSING: { value: BaseWebSocket.CLOSING },
    CLOSED: { value: BaseWebSocket.CLOSED }
  });

  window.WebSocket = RfAwareWebSocket;

  document.addEventListener('change', event => {
    if (event.target?.matches?.('[data-sdr-mode]') && state.wfSocket?.readyState === BaseWebSocket.OPEN) configureWaterfall();
  });
})();
