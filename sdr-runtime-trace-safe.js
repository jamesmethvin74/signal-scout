(() => {
  const TRACE_KEY = 'freqbeacon:sdr-runtime-trace:v1';
  const HEALTH_KEY = 'signalScout:sdrHealth:v1';
  const MAX_ENTRIES = 360;
  const nativeFetch = window.fetch.bind(window);
  const nativeJson = Response.prototype.json;

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
      health: healthSnapshot()
    });
  }

  function playerSnapshot(label) {
    const panel = document.getElementById('sdrPlayer');
    trace(label, {
      playerExists: Boolean(panel),
      playerHidden: panel ? Boolean(panel.hidden) : null,
      status: panel?.querySelector('[data-sdr-status]')?.textContent?.trim() || '',
      receiverReadout: panel?.querySelector('[data-sdr-receiver]')?.textContent?.trim() || '',
      receiverButton: panel?.querySelector('[data-sdr-receiver-button-name]')?.textContent?.trim() || '',
      message: panel?.querySelector('[data-sdr-message]')?.textContent?.trim() || '',
      health: healthSnapshot()
    });
  }

  function scheduleSnapshots(prefix) {
    [0, 100, 500, 1500, 3000, 7000].forEach((delay) => {
      setTimeout(() => {
        chooserSnapshot(`${prefix}-chooser-${delay}ms`);
        playerSnapshot(`${prefix}-player-${delay}ms`);
      }, delay);
    });
  }

  window.__freqbeaconSdrTrace = trace;
  window.__freqbeaconSdrTraceKey = TRACE_KEY;
  trace('trace-loaded', { version: 'sdr-trace-v2', safeBodyObserver: true });

  window.fetch = async function tracedFetch(input, init) {
    let url = '';
    try { url = typeof input === 'string' ? input : input?.url || String(input); } catch {}
    if (!url.includes('/api/sdr/receivers')) return nativeFetch(input, init);

    const started = performance.now();
    trace('receiver-fetch-start', {
      url,
      signalAborted: Boolean(init?.signal?.aborted),
      health: healthSnapshot()
    });
    try {
      const response = await nativeFetch(input, init);
      trace('receiver-fetch-response', {
        status: response.status,
        ok: response.ok,
        ms: Math.round(performance.now() - started),
        directoryHeader: response.headers.get('x-freqbeacon-sdr-directory') || '',
        bodyUsed: response.bodyUsed
      });
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

  Response.prototype.json = function tracedResponseJson(...args) {
    const isReceiverDirectory = String(this.url || '').includes('/api/sdr/receivers');
    if (!isReceiverDirectory) return nativeJson.apply(this, args);
    const started = performance.now();
    trace('receiver-json-start', {
      url: this.url || '',
      status: this.status,
      bodyUsed: this.bodyUsed
    });
    return nativeJson.apply(this, args).then((payload) => {
      trace('receiver-fetch-body', {
        jsonMs: Math.round(performance.now() - started),
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
      return payload;
    }, (error) => {
      trace('receiver-fetch-body-error', {
        jsonMs: Math.round(performance.now() - started),
        name: error?.name || '',
        message: error?.message || String(error)
      });
      throw error;
    });
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
    scheduleSnapshots(`sdr-click-${button.id || button.getAttribute('data-sdr-choice-index') || button.className || button.tagName}`);
  }, true);

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
