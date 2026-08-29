(() => {
  const TRACE_VERSION = 'sdr-trace-v1';
  const TRACE_KEY = 'freqbeacon:sdr-runtime-trace:v1';
  const MAX_ENTRIES = 180;
  const nativeFetch = window.fetch.bind(window);
  const nativePushState = history.pushState.bind(history);
  const nativeReplaceState = history.replaceState.bind(history);

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

  function chooserSnapshot(label) {
    const chooser = document.querySelector('.sdr-chooser');
    const choices = chooser ? [...chooser.querySelectorAll('.sdr-choice')] : [];
    const input = document.getElementById('lookupFrequency');
    trace(label, {
      chooserExists: Boolean(chooser),
      chooserHidden: chooser ? Boolean(chooser.hidden) : null,
      choiceCount: choices.length,
      choiceNames: choices.slice(0, 8).map((choice) => choice.querySelector('.sdr-choice-name')?.textContent?.trim() || ''),
      subtitle: chooser?.querySelector('[data-sdr-chooser-subtitle]')?.textContent?.trim() || '',
      lookupFrequency: input?.value || '',
      activeElement: document.activeElement?.id || document.activeElement?.className || document.activeElement?.tagName || ''
    });
  }

  function describeButton(button) {
    if (!button) return {};
    return {
      tag: button.tagName,
      id: button.id || '',
      className: button.className || '',
      type: button.getAttribute('type'),
      href: button.getAttribute('href'),
      text: button.textContent?.trim().replace(/\s+/g, ' ').slice(0, 120) || ''
    };
  }

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
      signalAborted: Boolean(init?.signal?.aborted)
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
          firstNames: (payload?.receivers || []).slice(0, 8).map((receiver) => receiver?.name || receiver?.location || receiver?.id || '')
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
    const button = event.target?.closest?.('.card-receiver-options, #lookupReceiverButton, [data-sdr-receiver-button]');
    if (!button) return;
    trace('receiver-click-capture', {
      isTrusted: event.isTrusted,
      defaultPreventedAtCapture: event.defaultPrevented,
      button: describeButton(button)
    });
    queueMicrotask(() => trace('receiver-click-after-microtask', {
      defaultPrevented: event.defaultPrevented,
      button: describeButton(button)
    }));
    [0, 100, 400, 1000, 2500, 5000].forEach((delay) => {
      setTimeout(() => chooserSnapshot(`receiver-click-snapshot-${delay}ms`), delay);
    });
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
