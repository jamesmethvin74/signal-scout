(() => {
  const BaseWebSocket = window.WebSocket;
  const RF_START_TIMEOUT_MS = 10000;
  const WF_BINS = 1024;
  const COMPACT_WF_BYTES = 4 + WF_BINS;
  const EXTENDED_WF_HEADER_BYTES = 16;

  function waterfallUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl), window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== '/api/sdr/ws') return null;
      if ((url.searchParams.get('stream') || 'SND') !== 'W/F') return null;
      return url;
    } catch {
      return null;
    }
  }

  function isWaterfallBuffer(buffer) {
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 4) return false;
    const bytes = new Uint8Array(buffer, 0, 3);
    return bytes[0] === 87 && bytes[1] === 47 && bytes[2] === 70; // W/F
  }

  function normalizedWaterfallBuffer(buffer) {
    if (!isWaterfallBuffer(buffer) || buffer.byteLength !== COMPACT_WF_BYTES) return null;

    // Current KiwiSDR releases commonly send compact waterfall rows as:
    //   4-byte "W/F" + sequence header, followed by 1024 RF bins.
    // Signal Scout's original renderer understands the older observed
    // 16-byte extended header. Normalize compact rows into that shape here so
    // both current compact and older extended frames reach the same renderer.
    const source = new Uint8Array(buffer);
    const normalized = new Uint8Array(EXTENDED_WF_HEADER_BYTES + WF_BINS);
    normalized.set(source.subarray(0, 4), 0);
    normalized.set(source.subarray(4, 4 + WF_BINS), EXTENDED_WF_HEADER_BYTES);
    return normalized.buffer;
  }

  function WaterfallCompatibleWebSocket(url, protocols) {
    const parsed = waterfallUrl(url);
    const socket = protocols === undefined
      ? new BaseWebSocket(url)
      : new BaseWebSocket(url, protocols);

    if (!parsed) return socket;

    // Keep Kiwi's normal public auth/session behavior. Add the current client
    // marker and dB-row request when the RF helper identifies itself.
    const nativeSend = socket.send.bind(socket);
    let setupExtrasSent = false;
    socket.send = (message) => {
      if (typeof message === 'string' && message.startsWith('SET ident_user=')) {
        nativeSend('SET ident_user=SignalScout');
        if (!setupExtrasSent) {
          setupExtrasSent = true;
          nativeSend('SERVER DE CLIENT SignalScout W/F');
          nativeSend('SET send_dB=1');
        }
        return;
      }
      nativeSend(message);
    };

    let gotWaterfall = false;
    let timer = null;
    const clearTimer = () => {
      if (timer != null) window.clearTimeout(timer);
      timer = null;
    };

    const noteWaterfall = () => {
      if (gotWaterfall) return;
      gotWaterfall = true;
      clearTimer();
    };

    const dispatchNormalized = (buffer) => {
      if (!isWaterfallBuffer(buffer)) return;
      noteWaterfall();
      const normalized = normalizedWaterfallBuffer(buffer);
      if (!normalized) return;
      try {
        socket.dispatchEvent(new MessageEvent('message', { data: normalized }));
      } catch {
        // The original event still reaches the renderer. Older extended frames
        // need no normalization; compact rows will simply time out visibly.
      }
    };

    socket.addEventListener('open', () => {
      timer = window.setTimeout(() => {
        if (gotWaterfall || socket.readyState !== BaseWebSocket.OPEN) return;
        try { socket.close(4000, 'Signal Scout RF waterfall timeout'); } catch {}
      }, RF_START_TIMEOUT_MS);
    });

    socket.addEventListener('message', (event) => {
      if (event.data instanceof ArrayBuffer) {
        dispatchNormalized(event.data);
      } else if (event.data instanceof Blob) {
        event.data.arrayBuffer().then(dispatchNormalized).catch(() => {});
      } else if (typeof event.data === 'string' && event.data.startsWith('W/F')) {
        noteWaterfall();
      }
    });
    socket.addEventListener('close', clearTimer);
    socket.addEventListener('error', clearTimer);
    return socket;
  }

  WaterfallCompatibleWebSocket.prototype = BaseWebSocket.prototype;
  Object.defineProperties(WaterfallCompatibleWebSocket, {
    CONNECTING: { value: BaseWebSocket.CONNECTING },
    OPEN: { value: BaseWebSocket.OPEN },
    CLOSING: { value: BaseWebSocket.CLOSING },
    CLOSED: { value: BaseWebSocket.CLOSED }
  });

  window.WebSocket = WaterfallCompatibleWebSocket;
})();
