(() => {
  'use strict';

  const trace = window.__freqbeaconSdrEarlyTrace;
  if (!trace?.state || window.__freqbeaconSdrSocketTraceV2) return;

  const PreviousWebSocket = window.WebSocket;
  const state = trace.state;
  const MAX_SOCKETS = 12;
  const MAX_MESSAGES_PER_SOCKET = 3200;
  const MAX_HANDLERS_PER_SOCKET = 1800;

  state.version = 'early-stream-timing-v2';
  trace.version = state.version;

  function now() {
    return performance.now();
  }

  function socketMeta(rawUrl) {
    try {
      const url = new URL(String(rawUrl), window.location.href);
      if (url.host !== window.location.host || url.pathname !== '/api/sdr/ws') return null;
      const stream = url.searchParams.get('stream') || 'SND';
      if (!['SND', 'W/F'].includes(stream)) return null;
      return {
        stream,
        receiver: url.searchParams.get('receiver') || '',
        timestamp: url.searchParams.get('ts') || ''
      };
    } catch {
      return null;
    }
  }

  function pushCapped(array, value, limit, dropKey) {
    if (array.length >= limit) {
      array.shift();
      state.dropped[dropKey] += 1;
    }
    array.push(value);
  }

  function observeSocket(socket, rawUrl) {
    const meta = socketMeta(rawUrl);
    if (!meta) return;

    if (state.sockets.length >= MAX_SOCKETS) {
      state.sockets.shift();
      state.dropped.sockets += 1;
    }

    const record = {
      id: `${meta.stream}-${state.sockets.length + state.dropped.sockets + 1}`,
      stream: meta.stream,
      receiver: meta.receiver,
      timestamp: meta.timestamp,
      createdAt: now(),
      openedAt: null,
      closedAt: null,
      errorAt: null,
      closeCode: null,
      closeClean: null,
      messageCount: 0,
      messages: [],
      handlers: []
    };
    state.sockets.push(record);

    socket.addEventListener('open', () => {
      record.openedAt = now();
    }, { once: true });

    socket.addEventListener('message', () => {
      const started = now();
      record.messageCount += 1;
      pushCapped(record.messages, started, MAX_MESSAGES_PER_SOCKET, 'messages');

      const measureHandler = record.stream === 'W/F' || record.messageCount % 8 === 0;
      if (measureHandler) {
        queueMicrotask(() => {
          pushCapped(record.handlers, [started, now()], MAX_HANDLERS_PER_SOCKET, 'handlers');
        });
      }
    });

    socket.addEventListener('error', () => {
      if (record.errorAt === null) record.errorAt = now();
    });

    socket.addEventListener('close', (event) => {
      record.closedAt = now();
      record.closeCode = Number(event.code || 0);
      record.closeClean = Boolean(event.wasClean);
    }, { once: true });
  }

  function SocketTraceWebSocket(url, protocols) {
    const socket = protocols === undefined
      ? new PreviousWebSocket(url)
      : new PreviousWebSocket(url, protocols);
    observeSocket(socket, url);
    return socket;
  }

  SocketTraceWebSocket.prototype = PreviousWebSocket.prototype;
  Object.defineProperties(SocketTraceWebSocket, {
    CONNECTING: { value: PreviousWebSocket.CONNECTING },
    OPEN: { value: PreviousWebSocket.OPEN },
    CLOSING: { value: PreviousWebSocket.CLOSING },
    CLOSED: { value: PreviousWebSocket.CLOSED }
  });

  window.WebSocket = SocketTraceWebSocket;
  window.__freqbeaconSdrSocketTraceV2 = {
    version: state.version,
    hostMatch: true
  };
})();
