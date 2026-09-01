(() => {
  if (window.__freqbeaconSdrHandshakeBridge?.version) return;

  const VERSION = 'sdr-player-handshake-bridge-v3';
  const PASSBANDS = {
    am: [-4900, 4900],
    sam: [-4900, 4900],
    usb: [300, 2700],
    lsb: [-2700, -300]
  };
  const decoder = new TextDecoder();
  const attachedSockets = new WeakSet();
  const configuredSockets = new WeakSet();

  function send(socket, command) {
    try {
      if (socket?.readyState !== 1) return false;
      socket.send(command);
      return true;
    } catch {
      return false;
    }
  }

  function currentTune() {
    const text = document.querySelector('[data-sdr-frequency]')?.textContent || '';
    const match = text.replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)\s*kHz/i);
    const frequency = Number(match?.[1]);
    const selectedMode = String(document.querySelector('[data-sdr-mode]')?.value || 'am').toLowerCase();
    const mode = PASSBANDS[selectedMode] ? selectedMode : 'am';
    if (!Number.isFinite(frequency) || frequency <= 0) return null;
    return { frequency, mode };
  }

  function configureSocket(socket, sampleRate, receiverId = '') {
    if (!socket || configuredSockets.has(socket) || socket.readyState !== 1) return false;
    const tune = currentTune();
    if (!tune) return false;

    const [lowCut, highCut] = PASSBANDS[tune.mode];
    const commands = [
      'SET ident_user=FREQBEACON',
      `SET mod=${tune.mode} low_cut=${lowCut} high_cut=${highCut} freq=${tune.frequency.toFixed(3)}`,
      'SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50',
      'SET compression=0',
      'SET squelch=0 max=0',
      'SET genattn=0',
      'SET gen=0 mix=-1',
      'SET de_emp=0',
      `SET AR OK in=${Math.max(1, Math.round(Number(sampleRate) || 12000))} out=48000`
    ];

    let sent = 0;
    commands.forEach((command) => { if (send(socket, command)) sent += 1; });
    if (sent !== commands.length) return false;

    configuredSockets.add(socket);
    window.dispatchEvent(new CustomEvent('freqbeacon:snd-handshake-bridge', {
      detail: {
        version: VERSION,
        receiverId,
        frequency: tune.frequency,
        mode: tune.mode,
        sampleRate: Number(sampleRate) || null,
        commandsSent: sent
      }
    }));
    return true;
  }

  function inspectMessage(socket, receiverId, data) {
    let bytes = null;
    if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    if (!bytes || bytes.byteLength < 4) return;
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    if (tag !== 'MSG') return;
    let text = '';
    try { text = decoder.decode(bytes.subarray(4)); } catch { return; }
    const sampleRate = text.match(/(?:^|\s)sample_rate=([0-9.]+)/)?.[1];
    if (sampleRate) configureSocket(socket, Number(sampleRate), receiverId);
  }

  function attachSocket(socket, receiverId = '') {
    if (!socket || attachedSockets.has(socket)) return;
    attachedSockets.add(socket);
    socket.addEventListener('message', (event) => {
      if (event.data instanceof Blob) {
        event.data.arrayBuffer()
          .then((buffer) => inspectMessage(socket, receiverId, buffer))
          .catch(() => {});
        return;
      }
      inspectMessage(socket, receiverId, event.data);
    });
  }

  window.addEventListener('freqbeacon:snd-created', (event) => {
    attachSocket(event.detail?.socket, event.detail?.receiverId || '');
  });

  window.__freqbeaconSdrHandshakeBridge = {
    version: VERSION,
    captureMode: 'real-player-socket-only',
    opensControlSocket: false
  };
})();
