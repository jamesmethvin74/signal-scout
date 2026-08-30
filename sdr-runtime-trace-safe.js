(() => {
  const TRACE_KEY = 'freqbeacon:sdr-runtime-trace:v1';
  const HEALTH_KEY = 'signalScout:sdrHealth:v1';
  const MAX_ENTRIES = 480;
  const tracedFetchTarget = window.fetch.bind(window);
  const decoder = new TextDecoder();

  function safeValue(value) {
    if (value == null) return value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    try { return JSON.parse(JSON.stringify(value)); } catch { return String(value); }
  }

  function readTrace() {
    try {
      const parsed = JSON.parse(localStorage.getItem(TRACE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function trace(event, detail = {}) {
    const entry = {
      t: new Date().toISOString(),
      p: Math.round(performance.now()),
      event,
      href: location.href,
      visibility: document.visibilityState,
      detail: safeValue(detail)
    };
    try {
      const entries = readTrace();
      entries.push(entry);
      localStorage.setItem(TRACE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
    } catch {}
    try { console.info('[FREQBEACON SDR TRACE SAFE]', event, detail); } catch {}
    return entry;
  }

  function healthSnapshot() {
    try {
      const health = JSON.parse(localStorage.getItem(HEALTH_KEY) || '{}');
      return Object.entries(health || {}).slice(0, 30).map(([id, entry]) => ({
        id,
        failures: Number(entry?.failures || 0),
        cooldownUntil: Number(entry?.cooldownUntil || 0),
        lastFailureReason: entry?.lastFailureReason || '',
        lastFailure: Number(entry?.lastFailure || 0),
        lastSuccess: Number(entry?.lastSuccess || 0)
      }));
    } catch {
      return [];
    }
  }

  function describeButton(button) {
    if (!button) return {};
    return {
      tag: button.tagName,
      id: button.id || '',
      className: button.className || '',
      type: button.getAttribute('type'),
      href: button.getAttribute('href'),
      text: button.textContent?.trim().replace(/\s+/g, ' ').slice(0, 160) || ''
    };
  }

  function frequencyFromCard(card) {
    const freqEl = card?.querySelector('.frequency');
    if (!freqEl) return null;
    const unit = freqEl.querySelector('span')?.textContent?.trim().toLowerCase() || '';
    const clone = freqEl.cloneNode(true);
    clone.querySelector('span')?.remove();
    const value = Number(clone.textContent.replace(/,/g, '').trim());
    if (!Number.isFinite(value) || value <= 0) return null;
    return unit.includes('mhz') ? value * 1000 : value;
  }

  function runtimeSnapshot() {
    return {
      receiverRuntimePresent: Boolean(window.__freqbeaconReceiverRuntime),
      receiverRuntimeVersion: window.__freqbeaconReceiverRuntime?.version || '',
      livePoolCount: Number(window.__freqbeaconReceiverRuntime?.livePoolCount || 0),
      livePoolUpdatedAt: Number(window.__freqbeaconReceiverRuntime?.livePoolUpdatedAt || 0),
      lookupReceiverButtonExists: Boolean(document.getElementById('lookupReceiverButton')),
      playerExists: Boolean(document.getElementById('sdrPlayer')),
      receiverOptionsButtons: document.querySelectorAll('.card-receiver-options').length,
      listenLiveButtons: document.querySelectorAll('.listen-live-button').length,
      serviceWorkerControlled: Boolean(navigator.serviceWorker?.controller),
      online: navigator.onLine
    };
  }

  function chooserSnapshot(label) {
    const chooser = document.querySelector('.sdr-chooser');
    const choices = chooser ? [...chooser.querySelectorAll('.sdr-choice')] : [];
    trace(label, {
      chooserExists: Boolean(chooser),
      chooserHidden: chooser ? Boolean(chooser.hidden) : null,
      choiceCount: choices.length,
      selectedIndex: choices.findIndex((choice) => choice.classList.contains('is-selected')),
      choiceNames: choices.slice(0, 10).map((choice) => choice.querySelector('.sdr-choice-name')?.textContent?.trim() || ''),
      lookupFrequency: document.getElementById('lookupFrequency')?.value || '',
      runtime: runtimeSnapshot(),
      health: healthSnapshot()
    });
  }

  function playerSnapshot(label) {
    const panel = document.getElementById('sdrPlayer');
    trace(label, {
      playerExists: Boolean(panel),
      playerHidden: panel ? Boolean(panel.hidden) : null,
      status: panel?.querySelector('[data-sdr-status]')?.textContent?.trim() || '',
      station: panel?.querySelector('[data-sdr-station]')?.textContent?.trim() || '',
      frequency: panel?.querySelector('[data-sdr-frequency]')?.textContent?.trim() || '',
      receiverReadout: panel?.querySelector('[data-sdr-receiver]')?.textContent?.trim() || '',
      receiverButton: panel?.querySelector('[data-sdr-receiver-button-name]')?.textContent?.trim() || '',
      toggle: panel?.querySelector('[data-sdr-toggle]')?.textContent?.trim() || '',
      message: panel?.querySelector('[data-sdr-message]')?.textContent?.trim() || '',
      runtime: runtimeSnapshot(),
      health: healthSnapshot()
    });
  }

  function scheduleSnapshots(prefix) {
    [0, 100, 500, 1500, 3000, 7000, 10500].forEach((delay) => {
      setTimeout(() => {
        chooserSnapshot(`${prefix}-chooser-${delay}ms`);
        playerSnapshot(`${prefix}-player-${delay}ms`);
      }, delay);
    });
  }

  function isReceiverUrl(raw) {
    try {
      const url = new URL(String(raw), window.location.href);
      return url.origin === window.location.origin && url.pathname.startsWith('/api/sdr/receivers');
    } catch {
      return false;
    }
  }

  async function traceReceiverPayload(response, requestUrl, started) {
    try {
      const clone = response.clone();
      const payload = await clone.json();
      trace('receiver-fetch-body', {
        requestUrl,
        totalMs: Math.round(performance.now() - started),
        receiverCount: Array.isArray(payload?.receivers) ? payload.receivers.length : 0,
        source: payload?.source || '',
        warning: payload?.warning || '',
        directoryHeader: response.headers.get('x-freqbeacon-sdr-directory') || '',
        liveRefreshHeader: response.headers.get('x-freqbeacon-sdr-live-refresh') || '',
        receivers: (payload?.receivers || []).slice(0, 12).map((receiver, index) => ({
          index,
          id: receiver?.id || '',
          name: receiver?.name || '',
          location: receiver?.location || '',
          recommended: Boolean(receiver?.recommended),
          role: receiver?.role || '',
          connectionHealth: receiver?.connectionHealth || ''
        }))
      });
    } catch (error) {
      trace('receiver-fetch-body-error', {
        requestUrl,
        totalMs: Math.round(performance.now() - started),
        name: error?.name || '',
        message: error?.message || String(error)
      });
    }
  }

  window.__freqbeaconSdrTrace = trace;
  window.__freqbeaconSdrTraceKey = TRACE_KEY;
  trace('trace-loaded', { version: 'sdr-trace-v3', receiverFetchClone: true, resourceTiming: true, websocketLifecycle: true });

  window.fetch = async function tracedFetch(input, init) {
    let requestUrl = '';
    try { requestUrl = typeof input === 'string' ? input : input?.url || String(input); } catch {}
    if (!isReceiverUrl(requestUrl)) return tracedFetchTarget(input, init);

    const started = performance.now();
    trace('receiver-fetch-start', {
      requestUrl,
      pathname: (() => { try { return new URL(requestUrl, location.href).pathname; } catch { return ''; } })(),
      signalAborted: Boolean(init?.signal?.aborted),
      runtime: runtimeSnapshot(),
      health: healthSnapshot()
    });
    try {
      const response = await tracedFetchTarget(input, init);
      trace('receiver-fetch-response', {
        requestUrl,
        status: response.status,
        ok: response.ok,
        ms: Math.round(performance.now() - started),
        directoryHeader: response.headers.get('x-freqbeacon-sdr-directory') || '',
        liveRefreshHeader: response.headers.get('x-freqbeacon-sdr-live-refresh') || '',
        responseUrl: response.url || '',
        bodyUsed: response.bodyUsed
      });
      traceReceiverPayload(response, requestUrl, started);
      return response;
    } catch (error) {
      trace('receiver-fetch-error', {
        requestUrl,
        ms: Math.round(performance.now() - started),
        name: error?.name || '',
        message: error?.message || String(error),
        signalAborted: Boolean(init?.signal?.aborted)
      });
      throw error;
    }
  };

  function installResourceObserver() {
    const record = (entry) => {
      if (!String(entry?.name || '').includes('/api/sdr/receivers')) return;
      trace('resource-timing', {
        name: entry.name,
        initiatorType: entry.initiatorType || '',
        startTime: Math.round(entry.startTime || 0),
        duration: Math.round(entry.duration || 0),
        responseStart: Math.round(entry.responseStart || 0),
        responseEnd: Math.round(entry.responseEnd || 0),
        transferSize: Number(entry.transferSize || 0)
      });
    };
    try {
      const observer = new PerformanceObserver((list) => list.getEntries().forEach(record));
      observer.observe({ type: 'resource', buffered: true });
    } catch {
      try { performance.getEntriesByType('resource').forEach(record); } catch {}
    }
  }

  function installWebSocketTrace() {
    if (window.__freqbeaconWsTraceInstalled) return;
    window.__freqbeaconWsTraceInstalled = true;
    const PreviousWebSocket = window.WebSocket;

    function TracedWebSocket(url, protocols) {
      const socket = protocols === undefined
        ? new PreviousWebSocket(url)
        : new PreviousWebSocket(url, protocols);
      let parsed = null;
      try { parsed = new URL(String(url), window.location.href); } catch {}
      if (!parsed || parsed.origin !== window.location.origin || parsed.pathname !== '/api/sdr/ws') return socket;

      const receiver = parsed.searchParams.get('receiver') || '';
      const stream = parsed.searchParams.get('stream') || '';
      const ts = parsed.searchParams.get('ts') || '';
      const started = performance.now();
      let firstMessage = false;
      let firstSnd = false;
      trace('ws-create', { receiver, stream, ts, url: parsed.pathname + parsed.search });

      socket.addEventListener('open', () => trace('ws-open', { receiver, stream, ts, ms: Math.round(performance.now() - started) }));
      socket.addEventListener('error', () => trace('ws-error', { receiver, stream, ts, ms: Math.round(performance.now() - started), readyState: socket.readyState }));
      socket.addEventListener('close', (event) => trace('ws-close', {
        receiver, stream, ts,
        ms: Math.round(performance.now() - started),
        code: event.code,
        reason: event.reason || '',
        wasClean: event.wasClean,
        readyState: socket.readyState
      }));
      socket.addEventListener('message', (event) => {
        let tag = '';
        let size = 0;
        try {
          if (event.data instanceof ArrayBuffer) {
            const bytes = new Uint8Array(event.data);
            size = bytes.byteLength;
            if (bytes.length >= 3) tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
          } else if (event.data instanceof Blob) {
            size = event.data.size;
            tag = 'BLOB';
          } else if (typeof event.data === 'string') {
            size = event.data.length;
            tag = event.data.slice(0, 3);
          }
        } catch {}
        if (!firstMessage) {
          firstMessage = true;
          trace('ws-first-message', { receiver, stream, ts, tag, size, ms: Math.round(performance.now() - started) });
        }
        if (!firstSnd && tag === 'SND') {
          firstSnd = true;
          trace('ws-first-snd', { receiver, stream, ts, size, ms: Math.round(performance.now() - started) });
        }
      });
      return socket;
    }

    TracedWebSocket.prototype = PreviousWebSocket.prototype;
    Object.defineProperties(TracedWebSocket, {
      CONNECTING: { value: PreviousWebSocket.CONNECTING },
      OPEN: { value: PreviousWebSocket.OPEN },
      CLOSING: { value: PreviousWebSocket.CLOSING },
      CLOSED: { value: PreviousWebSocket.CLOSED }
    });
    window.WebSocket = TracedWebSocket;
    trace('ws-trace-installed', { wrapped: PreviousWebSocket?.name || 'WebSocket' });
  }

  function installPlayerStateWatcher() {
    const panel = document.getElementById('sdrPlayer');
    if (!panel || panel.dataset.traceStateWatcher === '1') return;
    panel.dataset.traceStateWatcher = '1';
    let lastSignature = '';
    const capture = () => {
      const detail = {
        hidden: Boolean(panel.hidden),
        status: panel.querySelector('[data-sdr-status]')?.textContent?.trim() || '',
        station: panel.querySelector('[data-sdr-station]')?.textContent?.trim() || '',
        frequency: panel.querySelector('[data-sdr-frequency]')?.textContent?.trim() || '',
        receiver: panel.querySelector('[data-sdr-receiver-button-name]')?.textContent?.trim() || '',
        toggle: panel.querySelector('[data-sdr-toggle]')?.textContent?.trim() || '',
        message: panel.querySelector('[data-sdr-message]')?.textContent?.trim() || ''
      };
      const signature = JSON.stringify(detail);
      if (signature === lastSignature) return;
      lastSignature = signature;
      trace('player-state-change', detail);
    };
    new MutationObserver(capture).observe(panel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden', 'class'] });
    capture();
  }

  function installReturnControl() {
    if (document.querySelector('[data-sdr-trace-return]')) return;
    const link = document.createElement('a');
    link.href = '/sdr-runtime-trace.html?v=3';
    link.dataset.sdrTraceReturn = 'true';
    link.textContent = 'View SDR diagnostic report';
    link.style.cssText = 'position:fixed;right:10px;top:10px;z-index:2147483646;padding:9px 11px;border:1px solid #54c7f3;border-radius:9px;background:#0d3650;color:#fff;font:800 12px/1.1 system-ui;text-decoration:none;box-shadow:0 4px 16px rgba(0,0,0,.35)';
    document.body.appendChild(link);
  }

  window.addEventListener('click', (event) => {
    const button = event.target?.closest?.('.card-receiver-options, #lookupReceiverButton, [data-sdr-receiver-button], [data-sdr-choice-index], [data-sdr-toggle], [data-sdr-close], .listen-live-button');
    if (!button) return;
    const choice = button.closest?.('[data-sdr-choice-index]');
    const card = button.closest?.('.signal-card');
    trace('sdr-click-capture', {
      isTrusted: event.isTrusted,
      defaultPreventedAtCapture: event.defaultPrevented,
      button: describeButton(button),
      clickKind: button.classList?.contains('card-receiver-options') ? 'receiver-options'
        : button.classList?.contains('listen-live-button') ? 'listen-live'
        : button.id === 'lookupReceiverButton' ? 'lookup-receiver'
        : choice ? 'receiver-choice'
        : button.hasAttribute?.('data-sdr-toggle') ? 'player-toggle'
        : 'other',
      cardFrequency: frequencyFromCard(card),
      lookupFrequency: document.getElementById('lookupFrequency')?.value || '',
      choiceIndex: choice?.dataset?.sdrChoiceIndex ?? null,
      choiceName: choice?.querySelector?.('.sdr-choice-name')?.textContent?.trim() || '',
      choiceLocation: choice?.querySelector?.('.sdr-choice-location')?.textContent?.trim() || '',
      runtime: runtimeSnapshot(),
      health: healthSnapshot()
    });
    queueMicrotask(() => trace('sdr-click-after-microtask', {
      defaultPrevented: event.defaultPrevented,
      button: describeButton(button),
      runtime: runtimeSnapshot()
    }));
    scheduleSnapshots(`sdr-click-${button.id || button.getAttribute('data-sdr-choice-index') || button.className || button.tagName}`);
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    installWebSocketTrace();
    installPlayerStateWatcher();
    installReturnControl();
    trace('dom-ready', runtimeSnapshot());
  }, { once: true });

  window.addEventListener('load', () => {
    installWebSocketTrace();
    installPlayerStateWatcher();
    trace('window-load', { ...runtimeSnapshot(), loadMs: Math.round(performance.now()) });
  }, { once: true });

  installResourceObserver();

  window.addEventListener('error', (event) => trace('window-error', {
    message: event.message || '',
    filename: event.filename || '',
    lineno: event.lineno || 0,
    colno: event.colno || 0
  }));
  window.addEventListener('unhandledrejection', (event) => trace('unhandledrejection', {
    reason: event.reason?.message || String(event.reason || '')
  }));
  window.addEventListener('pagehide', (event) => trace('pagehide', { persisted: event.persisted }));
  window.addEventListener('pageshow', (event) => trace('pageshow', { persisted: event.persisted }));
})();
