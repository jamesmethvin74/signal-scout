(() => {
  const TRACE_VERSION = 'sdr-trace-v2';
  const TRACE_KEY = 'freqbeacon:sdr-runtime-trace:v1';
  const HEALTH_KEY = 'signalScout:sdrHealth:v1';
  const MAX_ENTRIES = 360;
  const nativeFetch = window.fetch.bind(window);
  const NativeWebSocket = window.WebSocket;
  const nativePushState = history.pushState.bind(history);
  const nativeReplaceState = history.replaceState.bind(history);
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
    try { console.info('[FREQBEACON SDR TRACE]', event, detail); } catch {}
    return entry;
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

  function chooserSnapshot(label) {
    const chooser = document.querySelector('.sdr-chooser');
    const choices = chooser ? [...chooser.querySelectorAll('.sdr-choice')] : [];
    const input = document.getElementById('lookupFrequency');
    trace(label, {
      chooserExists: Boolean(chooser),
      chooserHidden: chooser ? Boolean(chooser.hidden) : null,
      choiceCount: choices.length,
      selectedIndex: choices.findIndex((choice) => choice.classList.contains('is-selected')),
      choiceNames: choices.slice(0, 10).map((choice) => choice.querySelector('.sdr-choice-name')?.textContent?.trim() || ''),
      subtitle: chooser?.querySelector('[data-sdr-chooser-subtitle]')?.textContent?.trim() || '',
      lookupFrequency: input?.value || '',
      activeElement: document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName || ''
    });
  }

  function playerSnapshot(label) {
    const panel = document.getElementById('sdrPlayer');
    const chooser = document.querySelector('.sdr-chooser');
    trace(label, {
      playerExists: Boolean(panel),
      playerHidden: panel ? Boolean(panel.hidden) : null,
      status: panel?.querySelector('[data-sdr-status]')?.textContent?.trim() || '',
      station: panel?.querySelector('[data-sdr-station]')?.textContent?.trim() || '',
      frequency: panel?.querySelector('[data-sdr-frequency]')?.textContent?.trim() || '',
      receiverReadout: panel?.querySelector('[data-sdr-receiver]')?.textContent?.trim() || '',
      receiverButton: panel?.querySelector('[data-sdr-receiver-button-name]')?.textContent?.trim() || '',
      receiverMeta: panel?.querySelector('[data-sdr-receiver-button-meta]')?.textContent?.trim() || '',
      playButton: panel?.querySelector('[data-sdr-toggle]')?.textContent?.trim() || '',
      message: panel?.querySelector('[data-sdr-message]')?.textContent?.trim() || '',
      chooserHidden: chooser ? Boolean(chooser.hidden) : null,
      chooserChoices: chooser?.querySelectorAll('.sdr-choice').length || 0,
      health: healthSnapshot()
    });
  }

  function scheduleStateSnapshots(prefix) {
    [0, 100, 500, 1500, 3000, 6000, 10000].forEach((delay) => {
      setTimeout(() => {
        chooserSnapshot(`${prefix}-chooser-${delay}ms`);
        playerSnapshot(`${prefix}-player-${delay}ms`);
      }, delay);
    });
  }

  function wsInfo(rawUrl) {
    try {
      const url = new URL(String(rawUrl), window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== '/api/sdr/ws') return null;
      return {
        receiver: url.searchParams.get('receiver') || '',
        stream: url.searchParams.get('stream') || '',
        ts: url.searchParams.get('ts') || ''
      };
    } catch {
      return null;
    }
  }

  function messageTag(data) {
    try {
      if (data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(data);
        if (bytes.length < 3) return { tag: '', bytes: bytes.length, text: '' };
        const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
        let text = '';
        if (tag === 'MSG') text = decoder.decode(bytes.subarray(4)).slice(0, 300);
        return { tag, bytes: bytes.length, text };
      }
      if (typeof data === 'string') return { tag: data.slice(0, 3), bytes: data.length, text: data.slice(0, 300) };
      if (data instanceof Blob) return { tag: 'BLOB', bytes: data.size, text: '' };
    } catch {}
    return { tag: '', bytes: 0, text: '' };
  }

  function TracedWebSocket(url, protocols) {
    const info = wsInfo(url);
    if (info) trace('ws-create', { ...info, health: healthSnapshot() });

    let socket;
    try {
      socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    } catch (error) {
      if (info) trace('ws-constructor-error', { ...info, name: error?.name || '', message: error?.message || String(error) });
      throw error;
    }
    if (!info) return socket;

    let firstMessageSeen = false;
    let firstSndSeen = false;
    socket.addEventListener('open', () => trace('ws-open', info));
    socket.addEventListener('error', () => trace('ws-error', { ...info, readyState: socket.readyState }));
    socket.addEventListener('close', (event) => trace('ws-close', {
      ...info,
      code: event.code,
      reason: event.reason || '',
      wasClean: event.wasClean,
      firstSndSeen
    }));
    socket.addEventListener('message', (event) => {
      const message = messageTag(event.data);
      if (!firstMessageSeen) {
        firstMessageSeen = true;
        trace('ws-first-message', { ...info, ...message });
      }
      if (message.tag === 'SND' && !firstSndSeen) {
        firstSndSeen = true;
        trace('ws-first-snd', { ...info, bytes: message.bytes });
      }
      if (message.tag === 'MSG' && /too_busy=1|down=1|sample_rate=|audio_rate=/i.test(message.text || '')) {
        trace('ws-msg-state', { ...info, text: message.text });
      }
    });
    return socket;
  }

  TracedWebSocket.prototype = NativeWebSocket.prototype;
  Object.defineProperties(TracedWebSocket, {
    CONNECTING: { value: NativeWebSocket.CONNECTING },
    OPEN: { value: NativeWebSocket.OPEN },
    CLOSING: { value: NativeWebSocket.CLOSING },
    CLOSED: { value: NativeWebSocket.CLOSED }
  });
  window.WebSocket = TracedWebSocket;

  window.__freqbeaconSdrTrace = trace;
  window.__freqbeaconSdrTraceKey = TRACE_KEY;
  trace('trace-loaded', { version: TRACE_VERSION });

  window.fetch = async function tracedFetch(input, init) {
    let url = '';
    try { url = typeof input === 'string' ? input : input?.url || String(input); } catch {}
    const isReceiverDirectory = url.includes('/api/sdr/receivers');
    if (!isReceiverDirectory) return nativeFetch(input, init);

    const started = performance.now();
    trace('receiver-fetch-start', {
      url,
      cache: init?.cache || '',
      signalAborted: Boolean(init?.signal?.aborted),
      health: healthSnapshot()
    });
    try {
      const response = await nativeFetch(input, init);
      trace('receiver-fetch-response', {
        status: response.status,
        ok: response.ok,
        ms: Math.round(performance.now() - started),
        directoryHeader: response.headers.get('x-freqbeacon-sdr-directory') || ''
      });
      response.clone().json().then((payload) => {
        trace('receiver-fetch-body', {
          receiverCount: Array.isArray(payload?.receivers) ? payload.receivers.length : 0,
          source: payload?.source || '',
          warning: payload?.warning || '',
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
      }).catch((error) => trace('receiver-fetch-body-error', { name: error?.name || '', message: error?.message || String(error) }));
      return response;
    } catch (error) {
      trace('receiver-fetch-error', {
        ms: Math.round(performance.now() - started),
        name: error?.name || '',
        message: error?.message || String(error),
        signalAborted: Boolean(init?.signal?.aborted)
      });
      throw error;
    }
  };

  history.pushState = function tracedPushState(state, title, url) {
    trace('history-pushState', { url: url == null ? '' : String(url) });
    return nativePushState(state, title, url);
  };
  history.replaceState = function tracedReplaceState(state, title, url) {
    trace('history-replaceState', { url: url == null ? '' : String(url) });
    return nativeReplaceState(state, title, url);
  };

  window.addEventListener('click', (event) => {
    const button = event.target?.closest?.('.card-receiver-options, #lookupReceiverButton, [data-sdr-receiver-button], [data-sdr-choice-index], [data-sdr-toggle], [data-sdr-close], .listen-live-button');
    if (!button) return;
    const choice = button.closest?.('[data-sdr-choice-index]');
    trace('sdr-click-capture', {
      isTrusted: event.isTrusted,
      defaultPreventedAtCapture: event.defaultPrevented,
      button: describeButton(button),
      choiceIndex: choice?.dataset?.sdrChoiceIndex ?? null,
      choiceName: choice?.querySelector?.('.sdr-choice-name')?.textContent?.trim() || '',
      choiceLocation: choice?.querySelector?.('.sdr-choice-location')?.textContent?.trim() || '',
      health: healthSnapshot()
    });
    queueMicrotask(() => trace('sdr-click-after-microtask', {
      defaultPrevented: event.defaultPrevented,
      button: describeButton(button)
    }));
    scheduleStateSnapshots(`sdr-click-${button.id || button.getAttribute('data-sdr-choice-index') || button.className || button.tagName}`);
  }, true);

  document.addEventListener('visibilitychange', () => trace('visibilitychange', { state: document.visibilityState }));
  window.addEventListener('beforeunload', () => trace('beforeunload'));
  window.addEventListener('pagehide', (event) => trace('pagehide', { persisted: event.persisted }));
  window.addEventListener('pageshow', (event) => trace('pageshow', { persisted: event.persisted }));
  window.addEventListener('hashchange', (event) => trace('hashchange', { oldURL: event.oldURL, newURL: event.newURL }));
  window.addEventListener('popstate', () => trace('popstate'));
  window.addEventListener('error', (event) => trace('window-error', {
    message: event.message || '',
    filename: event.filename || '',
    lineno: event.lineno || 0,
    colno: event.colno || 0
  }));
  window.addEventListener('unhandledrejection', (event) => trace('unhandledrejection', {
    reason: event.reason?.message || String(event.reason || '')
  }));
})();
