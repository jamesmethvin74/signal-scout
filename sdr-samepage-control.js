(() => {
  if (window.__freqbeaconSamePageControl?.version) return;

  const VERSION = 'sdr-samepage-control-v2-ar-ok';
  const CONTROL_RECEIVER = 'km4rt.ddns.net:8073';
  const CONTROL_FREQUENCY_KHZ = 5990;
  const TIMEOUT_MS = 5000;
  const AR_OK_INPUT_RATE = 12000;
  const AR_OK_OUTPUT_RATE = 48000;
  const decoder = new TextDecoder();
  const arOkSockets = new WeakSet();

  const state = {
    version: VERSION,
    startedAt: new Date().toISOString(),
    constructorIdentity: null,
    baseline: null
  };

  const elapsedFrom = (started) => Math.round(performance.now() - started);

  function constructorInfo() {
    const captured = window.__signalScoutNativeWebSocket || null;
    const current = window.WebSocket || null;
    return {
      capturedExists: typeof captured === 'function',
      currentExists: typeof current === 'function',
      sameReference: Boolean(captured && current && captured === current),
      capturedName: captured?.name || null,
      currentName: current?.name || null,
      capturedPrototypeMatchesCurrent: Boolean(captured?.prototype && current?.prototype && captured.prototype === current.prototype)
    };
  }

  function frameInfo(data) {
    let bytes = null;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (!bytes || bytes.length < 3) return { tag:'', text:'', bytes:bytes?.length || 0 };
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    let text = '';
    if (tag === 'MSG' && bytes.length > 4) {
      try { text = decoder.decode(bytes.subarray(4)); } catch {}
    }
    return { tag, text, bytes:bytes.length };
  }

  function send(ws, command) {
    try {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(command);
        return true;
      }
    } catch {}
    return false;
  }

  function sendArOk(ws, inputRate = AR_OK_INPUT_RATE, outputRate = AR_OK_OUTPUT_RATE) {
    if (!ws || arOkSockets.has(ws)) return false;
    const safeIn = Math.max(1, Math.round(Number(inputRate) || AR_OK_INPUT_RATE));
    const safeOut = Math.max(1, Math.round(Number(outputRate) || AR_OK_OUTPUT_RATE));
    if (!send(ws, `SET AR OK in=${safeIn} out=${safeOut}`)) return false;
    arOkSockets.add(ws);
    return true;
  }

  // Kiwi's current server requires CMD_AR_OK as part of CMD_SND_ALL before it
  // will emit SND frames. The player announces snd-ready after sample_rate, so
  // clear that server-side gate immediately instead of waiting for a later
  // audio_rate message that is not guaranteed to arrive first.
  window.addEventListener('freqbeacon:snd-ready', (event) => {
    const socket = event.detail?.socket;
    if (!socket) return;
    sendArOk(socket);
  });

  function configure(ws) {
    [
      'SET ident_user=FREQBEACON same-page control',
      `SET mod=am low_cut=-4900 high_cut=4900 freq=${CONTROL_FREQUENCY_KHZ.toFixed(3)}`,
      'SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50',
      'SET compression=0',
      'SET squelch=0 max=0',
      'SET genattn=0',
      'SET gen=0 mix=-1',
      'SET de_emp=0'
    ].forEach((command) => send(ws, command));
  }

  function probeWith(Ctor, label) {
    return new Promise((resolve) => {
      const started = performance.now();
      const timestamp = (Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 10000)) >>> 0;
      const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${scheme}//${location.host}/api/sdr/ws?receiver=${encodeURIComponent(CONTROL_RECEIVER)}&stream=SND&ts=${timestamp}`;
      const result = {
        label,
        receiver: CONTROL_RECEIVER,
        frequency: CONTROL_FREQUENCY_KHZ,
        timestamp,
        url,
        stage: 'creating',
        ok: false,
        openMs: null,
        authSentMs: null,
        sampleRateMs: null,
        arOkSentMs: null,
        firstSndMs: null,
        sampleRate: null,
        sndFrames: 0,
        error: null,
        close: null,
        elapsedMs: null
      };

      let done = false;
      let ws = null;
      let timer = null;
      let configured = false;

      function finish(patch = {}) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        Object.assign(result, patch);
        result.elapsedMs = elapsedFrom(started);
        try {
          if (ws && ws.readyState < WebSocket.CLOSING) ws.close(1000, 'FREQBEACON same-page control complete');
        } catch {}
        resolve(result);
      }

      try {
        ws = new Ctor(url);
        ws.binaryType = 'arraybuffer';
      } catch (error) {
        finish({ stage:'constructor-failed', error:error?.message || String(error) });
        return;
      }

      ws.addEventListener('open', () => {
        result.openMs = elapsedFrom(started);
        result.stage = 'open';
        if (send(ws, 'SET auth t=kiwi p=#')) result.authSentMs = elapsedFrom(started);
      });

      ws.addEventListener('message', async (event) => {
        let data = event.data;
        if (data instanceof Blob) {
          try { data = await data.arrayBuffer(); } catch { return; }
        }
        const frame = frameInfo(data);
        if (frame.tag === 'MSG') {
          const sampleRate = frame.text.match(/(?:^|\s)sample_rate=([0-9.]+)/)?.[1];
          if (sampleRate && result.sampleRateMs == null) {
            result.sampleRate = Number(sampleRate);
            result.sampleRateMs = elapsedFrom(started);
            if (!configured) {
              configured = true;
              configure(ws);
            }
            if (sendArOk(ws, result.sampleRate, AR_OK_OUTPUT_RATE)) {
              result.arOkSentMs = elapsedFrom(started);
            }
          }
          return;
        }
        if (frame.tag === 'SND') {
          result.sndFrames += 1;
          if (result.firstSndMs == null) {
            result.firstSndMs = elapsedFrom(started);
            finish({ ok:true, stage:'first-snd-received' });
          }
        }
      });

      ws.addEventListener('error', () => {
        result.error = `WebSocket error at readyState ${ws?.readyState}`;
      });

      ws.addEventListener('close', (event) => {
        result.close = { code:event.code || 0, reason:event.reason || '', wasClean:Boolean(event.wasClean), elapsedMs:elapsedFrom(started) };
        if (!done) finish({ stage:'closed-before-snd' });
      });

      timer = setTimeout(() => finish({ stage:'timeout', error:result.error || 'No first SND frame before timeout' }), TIMEOUT_MS);
    });
  }

  function wrapDiagnosticReport() {
    const diagnostic = window.__freqbeaconSdrLifecycleV3;
    if (!diagnostic?.getReport || diagnostic.__samePageControlWrapped) return false;
    const originalGetReport = diagnostic.getReport.bind(diagnostic);
    diagnostic.getReport = () => ({
      ...originalGetReport(),
      samePageControl: {
        version: VERSION,
        constructorIdentity: state.constructorIdentity,
        baseline: state.baseline
      }
    });
    diagnostic.__samePageControlWrapped = true;
    return true;
  }

  async function runBaseline() {
    if (state.baseline?.started) return;
    state.constructorIdentity = constructorInfo();
    state.baseline = { started:true, startedAt:new Date().toISOString(), captured:null, current:null };
    const captured = window.__signalScoutNativeWebSocket;
    const current = window.WebSocket;

    if (typeof captured === 'function') {
      state.baseline.captured = await probeWith(captured, 'captured-native');
    } else {
      state.baseline.captured = { ok:false, stage:'constructor-missing' };
    }

    if (!state.baseline.captured?.ok && typeof current === 'function' && current !== captured) {
      state.baseline.current = await probeWith(current, 'current-global');
    }

    state.baseline.finishedAt = new Date().toISOString();
    wrapDiagnosticReport();
    window.dispatchEvent(new CustomEvent('freqbeacon:sdr-diagnostic-updated'));
  }

  window.__freqbeaconSamePageControl = {
    version: VERSION,
    getState: () => ({ ...state })
  };

  const attachTimer = setInterval(() => {
    if (wrapDiagnosticReport()) clearInterval(attachTimer);
  }, 100);
  window.addEventListener('pagehide', () => clearInterval(attachTimer), { once:true });

  // Run a single brief control session from the real application page before
  // the user starts Listen Live. It closes immediately after first SND.
  setTimeout(runBaseline, 150);
})();