(() => {
  const VERSION = 'sdr-browser-deep-diagnostics-v1';
  const PASSBANDS = {
    am: [-4900, 4900],
    sam: [-4900, 4900],
    usb: [300, 2700],
    lsb: [-2700, -300]
  };

  const $ = (id) => document.getElementById(id);
  const report = { version:VERSION, generatedAt:null, inputs:null, worker:null, browser:null, verdict:null };

  function setStage(id, text, state = '') {
    const el = $(id);
    el.textContent = text;
    el.className = `stage${state ? ` ${state}` : ''}`;
  }

  function setVerdict(text, state = 'running') {
    const el = $('verdict');
    el.textContent = text;
    el.className = `verdict ${state}`;
  }

  function writeRaw() {
    $('raw').textContent = JSON.stringify(report, null, 2);
  }

  function decodeFrame(data) {
    let bytes = null;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (typeof data === 'string') bytes = new TextEncoder().encode(data);
    if (!bytes || bytes.length < 3) return { tag:'', text:'', bytes:bytes?.length || 0 };
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    const text = tag === 'MSG' && bytes.length > 4 ? new TextDecoder().decode(bytes.subarray(4)) : '';
    return { tag, text, bytes:bytes.length };
  }

  function configureSocket(ws, frequency, mode, state) {
    if (state.configured) return;
    state.configured = true;
    const safeMode = PASSBANDS[mode] ? mode : 'am';
    const [lowCut, highCut] = PASSBANDS[safeMode];
    const commands = [
      'SET ident_user=FREQBEACON diagnostic browser',
      `SET mod=${safeMode} low_cut=${lowCut} high_cut=${highCut} freq=${Number(frequency).toFixed(3)}`,
      'SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50',
      'SET compression=0',
      'SET squelch=0 max=0',
      'SET genattn=0',
      'SET gen=0 mix=-1',
      'SET de_emp=0'
    ];
    for (const command of commands) {
      try { ws.send(command); } catch {}
    }
  }

  function runBrowserProbe({ receiver, frequency, mode }) {
    return new Promise((resolve) => {
      const started = performance.now();
      const result = {
        ok:false,
        stage:'creating-websocket',
        wsOpenMs:null,
        authSentMs:null,
        sampleRateMs:null,
        firstSndMs:null,
        sampleRate:null,
        audioRate:null,
        firstSndBytes:null,
        serverMessages:[],
        close:null,
        error:null
      };
      const state = { configured:false, done:false };
      const timestamp = (Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 10000)) >>> 0;
      const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${scheme}//${location.host}/api/sdr/ws?receiver=${encodeURIComponent(receiver)}&stream=SND&ts=${timestamp}`;
      result.url = wsUrl;
      result.timestamp = timestamp;
      setStage('browserStage', 'Creating clean browser WebSocket…');

      let ws;
      try {
        ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';
      } catch (error) {
        result.stage = 'websocket-constructor-failed';
        result.error = error?.message || String(error);
        result.elapsedMs = Math.round(performance.now() - started);
        setStage('browserStage', `${result.stage}\n${result.error}`, 'bad');
        resolve(result);
        return;
      }

      const finish = (patch = {}) => {
        if (state.done) return;
        state.done = true;
        clearTimeout(timer);
        clearInterval(keepalive);
        Object.assign(result, patch, { elapsedMs:Math.round(performance.now() - started) });
        try { ws.close(1000, 'FREQBEACON diagnostic complete'); } catch {}
        setStage('browserStage', `${result.stage}\n${result.error || (result.ok ? `SND received in ${result.firstSndMs} ms` : '')}`, result.ok ? 'good' : 'bad');
        resolve(result);
      };

      let keepalive = null;
      ws.onopen = () => {
        result.wsOpenMs = Math.round(performance.now() - started);
        result.stage = 'ws-open';
        setStage('browserStage', `WebSocket OPEN at ${result.wsOpenMs} ms\nSending Kiwi auth…`);
        try {
          ws.send('SET auth t=kiwi p=#');
          result.authSentMs = Math.round(performance.now() - started);
          keepalive = setInterval(() => {
            try { if (ws.readyState === WebSocket.OPEN) ws.send('SET keepalive'); } catch {}
          }, 2500);
        } catch (error) {
          finish({ stage:'auth-send-failed', error:error?.message || String(error) });
        }
      };

      ws.onmessage = async (event) => {
        let data = event.data;
        if (data instanceof Blob) {
          try { data = await data.arrayBuffer(); } catch { return; }
        }
        const frame = decodeFrame(data);
        if (frame.tag === 'MSG') {
          const text = String(frame.text || '').trim();
          if (text && result.serverMessages.length < 8) result.serverMessages.push(text.slice(0, 280));
          const sampleRate = text.match(/(?:^|\s)sample_rate=([0-9.]+)/)?.[1];
          const audioRate = text.match(/(?:^|\s)audio_rate=([0-9]+)/)?.[1];
          if (sampleRate && result.sampleRateMs == null) {
            result.sampleRate = Number(sampleRate);
            result.sampleRateMs = Math.round(performance.now() - started);
            result.stage = 'sample-rate-received';
            setStage('browserStage', `WebSocket OPEN ${result.wsOpenMs} ms\nKiwi sample_rate at ${result.sampleRateMs} ms\nWaiting for SND…`);
            configureSocket(ws, frequency, mode, state);
          }
          if (audioRate) {
            result.audioRate = Number(audioRate);
            try { ws.send(`SET AR OK in=${Number(audioRate)} out=48000`); } catch {}
          }
          if (/(?:^|\s)too_busy=(?:1|\d+)(?:\s|$)/.test(text)) finish({ stage:'receiver-busy', error:'Kiwi reported too_busy' });
          else if (/(?:^|\s)down=(?:1|\d+)(?:\s|$)/.test(text)) finish({ stage:'receiver-down', error:'Kiwi reported down' });
          else if (/(?:^|\s)badp=([1-9]\d*)(?:\s|$)/.test(text)) finish({ stage:'auth-rejected', error:'Kiwi reported badp' });
          else if (/(?:^|\s)reason_disabled=\S+/.test(text)) finish({ stage:'receiver-disabled', error:'Kiwi reported reason_disabled' });
          return;
        }
        if (frame.tag === 'SND' && frame.bytes >= 10) {
          result.firstSndMs = Math.round(performance.now() - started);
          result.firstSndBytes = frame.bytes;
          finish({ ok:true, stage:'first-snd-received' });
        }
      };

      ws.onerror = () => {
        result.error = 'Browser WebSocket error';
      };
      ws.onclose = (event) => {
        result.close = { code:event.code || 0, reason:event.reason || '', wasClean:Boolean(event.wasClean) };
        if (!state.done) finish({ stage:'socket-closed-before-snd', error:result.error || event.reason || `closed ${event.code || 0}` });
      };

      const timer = setTimeout(() => {
        const stage = result.wsOpenMs == null
          ? 'browser-ws-never-opened'
          : (result.sampleRateMs == null ? 'browser-no-sample-rate' : 'browser-no-snd-after-config');
        finish({ stage, error:'No usable SND audio within 9000 ms' });
      }, 9000);
    });
  }

  async function runWorkerProbe({ receiver, frequency, mode }) {
    setStage('workerStage', 'Running Cloudflare Worker deep probe…');
    const url = new URL('/api/sdr/diagnostics', location.origin);
    url.searchParams.set('receiver', receiver);
    url.searchParams.set('frequency', String(frequency));
    url.searchParams.set('mode', mode);
    url.searchParams.set('_', String(Date.now()));
    const started = performance.now();
    try {
      const response = await fetch(url, { cache:'no-store', headers:{ Accept:'application/json', 'Cache-Control':'no-cache' } });
      const text = await response.text();
      let json;
      try { json = JSON.parse(text); } catch {
        json = { ok:false, stage:'invalid-json', status:response.status, body:text.slice(0, 500) };
      }
      json.clientFetchElapsedMs = Math.round(performance.now() - started);
      const native = json?.stages?.nativeUi;
      if (json.ok) {
        setStage('workerStage', `Worker → Kiwi PASS\nSND at ${native?.firstSndMs ?? '?'} ms\nW/F ${json?.stages?.waterfall?.ok ? 'upgrade OK' : 'not confirmed'}`, 'good');
      } else {
        setStage('workerStage', `Worker → Kiwi FAIL\nStage: ${native?.stage || json.stage || 'unknown'}\n${native?.error || json.error || ''}`, 'bad');
      }
      return json;
    } catch (error) {
      const result = { ok:false, stage:'diagnostic-http-failed', error:error?.message || String(error), elapsedMs:Math.round(performance.now() - started) };
      setStage('workerStage', `${result.stage}\n${result.error}`, 'bad');
      return result;
    }
  }

  function computeVerdict(worker, browser) {
    const workerSnd = Boolean(worker?.ok && worker?.stages?.nativeUi?.firstSndMs != null);
    const browserSnd = Boolean(browser?.ok && browser?.firstSndMs != null);
    if (workerSnd && browserSnd) {
      return {
        state:'good',
        text:'TRANSPORT PASSES. Cloudflare and a clean browser both receive Kiwi SND. The fault is inside the normal FREQBEACON player/wrapper stack.'
      };
    }
    if (workerSnd && !browserSnd) {
      return {
        state:'bad',
        text:`PROXY/CLIENT PATH FAILURE. Cloudflare itself receives Kiwi SND, but the clean browser path fails at ${browser?.stage || 'unknown stage'}.`
      };
    }
    if (!workerSnd) {
      const stage = worker?.stages?.nativeUi?.stage || worker?.stage || 'unknown stage';
      return {
        state:'bad',
        text:`UPSTREAM FAILURE ISOLATED. Cloudflare cannot complete the Kiwi SND session. Worker stage: ${stage}.`
      };
    }
    return { state:'bad', text:'Diagnostic reached an unexpected state. Use the full report below.' };
  }

  async function run() {
    const receiver = $('receiver').value.trim().toLowerCase();
    const frequency = Number($('frequency').value);
    const mode = $('mode').value;
    $('run').disabled = true;
    setVerdict('Running deep transport diagnostics…', 'running');
    setStage('workerStage', 'Queued…');
    setStage('browserStage', 'Queued…');
    report.generatedAt = new Date().toISOString();
    report.inputs = { receiver, frequency, mode, origin:location.origin, userAgent:navigator.userAgent, standalone:matchMedia('(display-mode: standalone)').matches };
    report.worker = null;
    report.browser = null;
    report.verdict = null;
    writeRaw();

    // Run sequentially so the diagnostic does not occupy multiple Kiwi channels
    // and accidentally create its own busy condition.
    report.worker = await runWorkerProbe({ receiver, frequency, mode });
    writeRaw();
    await new Promise((resolve) => setTimeout(resolve, 250));
    report.browser = await runBrowserProbe({ receiver, frequency, mode });
    report.verdict = computeVerdict(report.worker, report.browser);
    setVerdict(report.verdict.text, report.verdict.state);
    writeRaw();
    $('run').disabled = false;
  }

  $('run').addEventListener('click', run);
  $('copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      $('copy').textContent = 'Copied';
      setTimeout(() => { $('copy').textContent = 'Copy report'; }, 1200);
    } catch {
      $('copy').textContent = 'Copy failed';
    }
  });

  setTimeout(run, 250);
})();
