(() => {
  if (window.__freqbeaconDualStreamTrace) return;

  const OriginalWebSocket = window.WebSocket;
  if (typeof OriginalWebSocket !== 'function') return;

  const VERSION = 'sdr-dual-stream-trace-v1';
  const started = performance.now();
  const streams = [];
  const socketStates = new WeakMap();
  const heartbeat = {
    intervalMs: 250,
    ticks: 0,
    maxDriftMs: 0,
    over100Ms: 0,
    over500Ms: 0,
    over1000Ms: 0,
    largestDrifts: []
  };
  const longTasks = {
    supported: false,
    count: 0,
    totalMs: 0,
    maxMs: 0,
    largest: []
  };

  const elapsed = () => Number((performance.now() - started).toFixed(1));

  function keepLargest(list, item, key, limit = 12) {
    list.push(item);
    list.sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0));
    if (list.length > limit) list.length = limit;
  }

  function streamMeta(rawUrl) {
    try {
      const url = new URL(String(rawUrl), location.href);
      if (url.origin !== location.origin || url.pathname !== '/api/sdr/ws') return null;
      const stream = url.searchParams.get('stream') || 'SND';
      if (stream !== 'SND' && stream !== 'W/F') return null;
      return {
        stream,
        receiver: url.searchParams.get('receiver') || '',
        timestamp: url.searchParams.get('ts') || '',
        url: `${url.pathname}${url.search}`
      };
    } catch {
      return null;
    }
  }

  function byteView(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return null;
  }

  function tagOf(bytes) {
    if (!bytes || bytes.length < 3) return '';
    return String.fromCharCode(bytes[0], bytes[1], bytes[2]);
  }

  function updateGap(record, now, sequence = null) {
    if (record.lastFramePerf != null) {
      const gap = now - record.lastFramePerf;
      record.gapTotalMs += gap;
      record.gapCount += 1;
      record.maxGapMs = Math.max(record.maxGapMs, gap);
      if (gap >= 70) record.gapsOver70Ms += 1;
      if (gap >= 100) record.gapsOver100Ms += 1;
      if (gap >= 250) record.gapsOver250Ms += 1;
      if (gap >= 500) record.gapsOver500Ms += 1;
      if (gap >= 1000) record.gapsOver1000Ms += 1;
      if (gap >= 100) {
        keepLargest(record.largestGaps, {
          gapMs: Number(gap.toFixed(1)),
          afterFrame: record.frames,
          afterSequence: record.lastSequence,
          atElapsedMs: elapsed()
        }, 'gapMs');
      }
    }
    record.lastFramePerf = now;
    if (sequence != null) record.lastSequence = sequence;
  }

  function attach(socket, rawUrl) {
    const meta = streamMeta(rawUrl);
    if (!meta || socketStates.has(socket)) return;

    const record = {
      ...meta,
      createdMs: elapsed(),
      openMs: null,
      firstFrameMs: null,
      lastFrameMs: null,
      frames: 0,
      msgFrames: 0,
      bytes: 0,
      firstSequence: null,
      lastSequence: null,
      missingSequenceFrames: 0,
      duplicateSequenceFrames: 0,
      outOfOrderSequenceFrames: 0,
      averageGapMs: null,
      maxGapMs: 0,
      gapsOver70Ms: 0,
      gapsOver100Ms: 0,
      gapsOver250Ms: 0,
      gapsOver500Ms: 0,
      gapsOver1000Ms: 0,
      largestGaps: [],
      close: null,
      error: null,
      lastFramePerf: null,
      gapTotalMs: 0,
      gapCount: 0
    };
    streams.push(record);
    if (streams.length > 8) streams.splice(0, streams.length - 8);
    socketStates.set(socket, record);

    socket.addEventListener('open', () => {
      record.openMs = elapsed();
    });

    socket.addEventListener('message', (event) => {
      const bytes = byteView(event.data);
      if (!bytes) return;
      const tag = tagOf(bytes);
      if (tag === 'MSG') {
        record.msgFrames += 1;
        return;
      }
      if (tag !== meta.stream) return;

      const now = performance.now();
      let sequence = null;
      if (meta.stream === 'SND' && bytes.length >= 8) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        sequence = view.getUint32(4, true);
        if (record.firstSequence == null) record.firstSequence = sequence;
        if (record.lastSequence != null) {
          const delta = (sequence - record.lastSequence) >>> 0;
          if (delta === 0) record.duplicateSequenceFrames += 1;
          else if (delta > 1 && delta < 0x80000000) record.missingSequenceFrames += delta - 1;
          else if (delta >= 0x80000000) record.outOfOrderSequenceFrames += 1;
        }
      }

      updateGap(record, now, sequence);
      record.frames += 1;
      record.bytes += bytes.byteLength;
      record.lastFrameMs = elapsed();
      if (record.firstFrameMs == null) record.firstFrameMs = record.lastFrameMs;
      record.averageGapMs = record.gapCount
        ? Number((record.gapTotalMs / record.gapCount).toFixed(1))
        : null;
      record.maxGapMs = Number(record.maxGapMs.toFixed(1));
    });

    socket.addEventListener('error', () => {
      record.error = { atMs: elapsed() };
    });

    socket.addEventListener('close', (event) => {
      record.close = {
        atMs: elapsed(),
        code: event.code,
        reason: event.reason || '',
        wasClean: event.wasClean
      };
    });
  }

  function TraceWebSocket(url, protocols) {
    const socket = protocols === undefined
      ? new OriginalWebSocket(url)
      : new OriginalWebSocket(url, protocols);
    attach(socket, url);
    return socket;
  }

  TraceWebSocket.prototype = OriginalWebSocket.prototype;
  Object.defineProperties(TraceWebSocket, {
    CONNECTING: { value: OriginalWebSocket.CONNECTING },
    OPEN: { value: OriginalWebSocket.OPEN },
    CLOSING: { value: OriginalWebSocket.CLOSING },
    CLOSED: { value: OriginalWebSocket.CLOSED }
  });
  window.WebSocket = TraceWebSocket;

  let expectedHeartbeat = performance.now() + heartbeat.intervalMs;
  window.setInterval(() => {
    const now = performance.now();
    const drift = Math.max(0, now - expectedHeartbeat);
    heartbeat.ticks += 1;
    heartbeat.maxDriftMs = Math.max(heartbeat.maxDriftMs, drift);
    if (drift >= 100) heartbeat.over100Ms += 1;
    if (drift >= 500) heartbeat.over500Ms += 1;
    if (drift >= 1000) heartbeat.over1000Ms += 1;
    if (drift >= 100) {
      keepLargest(heartbeat.largestDrifts, {
        driftMs: Number(drift.toFixed(1)),
        atElapsedMs: elapsed()
      }, 'driftMs');
    }
    expectedHeartbeat = now + heartbeat.intervalMs;
  }, heartbeat.intervalMs);

  try {
    if (typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      longTasks.supported = true;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const duration = Number(entry.duration || 0);
          longTasks.count += 1;
          longTasks.totalMs += duration;
          longTasks.maxMs = Math.max(longTasks.maxMs, duration);
          keepLargest(longTasks.largest, {
            durationMs: Number(duration.toFixed(1)),
            startElapsedMs: Number((entry.startTime - started).toFixed(1))
          }, 'durationMs');
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    }
  } catch {}

  function publicStream(record) {
    const {
      lastFramePerf, gapTotalMs, gapCount, ...safe
    } = record;
    return { ...safe };
  }

  function report() {
    return {
      version: VERSION,
      generatedAt: new Date().toISOString(),
      elapsedMs: elapsed(),
      href: location.href,
      userAgent: navigator.userAgent,
      visibilityState: document.visibilityState,
      player: {
        status: document.querySelector('[data-sdr-status]')?.textContent?.trim() || null,
        frequency: document.querySelector('[data-sdr-frequency]')?.textContent?.trim() || null,
        receiver: document.querySelector('[data-sdr-receiver]')?.textContent?.trim() || null,
        message: document.querySelector('[data-sdr-message]')?.textContent?.trim() || null,
        rssi: document.querySelector('[data-sdr-rssi]')?.textContent?.trim() || null,
        mode: document.querySelector('[data-sdr-mode]')?.value || null
      },
      heartbeat: {
        ...heartbeat,
        maxDriftMs: Number(heartbeat.maxDriftMs.toFixed(1))
      },
      longTasks: {
        ...longTasks,
        totalMs: Number(longTasks.totalMs.toFixed(1)),
        maxMs: Number(longTasks.maxMs.toFixed(1))
      },
      streams: streams.map(publicStream)
    };
  }

  function showReport(text) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#041018;padding:12px;display:flex;flex-direction:column;gap:8px';
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close report';
    close.style.cssText = 'min-height:44px;border:1px solid #42c8e8;border-radius:8px;background:#0b2633;color:#dff7ff;font-weight:800';
    const area = document.createElement('textarea');
    area.readOnly = true;
    area.value = text;
    area.style.cssText = 'flex:1;width:100%;border:1px solid #28566a;border-radius:8px;background:#02090d;color:#d7eef7;padding:10px;font:12px monospace';
    close.addEventListener('click', () => overlay.remove());
    overlay.append(close, area);
    document.body.appendChild(overlay);
    area.focus();
    area.select();
  }

  async function copyReport() {
    const text = JSON.stringify(report(), null, 2);
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch {}
    if (!copied) {
      try {
        const area = document.createElement('textarea');
        area.value = text;
        area.style.cssText = 'position:fixed;left:-9999px;top:0';
        document.body.appendChild(area);
        area.focus();
        area.select();
        copied = document.execCommand('copy');
        area.remove();
      } catch {}
    }
    if (!copied) showReport(text);
    return copied;
  }

  function installButton() {
    if (!document.body || document.getElementById('freqbeaconSdrTraceButton')) return;
    const button = document.createElement('button');
    button.id = 'freqbeaconSdrTraceButton';
    button.type = 'button';
    button.textContent = 'Copy SDR trace';
    button.style.cssText = 'position:fixed;right:10px;bottom:84px;z-index:2147483000;min-height:42px;padding:0 13px;border:1px solid #42c8e8;border-radius:8px;background:#0b2633;color:#dff7ff;font:800 12px system-ui;box-shadow:0 4px 18px rgba(0,0,0,.45)';
    button.addEventListener('click', async () => {
      const original = button.textContent;
      button.textContent = 'Copying…';
      const copied = await copyReport();
      button.textContent = copied ? 'Copied ✓' : 'Report shown';
      window.setTimeout(() => { button.textContent = original; }, 1800);
    });
    document.body.appendChild(button);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installButton, { once: true });
  } else {
    installButton();
  }

  window.__freqbeaconDualStreamTrace = {
    version: VERSION,
    getReport: report,
    copyReport
  };
})();
