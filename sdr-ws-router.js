(() => {
  const PreviousWebSocket = window.WebSocket;
  const NativeWebSocket = window.__signalScoutNativeWebSocket || window.WebSocket?.prototype?.constructor || PreviousWebSocket;

  function parseSdrUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl), window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== '/api/sdr/ws') return null;
      return {
        stream: url.searchParams.get('stream') || 'SND'
      };
    } catch {
      return null;
    }
  }

  function construct(Ctor, url, protocols) {
    return protocols === undefined ? new Ctor(url) : new Ctor(url, protocols);
  }

  function SignalScoutSdrWebSocket(url, protocols) {
    const meta = parseSdrUrl(url);
    if (meta?.stream === 'W/F') {
      // W/F is a companion stream, not an audio-health probe. Use the browser's
      // native WebSocket so the audio watchdog can never close it for failing to
      // produce SND frames.
      return construct(NativeWebSocket, url, protocols);
    }

    // SND keeps the existing health-aware WebSocket behavior so failed public
    // receivers are still learned and cooled down locally.
    return construct(PreviousWebSocket, url, protocols);
  }

  SignalScoutSdrWebSocket.prototype = PreviousWebSocket.prototype;
  Object.defineProperties(SignalScoutSdrWebSocket, {
    CONNECTING: { value: NativeWebSocket.CONNECTING ?? PreviousWebSocket.CONNECTING ?? 0 },
    OPEN: { value: NativeWebSocket.OPEN ?? PreviousWebSocket.OPEN ?? 1 },
    CLOSING: { value: NativeWebSocket.CLOSING ?? PreviousWebSocket.CLOSING ?? 2 },
    CLOSED: { value: NativeWebSocket.CLOSED ?? PreviousWebSocket.CLOSED ?? 3 }
  });

  window.WebSocket = SignalScoutSdrWebSocket;
})();
