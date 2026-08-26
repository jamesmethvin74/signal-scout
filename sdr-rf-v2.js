(() => {
  // Signal Scout RF waterfall v2
  // Owns one Kiwi W/F stream paired to the player's SND session. This module
  // deliberately captures the browser WebSocket before the SDR health wrapper
  // is installed so RF sockets can never be mistaken for failed audio sockets.
  const NativeWebSocket = window.WebSocket;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const DEFAULT_BINS = 1024;
  const DEFAULT_BANDWIDTH_KHZ = 30000;
  const DEFAULT_ZOOM_CAP = 14;
  const RF_START_TIMEOUT_MS = 11000;
  const RF_COMPAT_RETRY_MS = 4200;
  const RF_SETUP_FALLBACK_MS = 900;

  const stepSizeTable = [
    7,8,9,10,11,12,13,14,16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,
    73,80,88,97,107,118,130,143,157,173,190,209,230,253,279,307,337,371,408,
    449,494,544,598,658,724,796,876,963,1060,1166,1282,1411,1552,1707,1878,
    2066,2272,2499,2749,3024,3327,3660,4026,4428,4871,5358,5894,6484,7132,
    7845,8630,9493,10442,11487,12635,13899,15289,16818,18500,20350,22385,
    24623,27086,29794,32767
  ];
  const indexAdjustTable = [-1,-1,-1,-1,2,4,6,8,-1,-1,-1,-1,2,4,6,8];

  const state = {
    socket: null,
    sndSocket: null,
    generation: 0,
    receiverId: '',
    timestamp: '',
    targetKHz: null,
    fullBandwidthKHz: DEFAULT_BANDWIDTH_KHZ,
    fftBins: DEFAULT_BINS,
    zoomCap: DEFAULT_ZOOM_CAP,
    versionMajor: null,
    versionMinor: null,
    centerKHz: null,
    spanKHz: null,
    zoom: 10,
    canvas: null,
    originalCanvas: null,
    hasFrame: false,
    wfSetupSeen: false,
    configured: false,
    requestedCompression: false,
    frameCount: 0,
    binaryCount: 0,
    msgCount: 0,
    unsupportedFrames: 0,
    lastFrameBytes: 0,
    lastStage: 'idle',
    lastError: '',
    displayMinDb: -130,
    displayMaxDb: -55,
    keepaliveTimer: null,
    setupTimer: null,
    retryTimer: null,
    timeoutTimer: null
  };

  function parseSocketMeta(rawUrl) {
    try {
      const url = new URL(String(rawUrl), window.location.href);
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

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function isPowerOfTwo(value) {
    return Number.isInteger(value) && value >= 128 && value <= 65536 && (value & (value - 1)) === 0;
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

  function playerAudioIsLive() {
    return String(document.querySelector('[data-sdr-status]')?.textContent || '').trim().toLowerCase() === 'live rf';
  }

  function playerMessage(text, isError = false) {
    if (!playerAudioIsLive()) return;
    const el = document.querySelector('[data-sdr-message]');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-error', isError);
  }

  function ensureCanvas() {
    const wrap = document.querySelector('.sdr-spectrum-wrap');
    const original = wrap?.querySelector('[data-sdr-canvas]');
    if (!wrap || !original) return null;

    let canvas = wrap.querySelector('[data-sdr-rf-v2-canvas]');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'sdr-rf-v2-spectrum';
      canvas.dataset.sdrRfV2Canvas = 'true';
      canvas.setAttribute('aria-label', 'Live receiver RF spectrum and waterfall');
      original.insertAdjacentElement('afterend', canvas);
    }

    if (!document.getElementById('signal-scout-rf-v2-style')) {
      const style = document.createElement('style');
      style.id = 'signal-scout-rf-v2-style';
      style.textContent = `
        .sdr-spectrum-wrap > [data-sdr-canvas] { display:none !important; }
        .sdr-rf-v2-spectrum { display:block; width:100%; height:150px; background:#020608; }
        .sdr-spectrum-label { z-index:3 !important; text-shadow:0 1px 3px #020608; }
      `;
      document.head.appendChild(style);
    }

    state.canvas = canvas;
    state.originalCanvas = original;
    const label = wrap.querySelector('.sdr-spectrum-label');
    if (label) label.textContent = 'Live RF spectrum / waterfall';
    return canvas;
  }

  function canvasSize(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(300, Math.round((rect.width || 300) * dpr));
    const height = Math.max(120, Math.round((rect.height || 150) * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return { width, height, dpr };
  }

  function drawStage(title, detail = '') {
    const canvas = ensureCanvas();
    if (!canvas) return;
    const { width, height, dpr } = canvasSize(canvas);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#020608';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(138,200,242,.09)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += width / 8) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y <= height; y += height / 5) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(183,218,239,.82)';
    ctx.font = `700 ${10 * dpr}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(String(title || 'RF').toUpperCase(), width / 2, height / 2 - 5 * dpr);
    if (detail) {
      ctx.fillStyle = 'rgba(126,157,177,.82)';
      ctx.font = `${8 * dpr}px monospace`;
      const clipped = String(detail).slice(0, 90);
      ctx.fillText(clipped, width / 2, height / 2 + 13 * dpr);
    }
  }

  function setStage(stage, title, detail = '', error = false) {
    state.lastStage = stage;
    state.lastError = error ? detail || title : '';
    drawStage(title, detail);
    if (playerAudioIsLive()) {
      const prefix = error ? 'Actual receiver audio is live. ' : 'Actual receiver audio is live · ';
      playerMessage(`${prefix}${detail || title}`, error);
    }
  }

  function formatAxisFrequency(kHz) {
    if (!Number.isFinite(kHz)) return '--';
    if (kHz >= 1000) return `${(kHz / 1000).toFixed(3)} MHz`;
    return `${kHz.toFixed(kHz >= 100 ? 1 : 2)} kHz`;
  }

  function percentile(sorted, fraction) {
    if (!sorted.length) return null;
    return sorted[clamp(Math.round((sorted.length - 1) * fraction), 0, sorted.length - 1)];
  }

  function updateDisplayRange(dbValues) {
    const useful = dbValues.filter((value) => Number.isFinite(value) && value > -200 && value < 5).sort((a, b) => a - b);
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
      [0.00,[2,8,16]], [0.16,[10,30,72]], [0.34,[0,103,164]],
      [0.52,[0,183,183]], [0.68,[56,207,123]], [0.82,[226,213,68]],
      [0.93,[244,120,38]], [1.00,[255,238,225]]
    ];
    for (let i = 1; i < stops.length; i += 1) {
      if (t <= stops[i][0]) {
        const [p0,c0] = stops[i - 1];
        const [p1,c1] = stops[i];
        const mix = (t - p0) / (p1 - p0 || 1);
        return c0.map((value, channel) => Math.round(value + (c1[channel] - value) * mix));
      }
    }
    return stops[stops.length - 1][1];
  }

  function renderRfFrame(rawBins) {
    if (!rawBins || rawBins.length < state.fftBins) return;
    const canvas = ensureCanvas();
    if (!canvas) return;
    const bins = rawBins.subarray(0, state.fftBins);
    const db = Array.from(bins, (sample) => clamp(sample - 255, -200, 0));
    updateDisplayRange(db);

    const { width, height, dpr } = canvasSize(canvas);
    const ctx = canvas.getContext('2d');
    const spectrumH = Math.round(height * 0.56);
    const waterfallTop = spectrumH + 1;
    const waterfallH = height - waterfallTop;
    const minDb = state.displayMinDb;
    const maxDb = Math.max(minDb + 30, state.displayMaxDb);
    const dbSpan = maxDb - minDb;

    if (!state.hasFrame) {
      ctx.fillStyle = '#020608';
      ctx.fillRect(0, 0, width, height);
    }

    if (waterfallH > 3 && state.hasFrame) {
      ctx.drawImage(canvas, 0, waterfallTop, width, Math.max(1, waterfallH - 2), 0, waterfallTop + 2, width, Math.max(1, waterfallH - 2));
    }
    if (waterfallH > 3) {
      const row = ctx.createImageData(width, 2);
      for (let x = 0; x < width; x += 1) {
        const binIndex = clamp(Math.floor((x / Math.max(1, width - 1)) * (bins.length - 1)), 0, bins.length - 1);
        const normalized = (db[binIndex] - minDb) / dbSpan;
        const [r,g,b] = rfColor(normalized);
        for (let yy = 0; yy < 2; yy += 1) {
          const p = (yy * width + x) * 4;
          row.data[p] = r; row.data[p + 1] = g; row.data[p + 2] = b; row.data[p + 3] = 255;
        }
      }
      ctx.putImageData(row, 0, waterfallTop);
    }

    ctx.fillStyle = '#020608';
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
    for (let i = 0; i < bins.length; i += 1) {
      const x = (i / Math.max(1, bins.length - 1)) * width;
      const normalized = clamp((db[i] - minDb) / dbSpan, 0, 1);
      const y = spectrumH - 9 * dpr - normalized * (spectrumH - 20 * dpr);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#8ac8f2';
    ctx.lineWidth = Math.max(1, 1.2 * dpr);
    ctx.stroke();

    const span = state.spanKHz || (state.fullBandwidthKHz / (2 ** state.zoom));
    const center = state.centerKHz ?? state.targetKHz;
    const startKHz = center - span / 2;
    const stopKHz = center + span / 2;
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
        ctx.closePath(); ctx.fill();
      }
    }

    ctx.fillStyle = 'rgba(190,210,223,.70)';
    ctx.font = `${8 * dpr}px monospace`;
    ctx.textAlign = 'left'; ctx.fillText(formatAxisFrequency(startKHz), 5 * dpr, spectrumH - 5 * dpr);
    ctx.textAlign = 'center'; ctx.fillText(formatAxisFrequency(center), width / 2, spectrumH - 5 * dpr);
    ctx.textAlign = 'right'; ctx.fillText(formatAxisFrequency(stopKHz), width - 5 * dpr, spectrumH - 5 * dpr);

    state.hasFrame = true;
    state.frameCount += 1;
    const label = document.querySelector('.sdr-spectrum-label');
    if (label) label.textContent = `Live RF spectrum / waterfall · ${span.toFixed(1)} kHz span`;
    playerMessage('Actual receiver audio · RF spectrum and waterfall are live from this receiver.');
  }

  function decodeWaterfallAdpcm(payload, expectedBins) {
    const decoded = new Uint8Array(payload.length * 2);
    let predictor = 0;
    let index = 0;
    let out = 0;
    const decodeNibble = (code) => {
      const step = stepSizeTable[clamp(index, 0, 88)];
      let difference = step >> 3;
      if (code & 1) difference += step >> 2;
      if (code & 2) difference += step >> 1;
      if (code & 4) difference += step;
      if (code & 8) difference = -difference;
      predictor = clamp(predictor + difference, 0, 255);
      index = clamp(index + indexAdjustTable[code & 0x0f], 0, 88);
      return predictor;
    };
    for (const packed of payload) {
      decoded[out++] = decodeNibble(packed & 0x0f);
      decoded[out++] = decodeNibble((packed >> 4) & 0x0f);
    }
    const pad = 10;
    if (decoded.length < pad + expectedBins) return null;
    return decoded.subarray(pad, pad + expectedBins);
  }

  function littleEndianU32(bytes, offset) {
    if (offset + 4 > bytes.length) return 0;
    return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  }

  function decodeWaterfallFrame(bytes) {
    if (!bytes || bytes.length <= 4) return null;
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    if (tag !== 'W/F') return null;

    const bins = state.fftBins || DEFAULT_BINS;
    const directCompactBytes = 4 + bins;
    const compressedBytes = Math.ceil((bins + 10) / 2);

    // Current compact format: 3-byte W/F tag + sequence byte + direct bins.
    if (bytes.length === directCompactBytes) return bytes.subarray(4, 4 + bins);

    // Some compatible servers can send compact ADPCM without the extended
    // metadata header. Accept it defensively.
    if (bytes.length === 4 + compressedBytes) {
      return decodeWaterfallAdpcm(bytes.subarray(4), bins);
    }

    if (bytes.length >= 16) {
      const flagsAndZoom = littleEndianU32(bytes, 8);
      const compressedFlag = (flagsAndZoom & 0x00010000) !== 0;
      const payload = bytes.subarray(16);
      if (payload.length === bins && !compressedFlag) return payload.subarray(0, bins);
      if (compressedFlag || payload.length === compressedBytes) {
        return decodeWaterfallAdpcm(payload, bins);
      }
    }

    return null;
  }

  function numericMsg(text, key) {
    const match = String(text).match(new RegExp(`(?:^|\\s)${key}=(-?[0-9.]+)(?:\\s|$)`));
    if (!match) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  }

  function bandwidthToKHz(value) {
    if (!Number.isFinite(value) || value <= 0) return null;
    if (value >= 1_000_000) return value / 1000; // Hz -> kHz
    if (value >= 1000) return value;             // kHz
    return value * 1000;                         // MHz -> kHz
  }

  function send(message) {
    if (state.socket?.readyState !== NativeWebSocket.OPEN) return false;
    try { state.socket.send(message); return true; } catch { return false; }
  }

  function versionNumber() {
    if (!Number.isFinite(state.versionMajor) || !Number.isFinite(state.versionMinor)) return null;
    return state.versionMajor + state.versionMinor / 1000;
  }

  function configureWaterfall(reason = 'setup') {
    if (state.socket?.readyState !== NativeWebSocket.OPEN) return;
    const target = currentFrequencyKHz();
    if (!Number.isFinite(target)) {
      setStage('no-frequency', 'RF WAITING', 'Tuned frequency is unavailable.', true);
      return;
    }

    state.targetKHz = target;
    const mode = currentMode();
    const desiredZoom = (mode === 'usb' || mode === 'lsb') ? 11 : 10;
    const zoom = clamp(desiredZoom, 0, state.zoomCap || DEFAULT_ZOOM_CAP);
    const full = state.fullBandwidthKHz || DEFAULT_BANDWIDTH_KHZ;
    const span = full / (2 ** zoom);
    const center = clamp(target, span / 2, full - span / 2);
    state.zoom = zoom;
    state.spanKHz = span;
    state.centerKHz = center;
    state.displayMinDb = -130;
    state.displayMaxDb = -55;
    state.configured = true;

    send(`SET wf_comp=${state.requestedCompression ? 1 : 0}`);
    send('SET send_dB=1');
    const version = versionNumber();
    if (version != null && version < 1.329) {
      const maxZoom = DEFAULT_ZOOM_CAP;
      const startKHz = Math.max(0, center - span / 2);
      const counter = Math.round((startKHz / full) * (2 ** maxZoom) * state.fftBins);
      send(`SET zoom=${zoom} start=${counter}`);
    } else {
      send(`SET zoom=${zoom} cf=${center.toFixed(3)}`);
    }
    send('SET maxdb=-10 mindb=-130');
    send('SET wf_speed=2');
    send('SET interp=13');
    send('SET keepalive');
    if (!state.hasFrame) setStage(`configured-${reason}`, 'RF SETUP READY', `Waiting for ${state.fftBins}-bin waterfall frame…`);
  }

  function handleMsg(text) {
    state.msgCount += 1;
    const clean = String(text || '').replace(/^MSG\s?/, '');

    const maj = numericMsg(clean, 'version_maj');
    const min = numericMsg(clean, 'version_min');
    const bandwidth = numericMsg(clean, 'bandwidth');
    const fftBins = numericMsg(clean, 'wf_fft_size');
    const zoomCap = numericMsg(clean, 'zoom_cap') ?? numericMsg(clean, 'zoom_max');
    if (maj != null) state.versionMajor = maj;
    if (min != null) state.versionMinor = min;
    const bandwidthKHz = bandwidthToKHz(bandwidth);
    if (bandwidthKHz && bandwidthKHz >= 1000 && bandwidthKHz <= 100000) state.fullBandwidthKHz = bandwidthKHz;
    if (isPowerOfTwo(fftBins)) state.fftBins = fftBins;
    if (Number.isFinite(zoomCap)) state.zoomCap = clamp(Math.round(zoomCap), 0, 30);

    const failure = [
      ['too_busy', /(?:^|\s)too_busy=(?:1|\d+)(?:\s|$)/, 'RF waterfall slots are full on this receiver.'],
      ['down', /(?:^|\s)down=(?:1|\d+)(?:\s|$)/, 'This receiver reports its RF waterfall is offline.'],
      ['badp', /(?:^|\s)badp=([1-9]\d*)(?:\s|$)/, 'This receiver rejected the RF waterfall session.'],
      ['disabled', /(?:^|\s)reason_disabled=\S+(?:\s|$)/, 'This receiver has disabled the RF waterfall.'],
      ['camp', /(?:^|\s)camp_disconnect(?:=\S*)?(?:\s|$)/, 'The receiver closed the RF waterfall session.']
    ].find(([, regex]) => regex.test(clean));
    if (failure) {
      setStage(`server-${failure[0]}`, 'RF UNAVAILABLE', failure[2], true);
      return;
    }

    if (/(?:^|\s)wf_setup(?:=\S*)?(?:\s|$)/.test(clean)) {
      state.wfSetupSeen = true;
      configureWaterfall('wf_setup');
    } else if (state.configured && (bandwidthKHz || isPowerOfTwo(fftBins) || Number.isFinite(zoomCap))) {
      configureWaterfall('metadata');
    }
  }

  function handleBytes(bytes) {
    if (!bytes || bytes.length < 3) return;
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    if (tag === 'MSG') {
      handleMsg(decoder.decode(bytes.subarray(4)));
      return;
    }
    if (tag !== 'W/F') return;

    state.binaryCount += 1;
    state.lastFrameBytes = bytes.length;
    const bins = decodeWaterfallFrame(bytes);
    if (!bins || bins.length < state.fftBins) {
      state.unsupportedFrames += 1;
      if (state.unsupportedFrames === 1 || state.unsupportedFrames === 4) {
        setStage('unsupported-frame', 'RF FRAME RECEIVED', `${bytes.length} bytes received; decoding compatibility retry…`);
      }
      return;
    }
    state.unsupportedFrames = 0;
    renderRfFrame(bins);
  }

  function handleMessage(event) {
    if (event.data instanceof ArrayBuffer) {
      handleBytes(new Uint8Array(event.data));
    } else if (event.data instanceof Blob) {
      event.data.arrayBuffer().then((buffer) => handleBytes(new Uint8Array(buffer))).catch(() => {});
    } else if (typeof event.data === 'string') {
      handleBytes(encoder.encode(event.data));
    }
  }

  function clearTimers() {
    window.clearInterval(state.keepaliveTimer);
    window.clearTimeout(state.setupTimer);
    window.clearTimeout(state.retryTimer);
    window.clearTimeout(state.timeoutTimer);
    state.keepaliveTimer = state.setupTimer = state.retryTimer = state.timeoutTimer = null;
  }

  function closeWaterfall(reason = 'RF stopped') {
    clearTimers();
    const socket = state.socket;
    state.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      try { socket.close(1000, 'Signal Scout RF close'); } catch {}
    }
    state.hasFrame = false;
    state.configured = false;
    state.wfSetupSeen = false;
    state.requestedCompression = false;
    if (ensureCanvas()) drawStage(reason);
  }

  function startWaterfall(meta, sndSocket) {
    const generation = ++state.generation;
    closeWaterfall('OPENING RF');
    state.sndSocket = sndSocket;
    state.receiverId = meta.receiverId;
    state.timestamp = meta.timestamp;
    state.targetKHz = currentFrequencyKHz();
    state.fullBandwidthKHz = DEFAULT_BANDWIDTH_KHZ;
    state.fftBins = DEFAULT_BINS;
    state.zoomCap = DEFAULT_ZOOM_CAP;
    state.versionMajor = null;
    state.versionMinor = null;
    state.frameCount = state.binaryCount = state.msgCount = state.unsupportedFrames = 0;
    state.lastFrameBytes = 0;
    state.lastError = '';
    ensureCanvas();
    setStage('opening', 'OPENING RF', 'Opening KiwiSDR W/F stream…');

    if (!meta.receiverId || !/^\d{1,10}$/.test(meta.timestamp || '')) {
      setStage('bad-session', 'RF UNAVAILABLE', 'The audio session did not provide a valid Kiwi session ID.', true);
      return;
    }

    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${scheme}//${window.location.host}/api/sdr/ws?receiver=${encodeURIComponent(meta.receiverId)}&stream=${encodeURIComponent('W/F')}&ts=${encodeURIComponent(meta.timestamp)}`;
    let socket;
    try {
      socket = new NativeWebSocket(url);
      socket.binaryType = 'arraybuffer';
    } catch (error) {
      setStage('open-error', 'RF UNAVAILABLE', error?.message || 'Could not open the RF WebSocket.', true);
      return;
    }
    state.socket = socket;

    socket.onopen = () => {
      if (generation !== state.generation) return;
      setStage('socket-open', 'RF SOCKET CONNECTED', 'Authenticating waterfall session…');
      send('SET auth t=kiwi p=#');
      send('SET ident_user=SignalScout');
      send('SERVER DE CLIENT SignalScout W/F');
      send('SET wf_comp=0');
      send('SET send_dB=1');
      state.keepaliveTimer = window.setInterval(() => send('SET keepalive'), 5000);
      state.setupTimer = window.setTimeout(() => {
        if (generation === state.generation && !state.configured) configureWaterfall('fallback');
      }, RF_SETUP_FALLBACK_MS);
      state.retryTimer = window.setTimeout(() => {
        if (generation !== state.generation || state.hasFrame || socket.readyState !== NativeWebSocket.OPEN) return;
        state.requestedCompression = true;
        setStage('compression-retry', 'RF COMPATIBILITY RETRY', 'No row yet; requesting compressed Kiwi waterfall…');
        configureWaterfall('compression-retry');
      }, RF_COMPAT_RETRY_MS);
      state.timeoutTimer = window.setTimeout(() => {
        if (generation !== state.generation || state.hasFrame) return;
        const detail = state.binaryCount
          ? `No decodable row. Last W/F frame: ${state.lastFrameBytes} bytes; ${state.unsupportedFrames} unsupported.`
          : (state.wfSetupSeen
            ? 'Waterfall setup completed, but the receiver sent no W/F rows.'
            : `No W/F rows or wf_setup received (${state.msgCount} MSG frames).`);
        setStage('timeout', 'RF WATERFALL TIMEOUT', detail, true);
        try { socket.close(4000, 'Signal Scout RF timeout'); } catch {}
      }, RF_START_TIMEOUT_MS);
    };

    socket.onmessage = (event) => {
      if (generation === state.generation) handleMessage(event);
    };
    socket.onerror = () => {
      if (generation !== state.generation || state.hasFrame) return;
      setStage('socket-error', 'RF SOCKET ERROR', 'The receiver or proxy rejected the W/F stream.', true);
    };
    socket.onclose = (event) => {
      if (generation !== state.generation || state.hasFrame) return;
      const detail = state.lastStage === 'timeout'
        ? state.lastError
        : `W/F socket closed${event?.code ? ` (${event.code})` : ''}${event?.reason ? `: ${event.reason}` : '.'}`;
      setStage('socket-closed', 'RF STREAM CLOSED', detail, true);
    };
  }

  function RfSessionWebSocket(url, protocols) {
    const socket = protocols === undefined
      ? new NativeWebSocket(url)
      : new NativeWebSocket(url, protocols);
    const meta = parseSocketMeta(url);
    if (meta?.stream === 'SND') {
      socket.addEventListener('open', () => startWaterfall(meta, socket), { once: true });
      socket.addEventListener('close', () => {
        if (state.sndSocket === socket) {
          state.generation += 1;
          state.sndSocket = null;
          closeWaterfall('RF STOPPED');
        }
      });
    }
    return socket;
  }

  RfSessionWebSocket.prototype = NativeWebSocket.prototype;
  Object.defineProperties(RfSessionWebSocket, {
    CONNECTING: { value: NativeWebSocket.CONNECTING },
    OPEN: { value: NativeWebSocket.OPEN },
    CLOSING: { value: NativeWebSocket.CLOSING },
    CLOSED: { value: NativeWebSocket.CLOSED }
  });

  window.WebSocket = RfSessionWebSocket;

  document.addEventListener('change', (event) => {
    if (event.target?.matches?.('[data-sdr-mode]') && state.socket?.readyState === NativeWebSocket.OPEN) {
      configureWaterfall('mode-change');
    }
  });
})();
