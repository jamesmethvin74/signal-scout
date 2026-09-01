(() => {
  const VERSION = 'sdr-pair-diagnostics-v1';
  const HOLD_MS = 6000;
  const TOTAL_TIMEOUT_MS = 12000;
  const PASSBANDS = {
    am: [-4900, 4900],
    sam: [-4900, 4900],
    usb: [300, 2700],
    lsb: [-2700, -300]
  };
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const $ = (id) => document.getElementById(id);
  const report = { version:VERSION, generatedAt:null, inputs:null, sndOnly:null, paired:null, verdict:null };

  function stage(id, text, state = '') {
    const el = $(id);
    el.textContent = text;
    el.className = `stage${state ? ` ${state}` : ''}`;
  }

  function verdict(text, state = 'running') {
    const el = $('verdict');
    el.textContent = text;
    el.className = `verdict ${state}`;
  }

  function writeRaw() {
    $('raw').textContent = JSON.stringify(report, null, 2);
  }

  function frameFrom(data) {
    let bytes = null;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    else if (typeof data === 'string') bytes = encoder.encode(data);
    if (!bytes || bytes.length < 3) return { tag:'', bytes:bytes?.length || 0, text:'' };
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    const text = tag === 'MSG' && bytes.length > 4 ? decoder.decode(bytes.subarray(4)) : '';
    return { tag, bytes:bytes.length, text };
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

  function configureSnd(ws, frequency, mode) {
    const safeMode = PASSBANDS[mode] ? mode : 'am';
    const [lowCut, highCut] = PASSBANDS[safeMode];
    [
      'SET ident_user=FREQBEACON pair diagnostic',
      `SET mod=${safeMode} low_cut=${lowCut} high_cut=${highCut} freq=${Number(frequency).toFixed(3)}`,
      'SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50',
      'SET compression=0',
      'SET squelch=0 max=0',
      'SET genattn=0',
      'SET gen=0 mix=-1',
      'SET de_emp=0'
    ].forEach((command) => send(ws, command));
  }

  function configureWf(ws, frequency) {
    [
      'SET ident_user=FREQBEACON pair diagnostic',
      'SERVER DE CLIENT FREQBEACON W/F',
      'SET wf_comp=0',
      'SET send_dB=1',
      `SET zoom=10 cf=${Number(frequency).toFixed(3)}`,
      'SET maxdb=-10 mindb=-130',
      'SET wf_speed=2',
      'SET interp=13',
      'SET keepalive'
    ].forEach((command) => send(ws, command));
  }

  function runSession({ receiver, frequency, mode, paired, stageId }) {
    return new Promise((resolve) => {
      const started = performance.now();
      const timestamp = (Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 10000)) >>> 0;
      const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const sndUrl = `${scheme}//${location.host}/api/sdr/ws?receiver=${encodeURIComponent(receiver)}&stream=SND&ts=${timestamp}`;
      const wfUrl = `${scheme}//${location.host}/api/sdr/ws?receiver=${encodeURIComponent(receiver)}&stream=${encodeURIComponent('W/F')}&ts=${timestamp}`;
      const result = {
        ok:false,
        paired,
        timestamp,
        sndUrl,
        wfUrl:paired ? wfUrl : null,
        stage:'creating-snd',
        sndOpenMs:null,
        authSentMs:null,
        sampleRateMs:null,
        firstSndMs:null,
        holdCompletedMs:null,
        sndFrames:0,
        sndBytes:0,
        sampleRate:null,
        audioRate:null,
        sndMessages:[],
        sndClose:null,
        sndError:null,
        wf:null
      };
      const state = { done:false, sndConfigured:false, holdStarted:false, wfOpened:false };
      let snd = null;
      let wf = null;
      let keepalive = null;
      let wfKeepalive = null;
      let holdTimer = null;
      let totalTimer = null;

      function elapsed() { return Math.round(performance.now() - started); }

      function finish(patch = {}) {
        if (state.done) return;
        state.done = true;
        clearInterval(keepalive);
        clearInterval(wfKeepalive);
        clearTimeout(holdTimer);
        clearTimeout(totalTimer);
        Object.assign(result, patch, { elapsedMs:elapsed() });
        try { if (wf && wf.readyState < WebSocket.CLOSING) wf.close(1000, 'FREQBEACON pair diagnostic complete'); } catch {}
        try { if (snd && snd.readyState < WebSocket.CLOSING) snd.close(1000, 'FREQBEACON pair diagnostic complete'); } catch {}
        const stateClass = result.ok ? 'good' : 'bad';
        const wfText = paired
          ? `\nW/F: ${result.wf?.stage || 'not opened'} · ${result.wf?.frames || 0} frames${result.wf?.close ? ` · close ${result.wf.close.code}` : ''}`
          : '';
        stage(stageId, `${result.stage}\nSND open: ${result.sndOpenMs ?? '?'} ms · first SND: ${result.firstSndMs ?? '?'} ms\nSND frames: ${result.sndFrames}${wfText}${result.sndClose ? `\nSND close: ${result.sndClose.code} ${result.sndClose.reason || ''}` : ''}`, stateClass);
        resolve(result);
      }

      function beginHold() {
        if (state.holdStarted || state.done) return;
        state.holdStarted = true;
        result.stage = paired ? 'holding-snd-with-wf' : 'holding-snd-only';
        stage(stageId, `${result.stage}\nFirst SND at ${result.firstSndMs} ms · holding ${HOLD_MS / 1000}s…`);
        holdTimer = setTimeout(() => {
          result.holdCompletedMs = elapsed();
          finish({ ok:true, stage:paired ? 'snd-stable-with-wf' : 'snd-stable-alone' });
        }, HOLD_MS);
      }

      function openWaterfall() {
        if (!paired || state.wfOpened || state.done) return;
        state.wfOpened = true;
        result.wf = {
          stage:'creating-wf',
          openMs:null,
          authSentMs:null,
          firstFrameMs:null,
          messages:0,
          frames:0,
          lastFrameBytes:null,
          close:null,
          error:null
        };
        try {
          wf = new WebSocket(wfUrl);
          wf.binaryType = 'arraybuffer';
        } catch (error) {
          result.wf.stage = 'wf-constructor-failed';
          result.wf.error = error?.message || String(error);
          return;
        }
        wf.onopen = () => {
          result.wf.openMs = elapsed();
          result.wf.stage = 'wf-open';
          send(wf, 'SET auth t=kiwi p=#');
          result.wf.authSentMs = elapsed();
          configureWf(wf, frequency);
          wfKeepalive = setInterval(() => send(wf, 'SET keepalive'), 2500);
        };
        wf.onmessage = async (event) => {
          let data = event.data;
          if (data instanceof Blob) {
            try { data = await data.arrayBuffer(); } catch { return; }
          }
          const frame = frameFrom(data);
          if (frame.tag === 'MSG') {
            result.wf.messages += 1;
            if (/\bwf_setup\b/.test(frame.text)) configureWf(wf, frequency);
          } else if (frame.tag === 'W/F') {
            result.wf.frames += 1;
            result.wf.lastFrameBytes = frame.bytes;
            if (result.wf.firstFrameMs == null) {
              result.wf.firstFrameMs = elapsed();
              result.wf.stage = 'wf-frame-received';
            }
          }
        };
        wf.onerror = () => {
          result.wf.error = 'W/F WebSocket error';
          if (result.wf.stage === 'creating-wf') result.wf.stage = 'wf-error-before-open';
        };
        wf.onclose = (event) => {
          result.wf.close = { code:event.code || 0, reason:event.reason || '', wasClean:Boolean(event.wasClean), elapsedMs:elapsed() };
          if (!state.done && result.wf.stage !== 'wf-frame-received') result.wf.stage = 'wf-closed';
        };
      }

      stage(stageId, paired ? 'Opening clean SND session; W/F will join after sample_rate…' : 'Opening clean SND-only session…');
      try {
        snd = new WebSocket(sndUrl);
        snd.binaryType = 'arraybuffer';
      } catch (error) {
        result.sndError = error?.message || String(error);
        finish({ stage:'snd-constructor-failed' });
        return;
      }

      snd.onopen = () => {
        result.sndOpenMs = elapsed();
        result.stage = 'snd-open';
        if (send(snd, 'SET auth t=kiwi p=#')) result.authSentMs = elapsed();
        keepalive = setInterval(() => send(snd, 'SET keepalive'), 2500);
      };

      snd.onmessage = async (event) => {
        let data = event.data;
        if (data instanceof Blob) {
          try { data = await data.arrayBuffer(); } catch { return; }
        }
        const frame = frameFrom(data);
        if (frame.tag === 'MSG') {
          const text = String(frame.text || '').trim();
          if (text && result.sndMessages.length < 10) result.sndMessages.push(text.slice(0, 300));
          const sampleRate = text.match(/(?:^|\s)sample_rate=([0-9.]+)/)?.[1];
          const audioRate = text.match(/(?:^|\s)audio_rate=([0-9]+)/)?.[1];
          if (sampleRate && result.sampleRateMs == null) {
            result.sampleRate = Number(sampleRate);
            result.sampleRateMs = elapsed();
            result.stage = 'sample-rate-received';
            if (!state.sndConfigured) {
              state.sndConfigured = true;
              configureSnd(snd, frequency, mode);
            }
            if (paired) openWaterfall();
          }
          if (audioRate) {
            result.audioRate = Number(audioRate);
            send(snd, `SET AR OK in=${Number(audioRate)} out=48000`);
          }
          if (/(?:^|\s)too_busy=(?:1|\d+)(?:\s|$)/.test(text)) finish({ stage:'receiver-busy', sndError:'Kiwi reported too_busy' });
          else if (/(?:^|\s)down=(?:1|\d+)(?:\s|$)/.test(text)) finish({ stage:'receiver-down', sndError:'Kiwi reported down' });
          else if (/(?:^|\s)badp=([1-9]\d*)(?:\s|$)/.test(text)) finish({ stage:'auth-rejected', sndError:'Kiwi reported badp' });
          return;
        }
        if (frame.tag === 'SND' && frame.bytes >= 10) {
          result.sndFrames += 1;
          result.sndBytes += frame.bytes;
          if (result.firstSndMs == null) {
            result.firstSndMs = elapsed();
            beginHold();
          }
        }
      };

      snd.onerror = () => {
        result.sndError = 'SND WebSocket error';
      };

      snd.onclose = (event) => {
        result.sndClose = { code:event.code || 0, reason:event.reason || '', wasClean:Boolean(event.wasClean), elapsedMs:elapsed() };
        if (!state.done) {
          finish({
            stage:result.firstSndMs == null ? 'snd-closed-before-audio' : 'snd-closed-during-hold',
            sndError:result.sndError || event.reason || `closed ${event.code || 0}`
          });
        }
      };

      totalTimer = setTimeout(() => {
        const timeoutStage = result.sndOpenMs == null
          ? 'snd-never-opened'
          : (result.sampleRateMs == null ? 'snd-no-sample-rate' : (result.firstSndMs == null ? 'snd-no-audio' : 'hold-timeout'));
        finish({ stage:timeoutStage, sndError:'Session did not complete diagnostic within 12 seconds' });
      }, TOTAL_TIMEOUT_MS);
    });
  }

  function computeVerdict(sndOnly, paired) {
    if (sndOnly?.ok && !paired?.ok) {
      return {
        state:'bad',
        text:`W/F INTERFERENCE CONFIRMED. SND-only stayed healthy for ${HOLD_MS / 1000}s, but the paired session failed at ${paired.stage}${paired.sndClose ? ` (SND close ${paired.sndClose.code}${paired.sndClose.reason ? `: ${paired.sndClose.reason}` : ''})` : ''}. The RF pairing path is killing or destabilizing audio.`
      };
    }
    if (!sndOnly?.ok) {
      return {
        state:'bad',
        text:`PERSISTENT SND FAILURE. Even the clean SND-only session failed at ${sndOnly?.stage || 'unknown'}. The earlier one-frame test was too short; inspect this report's SND close/error details.`
      };
    }
    if (sndOnly?.ok && paired?.ok) {
      return {
        state:'good',
        text:`PAIR TRANSPORT PASSES. SND-only and simultaneous SND+W/F both stayed alive for ${HOLD_MS / 1000}s. The remaining disconnect is inside the normal FREQBEACON player lifecycle after transport, not Kiwi pairing.`
      };
    }
    return { state:'bad', text:'Unexpected pair diagnostic state. Use the full report below.' };
  }

  async function run() {
    const receiver = $('receiver').value.trim().toLowerCase();
    const frequency = Number($('frequency').value);
    const mode = $('mode').value;
    $('run').disabled = true;
    verdict('Running SND-only control…', 'running');
    stage('sndOnlyStage', 'Queued…');
    stage('pairedStage', 'Queued…');
    report.generatedAt = new Date().toISOString();
    report.inputs = { receiver, frequency, mode, origin:location.origin, userAgent:navigator.userAgent, standalone:matchMedia('(display-mode: standalone)').matches, holdMs:HOLD_MS };
    report.sndOnly = null;
    report.paired = null;
    report.verdict = null;
    writeRaw();

    report.sndOnly = await runSession({ receiver, frequency, mode, paired:false, stageId:'sndOnlyStage' });
    writeRaw();
    await new Promise((resolve) => setTimeout(resolve, 500));

    verdict('SND-only complete. Running simultaneous SND + W/F…', 'running');
    report.paired = await runSession({ receiver, frequency, mode, paired:true, stageId:'pairedStage' });
    report.verdict = computeVerdict(report.sndOnly, report.paired);
    verdict(report.verdict.text, report.verdict.state);
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

  setTimeout(run, 300);
})();
