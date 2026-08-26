(() => {
  const BaseWebSocket = window.WebSocket;
  const decoder = new TextDecoder();
  const MAX_KHZ = 30000;
  const WF_BINS = 1024;
  const state = {
    sndSocket: null,
    wfSocket: null,
    keepaliveTimer: null,
    generation: 0,
    receiverId: '',
    timestamp: '',
    targetKHz: null,
    centerKHz: null,
    zoom: 10,
    spanKHz: MAX_KHZ / 1024,
    displayMinDb: -130,
    displayMaxDb: -55,
    hasRfFrame: false,
    rfUnavailable: false,
    rfCanvas: null,
    originalCanvas: null
  };

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
    return ['usb', 'lsb'].includes(value) ? value : (value === 'sam' ? 'sam' : 'am');
  }

  function zoomForMode(mode) {
    return mode === 'usb' || mode === 'lsb' ? 11 : 10;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function formatAxisFrequency(kHz) {
    if (!Number.isFinite(kHz)) return '--';
    if (kHz >= 1000) {
      const mhz = kHz / 1000;
      return `${mhz.toFixed(3)} MHz`;
    }
    return `${kHz.toFixed(kHz >= 100 ? 1 : 2)} kHz`;
  }

  let panelObserver = null;

  function ensureRfCanvas() {
    const wrap = document.querySelector('.sdr-spectrum-wrap');
    const original = wrap?.querySelector('[data-sdr-canvas]');
    if (!wrap || !original) return null;

    let rf = wrap.querySelector('[data-sdr-rf-canvas]');
    if (!rf) {
      rf = document.createElement('canvas');
      rf.className = 'sdr-rf-spectrum';
      rf.dataset.sdrRfCanvas = 'true';
      rf.setAttribute('aria-label', 'Live RF spectrum and waterfall');
      wrap.appendChild(rf);

      if (!document.getElementById('signal-scout-rf-waterfall-styles')) {
        const style = document.createElement('style');
        style.id = 'signal-scout-rf-waterfall-styles';
        style.textContent = `
          .sdr-spectrum-wrap { min-height:132px; }
          .sdr-spectrum-wrap > [data-sdr-canvas] { opacity:0 !important; }
          .sdr-rf-spectrum { position:absolute; inset:0; z-index:1; display:block; width:100%; height:100%; pointer-events:none; }
          .sdr-spectrum-label { z-index:2 !important; text-shadow:0 1px 3px #020608; }
        `;
        document.head.appendChild(style);
      }
    }

    state.rfCanvas = rf;
    state.originalCanvas = original;
    if (panelObserver) {
      panelObserver.disconnect();
      panelObserver = null;
    }
    installMessageGuard();
    const label = wrap.querySelector('.sdr-spectrum-label');
    if (label) label.textContent = 'Live RF spectrum / waterfall';
    return rf;
  }

  function reconcilePlayerMessage() {
    const message = document.querySelector('[data-sdr-message]');
    if (!message) return;
    const oldAudioFftText = /spectrum and waterfall are generated from the live audio stream/i.test(message.textContent || '');
    if (!oldAudioFftText) return;
    const replacement = state.hasRfFrame
      ? 'Actual receiver audio · RF spectrum and waterfall are live from this receiver.'
      : (state.rfUnavailable
        ? 'Actual receiver audio is live. RF spectrum is unavailable from this receiver.'
        : 'Actual receiver audio is live · connecting the receiver’s RF spectrum and waterfall…');
    if (message.textContent !== replacement) message.textContent = replacement;
  }

  function installMessageGuard() {
    const message = document.querySelector('[data-sdr-message]');
    if (!message || message.dataset.rfMessageGuard === 'true') return;
    message.dataset.rfMessageGuard = 'true';
    new MutationObserver(reconcilePlayerMessage).observe(message, { childList: true, characterData: true, subtree: true });
    reconcilePlayerMessage();
  }

  function setPlayerMessage(text, isError = false) {
    const message = document.querySelector('[data-sdr-message]');
    if (!message) return;
    message.textContent = text;
    message.classList.toggle('is-error', isError);
  }

  function audioIsLive() {
    return String(document.querySelector('[data-sdr-status]')?.textContent || '').trim().toLowerCase() === 'live rf';
  }

  function setRfAvailabilityMessage(text, isError = false) {
    if (audioIsLive()) setPlayerMessage(text, isError);
  }

  function drawIdleRf(label = 'WAITING FOR RF SPECTRUM') {
    const canvas = ensureRfCanvas();
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(300, Math.round(rect.width * dpr));
    const height = Math.max(120, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#02070b';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(138,200,242,.09)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += width / 8) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y <= height; y += height / 5) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(173,203,222,.60)';
    ctx.font = `${9 * dpr}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(label, width / 2, height / 2);
  }

  function percentile(sorted, fraction) {
    if (!sorted.length) return null;
    const index = clamp(Math.round((sorted.length - 1) * fraction), 0, sorted.length - 1);
    return sorted[index];
  }

  function updateDisplayRange(dbValues) {
    const useful = dbValues.filter((value) => Number.isFinite(value) && value > -190 && value < 10).sort((a, b) => a - b);
    if (useful.length < 32) return;
    const noise = percentile(useful, 0.25);
    const peak = percentile(useful, 0.995);
    let targetMin = clamp(noise - 12, -155, -78);
    let targetMax = clamp(Math.max(noise + 36, peak + 5), -105, -20);
    if (targetMax - targetMin < 44) targetMax = Math.min(-20, targetMin + 44);
    state.displayMinDb = state.displayMinDb * 0.82 + targetMin * 0.18;
    state.displayMaxDb = state.displayMaxDb * 0.82 + targetMax * 0.18;
  }

  function rfColor(normalized) {
    const t = clamp(normalized, 0, 1);
    const stops = [
      [0.00, [2, 8, 16]],
      [0.16, [10, 30, 72]],
      [0.34, [0, 103, 164]],
      [0.52, [0, 183, 183]],
      [0.68, [56, 207, 123]],
      [0.82, [226, 213, 68]],
      [0.93, [244, 120, 38]],
      [1.00, [255, 238, 225]]
    ];
    for (let i = 1; i < stops.length; i += 1) {
      if (t <= stops[i][0]) {
        const [p0, c0] = stops[i - 1];
        const [p1, c1] = stops[i];
        const mix = (t - p0) / (p1 - p0 || 1);
        return c0.map((value, channel) => Math.round(value + (c1[channel] - value) * mix));
      }
    }
    return stops[stops.length - 1][1];
  }

  function renderRfFrame(rawSamples) {
    if (!rawSamples || rawSamples.length < WF_BINS) return;
    const canvas = ensureRfCanvas();
    if (!canvas) return;

    const bins = rawSamples.subarray(0, WF_BINS);
    const db = Array.from(bins, (sample) => sample - 255);
    updateDisplayRange(db);

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(300, Math.round(rect.width * dpr));
    const height = Math.max(120, Math.round(rect.height * dpr));
    const resized = canvas.width !== width || canvas.height !== height;
    if (resized) {
      canvas.width = width;
      canvas.height = height;
    }

    const ctx = canvas.getContext('2d');
    const spectrumH = Math.round(height * 0.56);
    const waterfallTop = spectrumH + 1;
    const waterfallH = height - waterfallTop;
    const minDb = state.displayMinDb;
    const maxDb = Math.max(minDb + 30, state.displayMaxDb);
    const dbSpan = maxDb - minDb;

    if (resized) {
      ctx.fillStyle = '#02070b';
      ctx.fillRect(0, 0, width, height);
    }

    if (waterfallH > 3) {
      ctx.drawImage(canvas, 0, waterfallTop, width, Math.max(1, waterfallH - 2), 0, waterfallTop + 2, width, Math.max(1, waterfallH - 2));
      const row = ctx.createImageData(width, 2);
      for (let x = 0; x < width; x += 1) {
        const binIndex = clamp(Math.floor((x / Math.max(1, width - 1)) * (WF_BINS - 1)), 0, WF_BINS - 1);
        const normalized = (db[binIndex] - minDb) / dbSpan;
        const [r, g, b] = rfColor(normalized);
        for (let yy = 0; yy < 2; yy += 1) {
          const p = (yy * width + x) * 4;
          row.data[p] = r;
          row.data[p + 1] = g;
          row.data[p + 2] = b;
          row.data[p + 3] = 255;
        }
      }
      ctx.putImageData(row, 0, waterfallTop);
    }

    ctx.fillStyle = '#02070b';
    ctx.fillRect(0, 0, width, spectrumH);
    ctx.strokeStyle = 'rgba(138,200,242,.09)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += width / 8) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, spectrumH); ctx.stroke();
    }
    for (let y = 0; y <= spectrumH; y += spectrumH / 4) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    ctx.beginPath();
    for (let i = 0; i < WF_BINS; i += 1) {
      const x = (i / (WF_BINS - 1)) * width;
      const normalized = clamp((db[i] - minDb) / dbSpan, 0, 1);
      const y = spectrumH - 9 * dpr - normalized * (spectrumH - 20 * dpr);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#8ac8f2';
    ctx.lineWidth = Math.max(1, 1.2 * dpr);
    ctx.stroke();

    const span = state.spanKHz;
    const startKHz = state.centerKHz - span / 2;
    const stopKHz = state.centerKHz + span / 2;
    if (Number.isFinite(state.targetKHz) && span > 0) {
      const markerX = ((state.targetKHz - startKHz) / span) * width;
      if (markerX >= 0 && markerX <= width) {
        ctx.strokeStyle = 'rgba(242,247,250,.72)';
        ctx.lineWidth = Math.max(1, dpr);
        ctx.beginPath(); ctx.moveTo(markerX, 17 * dpr); ctx.lineTo(markerX, spectrumH); ctx.stroke();
        ctx.fillStyle = '#f2f7fa';
        ctx.beginPath();
        ctx.moveTo(markerX, 15 * dpr);
        ctx.lineTo(markerX - 4 * dpr, 9 * dpr);
        ctx.lineTo(markerX + 4 * dpr, 9 * dpr);
        ctx.closePath();
        ctx.fill();
      }
    }

    ctx.fillStyle = 'rgba(190,210,223,.68)';
    ctx.font = `${8 * dpr}px monospace`;
    ctx.textAlign = 'left';
    ctx.fillText(formatAxisFrequency(startKHz), 5 * dpr, spectrumH - 5 * dpr);
    ctx.textAlign = 'center';
    ctx.fillText(formatAxisFrequency(state.centerKHz), width / 2, spectrumH - 5 * dpr);
    ctx.textAlign = 'right';
    ctx.fillText(formatAxisFrequency(stopKHz), width - 5 * dpr, spectrumH - 5 * dpr);

    const label = document.querySelector('.sdr-spectrum-label');
    if (label) label.textContent = `Live RF spectrum / waterfall · ${state.spanKHz.toFixed(1)} kHz span`;
    state.hasRfFrame = true;
    state.rfUnavailable = false;
    setRfAvailabilityMessage('Actual receiver audio · RF spectrum and waterfall are live from this receiver.');
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
    const span = MAX_KHZ / (2 ** zoom);
    const center = clamp(target, span / 2, MAX_KHZ - span / 2);
    state.targetKHz = target;
    state.centerKHz = center;
    state.zoom = zoom;
    state.spanKHz = span;
    state.displayMinDb = -130;
    state.displayMaxDb = -55;
    state.hasRfFrame = false;
    state.rfUnavailable = false;

    sendWf('SET ident_user=Signal Scout');
    sendWf(`SET zoom=${zoom} cf=${center.toFixed(3)}`);
    sendWf('SET maxdb=-10 mindb=-130');
    sendWf('SET wf_comp=0');
    sendWf('SET interp=13');
    sendWf('SET wf_speed=2');
    sendWf('SET keepalive');
    drawIdleRf('WAITING FOR LIVE RF');
  }

  function handleWfBytes(bytes) {
    if (!bytes || bytes.byteLength < 4) return;
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    if (tag === 'MSG') {
      const text = decoder.decode(bytes.subarray(4));
      if (/(?:^|\s)too_busy=1(?:\s|$)/.test(text)) {
        state.rfUnavailable = true;
        drawIdleRf('RF WATERFALL BUSY');
        setRfAvailabilityMessage('Actual receiver audio is live. This receiver has no waterfall slot available right now.');
        return;
      }
      if (/(?:^|\s)down=1(?:\s|$)/.test(text)) {
        state.rfUnavailable = true;
        drawIdleRf('RF WATERFALL OFFLINE');
        return;
      }
      if (/(?:^|\s)wf_setup(?:=\S*)?(?:\s|$)/.test(text)) configureWaterfall();
      return;
    }

    if (tag !== 'W/F' || bytes.byteLength < 16) return;
    const samples = bytes.subarray(16);
    if (samples.length < WF_BINS) return;
    renderRfFrame(samples);
  }

  function handleWfMessage(event) {
    if (event.data instanceof ArrayBuffer) {
      handleWfBytes(new Uint8Array(event.data));
    } else if (event.data instanceof Blob) {
      event.data.arrayBuffer().then((buffer) => handleWfBytes(new Uint8Array(buffer))).catch(() => {});
    } else if (typeof event.data === 'string') {
      handleWfBytes(new TextEncoder().encode(event.data));
    }
  }

  function closeWaterfall() {
    window.clearInterval(state.keepaliveTimer);
    state.keepaliveTimer = null;
    const socket = state.wfSocket;
    state.wfSocket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try { socket.close(1000, 'Signal Scout RF waterfall close'); } catch {}
    }
    state.hasRfFrame = false;
  }

  function startWaterfall(meta, sndSocket) {
    const generation = ++state.generation;
    closeWaterfall();
    state.sndSocket = sndSocket;
    state.receiverId = meta.receiverId;
    state.timestamp = meta.timestamp;
    state.targetKHz = currentFrequencyKHz();
    state.rfUnavailable = false;
    ensureRfCanvas();
    drawIdleRf('CONNECTING RF WATERFALL');

    if (!meta.receiverId || !meta.timestamp) return;
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wfUrl = `${scheme}//${window.location.host}/api/sdr/ws?receiver=${encodeURIComponent(meta.receiverId)}&stream=${encodeURIComponent('W/F')}&ts=${encodeURIComponent(meta.timestamp)}`;

    let socket;
    try {
      socket = new BaseWebSocket(wfUrl);
      socket.binaryType = 'arraybuffer';
    } catch {
      state.rfUnavailable = true;
      drawIdleRf('RF SPECTRUM UNAVAILABLE');
      return;
    }
    state.wfSocket = socket;

    socket.onopen = () => {
      if (generation !== state.generation) return;
      try { socket.send('SET auth t=kiwi p=#'); } catch {}
      configureWaterfall();
      state.keepaliveTimer = window.setInterval(() => {
        if (socket.readyState === BaseWebSocket.OPEN) {
          try { socket.send('SET keepalive'); } catch {}
        }
      }, 5000);
    };
    socket.onmessage = (event) => {
      if (generation === state.generation) handleWfMessage(event);
    };
    socket.onerror = () => {
      if (generation !== state.generation) return;
      state.rfUnavailable = true;
      state.hasRfFrame = false;
      drawIdleRf('RF SPECTRUM UNAVAILABLE');
      setRfAvailabilityMessage('Actual receiver audio is live. RF spectrum is unavailable from this receiver.', true);
    };
    socket.onclose = () => {
      if (generation !== state.generation) return;
      state.rfUnavailable = true;
      state.hasRfFrame = false;
      drawIdleRf('RF SPECTRUM DISCONNECTED');
      setRfAvailabilityMessage('Actual receiver audio is live. The RF spectrum stream disconnected.', true);
    };
  }

  function RfAwareWebSocket(url, protocols) {
    const socket = protocols === undefined
      ? new BaseWebSocket(url)
      : new BaseWebSocket(url, protocols);
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

  document.addEventListener('change', (event) => {
    if (event.target?.matches?.('[data-sdr-mode]') && state.wfSocket?.readyState === BaseWebSocket.OPEN) {
      configureWaterfall();
    }
  });

  panelObserver = new MutationObserver(() => ensureRfCanvas());
  panelObserver.observe(document.documentElement, { childList: true, subtree: true });
  ensureRfCanvas();
})();
