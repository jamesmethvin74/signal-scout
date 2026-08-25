(() => {
  const RECEIVERS = [
    { id: 'florida', name: 'Florida KiwiSDR', location: 'Palm Harbor, Florida' },
    { id: 'north-carolina', name: 'North Carolina KiwiSDR', location: 'Apex, North Carolina' },
    { id: 'pennsylvania', name: 'Pennsylvania KiwiSDR', location: 'Ridley Park, Pennsylvania' }
  ];

  const PASSBANDS = {
    am: [-4900, 4900],
    sam: [-4900, 4900],
    usb: [300, 2700],
    lsb: [-2700, -300]
  };

  const sdr = {
    panel: null,
    socket: null,
    audioContext: null,
    analyser: null,
    gain: null,
    nextPlayTime: 0,
    sampleRate: 12000,
    frequency: null,
    station: '',
    mode: 'am',
    receiverIndex: 0,
    connected: false,
    configured: false,
    gotAudio: false,
    manualStop: false,
    keepaliveTimer: null,
    connectTimer: null,
    animationFrame: null,
    lastRssi: null,
    fallbackTried: new Set(),
    decoder: new TextDecoder()
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatFrequency(khz) {
    const decimals = Number.isInteger(khz) ? 0 : 1;
    return `${khz.toLocaleString(undefined, { maximumFractionDigits: decimals })} kHz`;
  }

  function selectedLookupReceiverIndex() {
    const select = document.getElementById('lookupReceiver');
    const index = Number(select?.value || 0);
    return Number.isInteger(index) && RECEIVERS[index] ? index : 0;
  }

  function frequencyFromContainer(container) {
    if (!container) return null;
    const lookupFrequency = container.querySelector('.lookup-result-frequency')?.textContent || '';
    if (lookupFrequency) {
      const value = Number(lookupFrequency.replace(/[^0-9.]/g, ''));
      if (Number.isFinite(value)) return value;
    }

    const freqEl = container.querySelector('.frequency');
    if (!freqEl) return null;
    const unit = freqEl.querySelector('span')?.textContent?.trim().toLowerCase() || '';
    const clone = freqEl.cloneNode(true);
    clone.querySelector('span')?.remove();
    const value = Number(clone.textContent.replace(/,/g, '').trim());
    if (!Number.isFinite(value)) return null;
    return unit.includes('mhz') ? value * 1000 : value;
  }

  function stationFromContainer(container) {
    return container?.querySelector('.station-name')?.textContent?.trim()
      || container?.querySelector('h3')?.textContent?.trim()
      || 'Live signal';
  }

  function modeFromContainer(container) {
    if (container?.classList.contains('lookup-result')) {
      const mode = document.getElementById('lookupMode')?.value || 'am';
      return PASSBANDS[mode] ? mode : 'am';
    }
    return 'am';
  }

  function injectStyles() {
    if (document.getElementById('signal-scout-sdr-player-styles')) return;
    const style = document.createElement('style');
    style.id = 'signal-scout-sdr-player-styles';
    style.textContent = `
      .sdr-player { position:fixed; left:50%; bottom:calc(68px + env(safe-area-inset-bottom)); z-index:30; width:min(720px,calc(100% - 16px)); transform:translateX(-50%); border:1px solid rgba(37,212,230,.72); border-radius:10px; overflow:hidden; background:#050b0e; box-shadow:0 -14px 44px rgba(0,0,0,.62),0 0 28px rgba(37,212,230,.08); }
      .sdr-player[hidden] { display:none !important; }
      .sdr-player-head { display:flex; align-items:center; gap:10px; padding:10px 12px; border-bottom:1px solid rgba(37,212,230,.16); background:linear-gradient(180deg,#0a171c,#071014); }
      .sdr-player-title { min-width:0; flex:1; }
      .sdr-player-title strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#eef6f7; font-size:13px; }
      .sdr-player-title span { display:block; margin-top:2px; color:var(--accent); font-family:var(--mono); font-size:10px; letter-spacing:.05em; }
      .sdr-status { display:inline-flex; align-items:center; gap:6px; flex:0 0 auto; color:#8fa2a7; font-family:var(--mono); font-size:9px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; }
      .sdr-status-dot { width:7px; height:7px; border-radius:50%; background:#6f7e82; }
      .sdr-player.is-live .sdr-status { color:var(--green); }
      .sdr-player.is-live .sdr-status-dot { background:var(--green); box-shadow:0 0 10px rgba(97,231,134,.7); }
      .sdr-icon-button { width:34px; height:34px; flex:0 0 auto; border:1px solid #1b3c43; border-radius:5px; color:#9eb0b5; background:#071014; font-size:15px; }
      .sdr-icon-button:hover { border-color:#2f6a74; color:#e3f2f4; }
      .sdr-player-body { padding:10px 12px 12px; }
      .sdr-spectrum-wrap { position:relative; overflow:hidden; border:1px solid #16424b; border-radius:6px; background:#020608; }
      .sdr-spectrum-label { position:absolute; left:8px; top:6px; z-index:2; color:#688087; font-family:var(--mono); font-size:8px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; pointer-events:none; }
      .sdr-spectrum { display:block; width:100%; height:150px; }
      .sdr-readout { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:7px; color:#71878d; font-family:var(--mono); font-size:9px; }
      .sdr-readout strong { color:#b8c8cb; font-weight:700; }
      .sdr-controls { display:grid; grid-template-columns:120px minmax(0,1fr) 92px; gap:8px; align-items:end; margin-top:10px; }
      .sdr-control label { display:block; margin-bottom:4px; color:#71868c; font-family:var(--mono); font-size:8px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; }
      .sdr-control select { width:100%; min-height:38px; border:1px solid #1b3a41; border-radius:5px; padding:7px 28px 7px 9px; color:#d7e4e6; background:#050d10; font-size:10px; }
      .sdr-volume { display:flex; align-items:center; gap:7px; min-height:38px; padding:0 9px; border:1px solid #1b3a41; border-radius:5px; background:#050d10; }
      .sdr-volume span { color:#70858b; font-size:12px; }
      .sdr-volume input { width:100%; accent-color:var(--accent); }
      .sdr-toggle { min-height:38px; border:1px solid rgba(37,212,230,.58); border-radius:5px; color:var(--accent-soft); background:rgba(37,212,230,.07); font-family:var(--mono); font-size:9px; font-weight:900; letter-spacing:.07em; text-transform:uppercase; }
      .sdr-message { margin-top:8px; min-height:15px; color:#8ca0a5; font-size:10px; line-height:1.4; }
      .sdr-message.is-error { color:#efbd5c; }
      .sdr-player.is-minimized .sdr-player-body { display:none; }
      body.sdr-player-open .app-shell { padding-bottom:440px !important; }
      body.sdr-player-open.sdr-player-minimized .app-shell { padding-bottom:150px !important; }
      @media (max-width:560px) {
        .sdr-player { bottom:calc(65px + env(safe-area-inset-bottom)); width:calc(100% - 10px); }
        .sdr-player-head { padding:9px 10px; }
        .sdr-player-body { padding:8px 9px 10px; }
        .sdr-spectrum { height:132px; }
        .sdr-controls { grid-template-columns:92px minmax(0,1fr); }
        .sdr-controls .sdr-play-control { grid-column:1 / -1; }
        .sdr-toggle { width:100%; }
        body.sdr-player-open .app-shell { padding-bottom:430px !important; }
      }
    `;
    document.head.appendChild(style);
  }

  function createPlayerShell() {
    if (sdr.panel) return sdr.panel;
    injectStyles();
    const panel = document.createElement('section');
    panel.className = 'sdr-player';
    panel.id = 'sdrPlayer';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Live SDR player');
    panel.innerHTML = `
      <div class="sdr-player-head">
        <div class="sdr-status"><span class="sdr-status-dot"></span><span data-sdr-status>Idle</span></div>
        <div class="sdr-player-title">
          <strong data-sdr-station>Live receiver</strong>
          <span data-sdr-frequency>-- kHz · AM</span>
        </div>
        <button class="sdr-icon-button" type="button" data-sdr-minimize aria-label="Minimize player">⌄</button>
        <button class="sdr-icon-button" type="button" data-sdr-close aria-label="Close player">×</button>
      </div>
      <div class="sdr-player-body">
        <div class="sdr-spectrum-wrap">
          <div class="sdr-spectrum-label">Live audio spectrum / baseband waterfall</div>
          <canvas class="sdr-spectrum" data-sdr-canvas></canvas>
        </div>
        <div class="sdr-readout">
          <span data-sdr-receiver>Receiver: --</span>
          <strong data-sdr-rssi>RSSI --</strong>
        </div>
        <div class="sdr-controls">
          <div class="sdr-control">
            <label for="sdrMode">Mode</label>
            <select id="sdrMode" data-sdr-mode>
              <option value="am">AM</option>
              <option value="sam">SAM</option>
              <option value="usb">USB</option>
              <option value="lsb">LSB</option>
            </select>
          </div>
          <div class="sdr-control">
            <label for="sdrReceiver">Receiver</label>
            <select id="sdrReceiver" data-sdr-receiver-select>
              ${RECEIVERS.map((receiver, index) => `<option value="${index}">${escapeHtml(receiver.name)} · ${escapeHtml(receiver.location)}</option>`).join('')}
            </select>
          </div>
          <div class="sdr-control sdr-play-control">
            <label>&nbsp;</label>
            <button class="sdr-toggle" type="button" data-sdr-toggle>Stop</button>
          </div>
        </div>
        <div class="sdr-control" style="margin-top:8px">
          <label>Volume</label>
          <div class="sdr-volume"><span>◖</span><input data-sdr-volume type="range" min="0" max="1" step="0.01" value="0.75" aria-label="Volume" /><span>◗</span></div>
        </div>
        <div class="sdr-message" data-sdr-message>Tap Listen Live on any signal to start.</div>
      </div>`;
    document.body.appendChild(panel);
    sdr.panel = panel;

    panel.querySelector('[data-sdr-close]').addEventListener('click', closePlayer);
    panel.querySelector('[data-sdr-minimize]').addEventListener('click', () => {
      const minimized = !panel.classList.contains('is-minimized');
      panel.classList.toggle('is-minimized', minimized);
      document.body.classList.toggle('sdr-player-minimized', minimized);
      const button = panel.querySelector('[data-sdr-minimize]');
      button.textContent = minimized ? '⌃' : '⌄';
      button.setAttribute('aria-label', minimized ? 'Expand player' : 'Minimize player');
    });
    panel.querySelector('[data-sdr-toggle]').addEventListener('click', () => {
      if (sdr.socket || sdr.connected) {
        stopSdr({ keepPanel: true, message: 'Stopped. Tap Play to reconnect.' });
      } else if (Number.isFinite(sdr.frequency)) {
        sdr.manualStop = false;
        sdr.fallbackTried.clear();
        connectSdr(sdr.receiverIndex);
      }
    });
    panel.querySelector('[data-sdr-volume]').addEventListener('input', (event) => {
      if (sdr.gain) sdr.gain.gain.value = Number(event.target.value);
    });
    panel.querySelector('[data-sdr-mode]').addEventListener('change', (event) => {
      sdr.mode = PASSBANDS[event.target.value] ? event.target.value : 'am';
      updatePlayerReadout();
      if (sdr.socket?.readyState === WebSocket.OPEN && sdr.configured) sendTuning();
    });
    panel.querySelector('[data-sdr-receiver-select]').addEventListener('change', (event) => {
      sdr.receiverIndex = Number(event.target.value) || 0;
      const lookupReceiver = document.getElementById('lookupReceiver');
      if (lookupReceiver) lookupReceiver.value = String(sdr.receiverIndex);
      if (Number.isFinite(sdr.frequency)) {
        sdr.manualStop = false;
        sdr.fallbackTried.clear();
        connectSdr(sdr.receiverIndex);
      }
    });

    drawIdleSpectrum('READY');
    return panel;
  }

  function playerEl(selector) {
    return createPlayerShell().querySelector(selector);
  }

  function setMessage(message, isError = false) {
    const el = playerEl('[data-sdr-message]');
    el.textContent = message;
    el.classList.toggle('is-error', isError);
  }

  function setStatus(status, live = false) {
    const panel = createPlayerShell();
    panel.querySelector('[data-sdr-status]').textContent = status;
    panel.classList.toggle('is-live', live);
  }

  function updatePlayerReadout() {
    const panel = createPlayerShell();
    const receiver = RECEIVERS[sdr.receiverIndex] || RECEIVERS[0];
    panel.querySelector('[data-sdr-station]').textContent = sdr.station || 'Live receiver';
    panel.querySelector('[data-sdr-frequency]').textContent = Number.isFinite(sdr.frequency)
      ? `${formatFrequency(sdr.frequency)} · ${sdr.mode.toUpperCase()}`
      : '-- kHz';
    panel.querySelector('[data-sdr-receiver]').textContent = `Receiver: ${receiver.location}`;
    panel.querySelector('[data-sdr-mode]').value = sdr.mode;
    panel.querySelector('[data-sdr-receiver-select]').value = String(sdr.receiverIndex);
    panel.querySelector('[data-sdr-toggle]').textContent = sdr.socket || sdr.connected ? 'Stop' : 'Play';
  }

  function rssiToS(rssi) {
    if (!Number.isFinite(rssi)) return '';
    if (rssi >= -73) return `S9+${Math.max(0, Math.round(rssi + 73))}`;
    const value = Math.max(0, Math.min(9, Math.round(9 + (rssi + 73) / 6)));
    return `S${value}`;
  }

  function updateRssi(rssi) {
    sdr.lastRssi = rssi;
    const suffix = rssiToS(rssi);
    playerEl('[data-sdr-rssi]').textContent = Number.isFinite(rssi)
      ? `RSSI ${rssi.toFixed(1)} dB${suffix ? ` · ${suffix}` : ''}`
      : 'RSSI --';
  }

  async function ensureAudioContext() {
    if (sdr.audioContext && sdr.audioContext.state !== 'closed') {
      if (sdr.audioContext.state === 'suspended') await sdr.audioContext.resume();
      return sdr.audioContext;
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) throw new Error('Web Audio is not supported in this browser.');
    const context = new AudioContextCtor({ latencyHint: 'interactive' });
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    const gain = context.createGain();
    gain.gain.value = Number(playerEl('[data-sdr-volume]').value || 0.75);
    analyser.connect(gain);
    gain.connect(context.destination);
    sdr.audioContext = context;
    sdr.analyser = analyser;
    sdr.gain = gain;
    sdr.nextPlayTime = context.currentTime + 0.08;
    startSpectrumAnimation();
    return context;
  }

  function scheduleAudio(samples) {
    const context = sdr.audioContext;
    if (!context || context.state === 'closed' || !samples?.length) return;
    const sampleRate = Number.isFinite(sdr.sampleRate) && sdr.sampleRate > 1000 ? sdr.sampleRate : 12000;
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(sdr.analyser);
    const now = context.currentTime;
    if (sdr.nextPlayTime < now + 0.035 || sdr.nextPlayTime > now + 0.55) sdr.nextPlayTime = now + 0.055;
    source.start(sdr.nextPlayTime);
    sdr.nextPlayTime += samples.length / sampleRate;
  }

  function decodePcm(bytes, littleEndian) {
    const count = Math.floor(bytes.byteLength / 2);
    const samples = new Float32Array(count);
    const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
    for (let i = 0; i < count; i += 1) samples[i] = view.getInt16(i * 2, littleEndian) / 32768;
    return samples;
  }

  function sendSocket(message) {
    if (sdr.socket?.readyState === WebSocket.OPEN) sdr.socket.send(message);
  }

  function sendTuning() {
    if (!Number.isFinite(sdr.frequency)) return;
    const mode = PASSBANDS[sdr.mode] ? sdr.mode : 'am';
    const [lowCut, highCut] = PASSBANDS[mode];
    sendSocket(`SET mod=${mode} low_cut=${lowCut} high_cut=${highCut} freq=${sdr.frequency.toFixed(3)}`);
  }

  function configureSdr() {
    if (sdr.configured) return;
    sdr.configured = true;
    sendSocket('SET ident_user=Signal Scout');
    sendTuning();
    sendSocket('SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50');
    sendSocket('SET compression=0');
    sendSocket('SET squelch=0 max=0');
    sendSocket('SET genattn=0');
    sendSocket('SET gen=0 mix=-1');
    sendSocket('SET de_emp=0');
  }

  function parseKiwiMessage(bytes) {
    if (bytes.byteLength < 4) return;
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    if (tag === 'MSG') {
      const text = sdr.decoder.decode(bytes.subarray(4));
      const sampleRate = text.match(/(?:^|\s)sample_rate=([0-9.]+)/)?.[1];
      const audioRate = text.match(/(?:^|\s)audio_rate=([0-9]+)/)?.[1];
      if (sampleRate) {
        sdr.sampleRate = Number(sampleRate) || sdr.sampleRate;
        configureSdr();
      }
      if (audioRate && sdr.audioContext) {
        sendSocket(`SET AR OK in=${Number(audioRate)} out=${Math.round(sdr.audioContext.sampleRate)}`);
      }
      if (/(?:^|\s)too_busy=1(?:\s|$)/.test(text)) failCurrentReceiver('Receiver is full. Trying another receiver…');
      if (/(?:^|\s)down=1(?:\s|$)/.test(text)) failCurrentReceiver('Receiver is offline. Trying another receiver…');
      return;
    }

    if (tag !== 'SND' || bytes.byteLength < 10) return;
    const body = bytes.subarray(3);
    const flags = body[0];
    const smeter = (body[5] << 8) | body[6];
    const rssi = smeter * 0.1 - 127;
    updateRssi(rssi);

    if ((flags & 0x10) !== 0) {
      sendSocket('SET compression=0');
      return;
    }

    const littleEndian = (flags & 0x80) !== 0;
    const audioBytes = body.subarray(7);
    if (audioBytes.byteLength < 2) return;
    scheduleAudio(decodePcm(audioBytes, littleEndian));

    if (!sdr.gotAudio) {
      sdr.gotAudio = true;
      sdr.connected = true;
      window.clearTimeout(sdr.connectTimer);
      setStatus('Live RF', true);
      setMessage('Actual receiver audio · spectrum and waterfall are generated from the live audio stream.');
      updatePlayerReadout();
    }
  }

  function websocketUrl(receiverIndex) {
    const receiver = RECEIVERS[receiverIndex] || RECEIVERS[0];
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const timestamp = (Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 10000)) >>> 0;
    return `${scheme}//${window.location.host}/api/sdr/ws?receiver=${encodeURIComponent(receiver.id)}&stream=SND&ts=${timestamp}`;
  }

  function clearConnectionTimers() {
    window.clearTimeout(sdr.connectTimer);
    window.clearInterval(sdr.keepaliveTimer);
    sdr.connectTimer = null;
    sdr.keepaliveTimer = null;
  }

  function disconnectSocket() {
    clearConnectionTimers();
    const socket = sdr.socket;
    sdr.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try { socket.close(1000, 'Signal Scout disconnect'); } catch {}
    }
    sdr.connected = false;
    sdr.configured = false;
    sdr.gotAudio = false;
  }

  function nextFallbackReceiver() {
    for (let offset = 1; offset <= RECEIVERS.length; offset += 1) {
      const index = (sdr.receiverIndex + offset) % RECEIVERS.length;
      if (!sdr.fallbackTried.has(index)) return index;
    }
    return null;
  }

  function failCurrentReceiver(message) {
    if (sdr.manualStop) return;
    disconnectSocket();
    setMessage(message, true);
    const next = nextFallbackReceiver();
    if (next == null) {
      setStatus('Unavailable', false);
      setMessage('None of the selected public receivers answered. Tap Retry or choose a different receiver.', true);
      playerEl('[data-sdr-toggle]').textContent = 'Retry';
      drawIdleSpectrum('NO RECEIVER');
      return;
    }
    sdr.fallbackTried.add(next);
    window.setTimeout(() => connectSdr(next), 450);
  }

  async function connectSdr(receiverIndex) {
    if (!Number.isFinite(sdr.frequency)) return;
    disconnectSocket();
    sdr.manualStop = false;
    sdr.receiverIndex = RECEIVERS[receiverIndex] ? receiverIndex : 0;
    sdr.fallbackTried.add(sdr.receiverIndex);
    updatePlayerReadout();
    setStatus('Connecting', false);
    setMessage(`Connecting to ${RECEIVERS[sdr.receiverIndex].location}…`);
    drawIdleSpectrum('CONNECTING');

    try {
      await ensureAudioContext();
    } catch (error) {
      setStatus('Audio blocked', false);
      setMessage(error.message || 'Could not start audio.', true);
      return;
    }

    let socket;
    try {
      socket = new WebSocket(websocketUrl(sdr.receiverIndex));
      socket.binaryType = 'arraybuffer';
    } catch {
      failCurrentReceiver('Could not open the receiver stream. Trying another receiver…');
      return;
    }
    sdr.socket = socket;

    socket.onopen = () => {
      sendSocket('SET auth t=kiwi p=#');
      sdr.keepaliveTimer = window.setInterval(() => sendSocket('SET keepalive'), 5000);
    };
    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) parseKiwiMessage(new Uint8Array(event.data));
      else if (event.data instanceof Blob) event.data.arrayBuffer().then((buffer) => parseKiwiMessage(new Uint8Array(buffer))).catch(() => {});
      else if (typeof event.data === 'string') parseKiwiMessage(new TextEncoder().encode(event.data));
    };
    socket.onerror = () => {
      if (!sdr.gotAudio) failCurrentReceiver('Receiver connection failed. Trying another receiver…');
    };
    socket.onclose = () => {
      if (!sdr.manualStop && !sdr.gotAudio) failCurrentReceiver('Receiver did not answer. Trying another receiver…');
      else if (!sdr.manualStop && sdr.gotAudio) {
        disconnectSocket();
        setStatus('Disconnected', false);
        setMessage('The public receiver disconnected. Tap Play to reconnect.', true);
        playerEl('[data-sdr-toggle]').textContent = 'Play';
      }
    };
    sdr.connectTimer = window.setTimeout(() => {
      if (!sdr.gotAudio) failCurrentReceiver('Receiver timed out. Trying another receiver…');
    }, 9000);
  }

  async function stopSdr({ keepPanel = true, message = 'Stopped.' } = {}) {
    sdr.manualStop = true;
    disconnectSocket();
    setStatus('Stopped', false);
    updateRssi(null);
    if (sdr.animationFrame) {
      cancelAnimationFrame(sdr.animationFrame);
      sdr.animationFrame = null;
    }
    const context = sdr.audioContext;
    sdr.audioContext = null;
    sdr.analyser = null;
    sdr.gain = null;
    if (context && context.state !== 'closed') {
      try { await context.close(); } catch {}
    }
    drawIdleSpectrum('STOPPED');
    setMessage(message);
    updatePlayerReadout();
    playerEl('[data-sdr-toggle]').textContent = 'Play';
    if (!keepPanel) {
      sdr.panel.hidden = true;
      document.body.classList.remove('sdr-player-open', 'sdr-player-minimized');
    }
  }

  function closePlayer() {
    stopSdr({ keepPanel: false });
  }

  function startPlayer({ frequency, station, mode = 'am', receiverIndex = selectedLookupReceiverIndex() }) {
    if (!Number.isFinite(frequency) || frequency < 100 || frequency > 30000) return;
    const panel = createPlayerShell();
    sdr.frequency = frequency;
    sdr.station = station || 'Live signal';
    sdr.mode = PASSBANDS[mode] ? mode : 'am';
    sdr.receiverIndex = RECEIVERS[receiverIndex] ? receiverIndex : 0;
    sdr.manualStop = false;
    sdr.fallbackTried.clear();
    panel.hidden = false;
    panel.classList.remove('is-minimized');
    document.body.classList.add('sdr-player-open');
    document.body.classList.remove('sdr-player-minimized');
    panel.querySelector('[data-sdr-minimize]').textContent = '⌄';
    updatePlayerReadout();
    connectSdr(sdr.receiverIndex);
  }

  function drawIdleSpectrum(label) {
    const canvas = sdr.panel?.querySelector('[data-sdr-canvas]');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(300, Math.round(rect.width * dpr));
    const height = Math.max(120, Math.round(rect.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#020608';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(37,212,230,.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += width / 10) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y < height; y += height / 6) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(124,234,242,.55)';
    ctx.font = `${10 * dpr}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(label, width / 2, height / 2);
  }

  function startSpectrumAnimation() {
    if (sdr.animationFrame) cancelAnimationFrame(sdr.animationFrame);
    const canvas = playerEl('[data-sdr-canvas]');
    const freqData = new Uint8Array(sdr.analyser.frequencyBinCount);

    const draw = () => {
      if (!sdr.analyser || !sdr.audioContext || sdr.audioContext.state === 'closed') return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const width = Math.max(300, Math.round(rect.width * dpr));
      const height = Math.max(120, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      const spectrumH = Math.round(height * 0.58);
      const waterfallTop = spectrumH + 1;
      const waterfallH = height - waterfallTop;
      sdr.analyser.getByteFrequencyData(freqData);

      if (waterfallH > 2) {
        ctx.drawImage(canvas, 0, waterfallTop, width, waterfallH - 1, 0, waterfallTop + 1, width, waterfallH - 1);
        const binW = width / freqData.length;
        for (let i = 0; i < freqData.length; i += 1) {
          const value = freqData[i] / 255;
          const hue = 190 - value * 120;
          const light = 7 + value * 55;
          ctx.fillStyle = `hsl(${hue} 85% ${light}%)`;
          ctx.fillRect(i * binW, waterfallTop, Math.ceil(binW + 1), 1);
        }
      }

      ctx.fillStyle = '#020608';
      ctx.fillRect(0, 0, width, spectrumH);
      ctx.strokeStyle = 'rgba(37,212,230,.08)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= width; x += width / 8) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, spectrumH); ctx.stroke();
      }
      for (let y = 0; y <= spectrumH; y += spectrumH / 4) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }

      ctx.beginPath();
      for (let i = 0; i < freqData.length; i += 1) {
        const x = (i / (freqData.length - 1)) * width;
        const normalized = freqData[i] / 255;
        const y = spectrumH - 5 - normalized * (spectrumH - 12);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#25d4e6';
      ctx.lineWidth = Math.max(1, 1.3 * dpr);
      ctx.stroke();

      const nyquist = (sdr.sampleRate || 12000) / 2;
      ctx.fillStyle = 'rgba(183,200,203,.55)';
      ctx.font = `${8 * dpr}px monospace`;
      ctx.textAlign = 'left';
      ctx.fillText('0 Hz', 4 * dpr, spectrumH - 5 * dpr);
      ctx.textAlign = 'center';
      ctx.fillText(`${(nyquist / 2000).toFixed(1)} kHz`, width / 2, spectrumH - 5 * dpr);
      ctx.textAlign = 'right';
      ctx.fillText(`${(nyquist / 1000).toFixed(1)} kHz`, width - 4 * dpr, spectrumH - 5 * dpr);

      sdr.animationFrame = requestAnimationFrame(draw);
    };
    draw();
  }

  function handleListenLiveClick(event) {
    const link = event.target.closest('.listen-live-button');
    if (!link) return;
    const container = link.closest('.lookup-result, .signal-card');
    const frequency = frequencyFromContainer(container);
    if (!Number.isFinite(frequency)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    startPlayer({
      frequency,
      station: stationFromContainer(container),
      mode: modeFromContainer(container),
      receiverIndex: selectedLookupReceiverIndex()
    });
  }

  createPlayerShell();
  document.addEventListener('click', handleListenLiveClick, true);
})();
