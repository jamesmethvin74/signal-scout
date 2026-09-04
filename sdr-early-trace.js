(() => {
  'use strict';

  if (window.__freqbeaconSdrEarlyTrace) return;

  const NativeWebSocket = window.WebSocket;
  const START = performance.now();
  const HEARTBEAT_MS = 500;
  const MAX_SOCKETS = 12;
  const MAX_MESSAGES_PER_SOCKET = 3200;
  const MAX_HANDLERS_PER_SOCKET = 1800;
  const MAX_LONG_TASKS = 800;
  const MAX_HEARTBEATS = 900;
  const MAX_MARKS = 40;

  const state = {
    version: 'early-stream-timing-v1',
    startedAt: START,
    sockets: [],
    longTasks: [],
    heartbeats: [],
    marks: [],
    visibility: [{ at: START, state: document.visibilityState }],
    dropped: {
      sockets: 0,
      messages: 0,
      handlers: 0,
      longTasks: 0,
      heartbeats: 0,
      marks: 0
    }
  };

  function now() {
    return performance.now();
  }

  function pushCapped(array, value, limit, dropKey) {
    if (array.length >= limit) {
      array.shift();
      state.dropped[dropKey] += 1;
    }
    array.push(value);
  }

  function socketMeta(rawUrl) {
    try {
      const url = new URL(String(rawUrl), window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== '/api/sdr/ws') return null;
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

      // W/F rendering is the most likely expensive path, so time every W/F
      // dispatch. SND dispatches are sampled to keep trace overhead tiny.
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

  function TraceWebSocket(url, protocols) {
    const socket = protocols === undefined
      ? new NativeWebSocket(url)
      : new NativeWebSocket(url, protocols);
    observeSocket(socket, url);
    return socket;
  }

  TraceWebSocket.prototype = NativeWebSocket.prototype;
  Object.defineProperties(TraceWebSocket, {
    CONNECTING: { value: NativeWebSocket.CONNECTING },
    OPEN: { value: NativeWebSocket.OPEN },
    CLOSING: { value: NativeWebSocket.CLOSING },
    CLOSED: { value: NativeWebSocket.CLOSED }
  });

  window.WebSocket = TraceWebSocket;

  let longTaskObserver = null;
  if (typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        pushCapped(
          state.longTasks,
          [entry.startTime, entry.startTime + entry.duration],
          MAX_LONG_TASKS,
          'longTasks'
        );
      }
    });
    try {
      longTaskObserver.observe({ type: 'longtask', buffered: true });
    } catch {
      longTaskObserver = null;
    }
  }

  let heartbeatExpected = now() + HEARTBEAT_MS;
  const heartbeatTimer = window.setInterval(() => {
    const actual = now();
    pushCapped(state.heartbeats, [heartbeatExpected, actual], MAX_HEARTBEATS, 'heartbeats');
    heartbeatExpected += HEARTBEAT_MS;
    if (actual - heartbeatExpected > HEARTBEAT_MS * 4) heartbeatExpected = actual + HEARTBEAT_MS;
  }, HEARTBEAT_MS);

  document.addEventListener('visibilitychange', () => {
    state.visibility.push({ at: now(), state: document.visibilityState });
  });

  function percentile(values, fraction) {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * fraction)));
    return sorted[index];
  }

  function rounded(value, places = 1) {
    const factor = 10 ** places;
    return Math.round(Number(value || 0) * factor) / factor;
  }

  function gapStats(record) {
    const gaps = [];
    const significant = [];
    for (let i = 1; i < record.messages.length; i += 1) {
      const start = record.messages[i - 1];
      const end = record.messages[i];
      const gap = end - start;
      gaps.push(gap);
      if (gap >= 250) significant.push([start, end]);
    }

    let longTaskOverlap = 0;
    for (const [start, end] of significant) {
      if (state.longTasks.some(([taskStart, taskEnd]) => taskStart <= end && taskEnd >= start)) longTaskOverlap += 1;
    }

    const handlerDurations = record.handlers.map(([start, end]) => Math.max(0, end - start));
    return {
      capturedMessages: record.messages.length,
      totalMessages: record.messageCount,
      medianGapMs: rounded(percentile(gaps, 0.5)),
      p95GapMs: rounded(percentile(gaps, 0.95)),
      maxGapMs: rounded(gaps.length ? Math.max(...gaps) : 0),
      gapsOver250Ms: significant.length,
      gapsOver500Ms: gaps.filter((gap) => gap >= 500).length,
      gapsOver1000Ms: gaps.filter((gap) => gap >= 1000).length,
      significantGapsOverlappingLongTask: longTaskOverlap,
      longTaskOverlapPct: significant.length ? rounded(longTaskOverlap * 100 / significant.length) : 0,
      sampledHandlerCount: handlerDurations.length,
      p95HandlerMs: rounded(percentile(handlerDurations, 0.95)),
      maxHandlerMs: rounded(handlerDurations.length ? Math.max(...handlerDurations) : 0)
    };
  }

  function summary() {
    const elapsed = now() - START;
    const taskDurations = state.longTasks.map(([start, end]) => Math.max(0, end - start));
    const heartbeatDrifts = state.heartbeats.map(([expected, actual]) => Math.max(0, actual - expected));

    return {
      version: state.version,
      elapsedSec: rounded(elapsed / 1000, 2),
      visibility: state.visibility.slice(),
      marks: state.marks.slice(),
      heartbeat: {
        intervalMs: HEARTBEAT_MS,
        captured: state.heartbeats.length,
        p95DriftMs: rounded(percentile(heartbeatDrifts, 0.95)),
        maxDriftMs: rounded(heartbeatDrifts.length ? Math.max(...heartbeatDrifts) : 0)
      },
      longTasks: {
        supported: Boolean(longTaskObserver),
        count: state.longTasks.length,
        totalMs: rounded(taskDurations.reduce((sum, value) => sum + value, 0)),
        p95Ms: rounded(percentile(taskDurations, 0.95)),
        maxMs: rounded(taskDurations.length ? Math.max(...taskDurations) : 0)
      },
      sockets: state.sockets.map((record) => ({
        id: record.id,
        stream: record.stream,
        receiver: record.receiver,
        timestamp: record.timestamp,
        createdAt: rounded(record.createdAt),
        openedAt: record.openedAt === null ? null : rounded(record.openedAt),
        closedAt: record.closedAt === null ? null : rounded(record.closedAt),
        errorAt: record.errorAt === null ? null : rounded(record.errorAt),
        closeCode: record.closeCode,
        closeClean: record.closeClean,
        ...gapStats(record)
      })),
      dropped: { ...state.dropped }
    };
  }

  function rawReport() {
    return {
      summary: summary(),
      raw: {
        startedAt: state.startedAt,
        sockets: state.sockets.map((record) => ({ ...record })),
        longTasks: state.longTasks.slice(),
        heartbeats: state.heartbeats.slice(),
        marks: state.marks.slice(),
        visibility: state.visibility.slice()
      }
    };
  }

  function addMark(event) {
    const dispatchAt = now();
    const eventAt = Number(event?.timeStamp);
    pushCapped(state.marks, {
      eventAt: Number.isFinite(eventAt) ? eventAt : dispatchAt,
      dispatchAt,
      inputDelayMs: Number.isFinite(eventAt) ? Math.max(0, dispatchAt - eventAt) : 0
    }, MAX_MARKS, 'marks');
  }

  async function copyReport(button) {
    const text = JSON.stringify(rawReport(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      if (button) {
        const previous = button.textContent;
        button.textContent = 'TRACE COPIED';
        window.setTimeout(() => { button.textContent = previous; }, 1400);
      }
      return true;
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.readOnly = true;
      textarea.style.cssText = 'position:fixed;inset:8%;z-index:2147483647;width:84%;height:70%;padding:10px;background:#06111b;color:#d9f7ff;border:1px solid #28d7e5;font:11px/1.35 monospace;';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      return false;
    }
  }

  function installControls() {
    if (!document.body || document.querySelector('[data-sdr-early-trace-controls]')) return;
    const controls = document.createElement('div');
    controls.dataset.sdrEarlyTraceControls = 'true';
    controls.style.cssText = 'position:fixed;right:8px;top:8px;z-index:2147483646;display:flex;gap:6px;pointer-events:auto;';

    const mark = document.createElement('button');
    mark.type = 'button';
    mark.textContent = 'MARK HANG';
    mark.style.cssText = 'border:1px solid #28d7e5;border-radius:7px;padding:8px 10px;background:#07131d;color:#d9f7ff;font:800 10px monospace;';
    mark.addEventListener('click', (event) => {
      addMark(event);
      const previous = mark.textContent;
      mark.textContent = 'MARKED';
      window.setTimeout(() => { mark.textContent = previous; }, 700);
    });

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'COPY TRACE';
    copy.style.cssText = mark.style.cssText;
    copy.addEventListener('click', () => copyReport(copy));

    controls.append(mark, copy);
    document.body.appendChild(controls);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installControls, { once: true });
  } else {
    installControls();
  }

  window.__freqbeaconSdrEarlyTrace = {
    version: state.version,
    state,
    summary,
    rawReport,
    mark: () => addMark(null),
    copy: () => copyReport(null),
    stop() {
      window.clearInterval(heartbeatTimer);
      try { longTaskObserver?.disconnect(); } catch {}
    }
  };
})();
