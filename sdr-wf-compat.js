(() => {
  const BaseWebSocket = window.WebSocket;

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

  function separateWaterfallSession(url) {
    const original = Number(url.searchParams.get('ts'));
    if (!Number.isFinite(original)) return url.toString();

    // Kiwi's paired SND/W/F reference client uses a different WebSocket
    // timestamp for each stream. Reusing the SND timestamp can prevent the
    // waterfall channel from establishing even while audio is already live.
    let next = (Math.trunc(original) + 1) >>> 0;
    if (next === 0) next = 1;
    url.searchParams.set('ts', String(next));
    return url.toString();
  }

  function WaterfallCompatibleWebSocket(url, protocols) {
    const parsed = waterfallUrl(url);
    const actualUrl = parsed ? separateWaterfallSession(parsed) : url;
    const socket = protocols === undefined
      ? new BaseWebSocket(actualUrl)
      : new BaseWebSocket(actualUrl, protocols);

    if (!parsed) return socket;

    // Kiwi's public waterfall clients authenticate with an empty password.
    // The audio path's '#' form is tolerated by many receivers, but it is not
    // the reference W/F handshake and some receivers never start waterfall data.
    const nativeSend = socket.send.bind(socket);
    socket.send = (message) => nativeSend(
      typeof message === 'string' && message === 'SET auth t=kiwi p=#'
        ? 'SET auth t=kiwi p='
        : message
    );
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
