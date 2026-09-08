(() => {
  'use strict';

  if (window.__freqbeaconSdrLivePathTrace) return;
  const baseTrace = window.__freqbeaconSdrEarlyTrace;
  if (!baseTrace) return;

  const START = performance.now();
  const MAX_EVENTS = 700;
  const events = [];
  let droppedEvents = 0;
  let lastUiSignature = '';
  let playerObserver = null;
  let playerSearchObserver = null;
  let outerFetchInstalled = false;

  function now() {
    return Math.round(performance.now() * 10) / 10;
  }

  function safeText(value, max = 220) {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function record(type, data = {}) {
    if (events.length >= MAX_EVENTS) {
      events.shift();
      droppedEvents += 1;
    }
    events.push({ at: now(), type, ...data });
  }

  function requestUrl(input) {
    try {
      if (typeof input === 'string') return new URL(input, window.location.href);
      if (input instanceof URL) return new URL(input.toString(), window.location.href);
      if (input?.url) return new URL(input.url, window.location.href);
    } catch {}
    return null;
  }

  function receiverSummary(receiver, index) {
    return {
      index,
      id: safeText(receiver?.id, 90),
      name: safeText(receiver?.name, 120),
      location: safeText(receiver?.location, 120),
      distanceMiles: Number.isFinite(Number(receiver?.distanceMiles)) ? Math.round(Number(receiver.distanceMiles)) : null,
      recommended: Boolean(receiver?.recommended),
      role: safeText(receiver?.role, 40),
      connectionHealth: safeText(receiver?.connectionHealth, 40)
    };
  }

  function healthSnapshot() {
    try {
      const parsed = JSON.parse(window.localStorage?.getItem('signalScout:sdrHealth:v1') || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).slice(0, 30).map(([id, value]) => [id, {
        failures: Number(value?.failures || 0),
        cooldownUntil: Number(value?.cooldownUntil || 0),
        lastSuccess: Number(value?.lastSuccess || 0),
        lastFailure: Number(value?.lastFailure || 0)
      }]));
    } catch {
      return {};
    }
  }

  function captureResponse(stage, url, response, startedAt) {
    if (!url || !response?.clone) return;
    const path = url.pathname;
    if (path !== '/api/sdr/receivers' && path !== '/api/sdr/probe') return;

    response.clone().json().then((payload) => {
      const common = {
        stage,
        path,
        httpStatus: Number(response.status || 0),
        elapsedMs: Math.max(0, Math.round((now() - startedAt) * 10) / 10)
      };

      if (path === '/api/sdr/receivers') {
        const receivers = Array.isArray(payload?.receivers) ? payload.receivers : [];
        record('receiver-directory-response', {
          ...common,
          frequency: url.searchParams.get('frequency') || '',
          source: safeText(payload?.source, 80),
          warning: safeText(payload?.warning, 180),
          count: receivers.length,
          top: receivers.slice(0, 8).map(receiverSummary)
        });
        return;
      }

      record('receiver-probe-response', {
        ...common,
        receiver: url.searchParams.get('receiver') || '',
        stream: url.searchParams.get('stream') || '',
        resolved: Boolean(payload?.resolved),
        webSocketAccepted: Boolean(payload?.webSocketAccepted),
        upstreamStatus: Number(payload?.upstreamStatus || payload?.status || 0) || null,
        error: safeText(payload?.error || payload?.message, 220)
      });
    }).catch((error) => {
      record('trace-json-error', {
        stage,
        path,
        error: safeText(error?.message || error, 180)
      });
    });
  }

  const NativeFetch = window.fetch.bind(window);
  async function EarlyTraceFetch(...args) {
    const url = requestUrl(args[0]);
    const relevant = url && (url.pathname === '/api/sdr/receivers' || url.pathname === '/api/sdr/probe');
    const startedAt = now();
    if (relevant) {
      record('fetch-start', {
        stage: 'underlying',
        path: url.pathname,
        receiver: url.searchParams.get('receiver') || '',
        frequency: url.searchParams.get('frequency') || ''
      });
    }
    try {
      const response = await NativeFetch(...args);
      if (relevant) captureResponse('underlying', url, response, startedAt);
      return response;
    } catch (error) {
      if (relevant) {
        record('fetch-error', {
          stage: 'underlying',
          path: url.pathname,
          receiver: url.searchParams.get('receiver') || '',
          error: safeText(error?.name || error?.message || error, 180)
        });
      }
      throw error;
    }
  }

  window.fetch = EarlyTraceFetch;
  record('live-path-trace-installed', { phase: 'early' });

  function installOuterFetch(attempt = 0) {
    if (outerFetchInstalled) return;
    if (window.fetch === EarlyTraceFetch) {
      if (attempt < 80) window.setTimeout(() => installOuterFetch(attempt + 1), 50);
      else record('outer-fetch-not-installed', { reason: 'no later fetch wrapper detected' });
      return;
    }

    const CurrentFetch = window.fetch.bind(window);
    async function FinalTraceFetch(...args) {
      const url = requestUrl(args[0]);
      const relevant = url && url.pathname === '/api/sdr/receivers';
      const startedAt = now();
      if (relevant) {
        record('fetch-start', {
          stage: 'final',
          path: url.pathname,
          frequency: url.searchParams.get('frequency') || ''
        });
      }
      try {
        const response = await CurrentFetch(...args);
        if (relevant) captureResponse('final', url, response, startedAt);
        return response;
      } catch (error) {
        if (relevant) {
          record('fetch-error', {
            stage: 'final',
            path: url.pathname,
            error: safeText(error?.name || error?.message || error, 180)
          });
        }
        throw error;
      }
    }

    window.fetch = FinalTraceFetch;
    outerFetchInstalled = true;
    record('outer-fetch-installed', { attempt });
  }

  function playerSnapshot(reason) {
    const panel = document.querySelector('.sdr-player');
    if (!panel) return;
    const snapshot = {
      reason,
      status: safeText(panel.querySelector('[data-sdr-status]')?.textContent, 80),
      message: safeText(panel.querySelector('[data-sdr-message]')?.textContent, 260),
      receiverButton: safeText(panel.querySelector('[data-sdr-receiver-button-name]')?.textContent, 140),
      receiverReadout: safeText(panel.querySelector('[data-sdr-receiver]')?.textContent, 180),
      rssi: safeText(panel.querySelector('[data-sdr-rssi]')?.textContent, 80),
      toggle: safeText(panel.querySelector('[data-sdr-toggle]')?.textContent, 40),
      liveClass: panel.classList.contains('is-live')
    };
    const signature = JSON.stringify(snapshot);
    if (signature === lastUiSignature) return;
    lastUiSignature = signature;
    record('player-ui', snapshot);
  }

  function attachPlayerObserver() {
    const panel = document.querySelector('.sdr-player');
    if (!panel || playerObserver) return Boolean(panel);
    playerObserver = new MutationObserver(() => playerSnapshot('mutation'));
    playerObserver.observe(panel, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'hidden']
    });
    playerSnapshot('attached');
    record('player-observer-attached');
    return true;
  }

  function installPlayerSearchObserver() {
    if (attachPlayerObserver()) return;
    if (!document.body || playerSearchObserver) return;
    playerSearchObserver = new MutationObserver(() => {
      if (attachPlayerObserver()) {
        playerSearchObserver.disconnect();
        playerSearchObserver = null;
      }
    });
    playerSearchObserver.observe(document.body, { childList: true, subtree: true });
  }

  function listenContext(button) {
    const container = button?.closest?.('.signal-card, .lookup-result') || null;
    const station = safeText(container?.querySelector('.station-name, h3')?.textContent, 160);
    const frequency = safeText(container?.querySelector('.frequency, .lookup-result-frequency')?.textContent, 100);
    return { station, frequency };
  }

  document.addEventListener('click', (event) => {
    const listen = event.target.closest?.('.listen-live-button');
    if (listen) {
      record('listen-click', {
        ...listenContext(listen),
        health: healthSnapshot()
      });
      window.setTimeout(() => playerSnapshot('after-listen-click'), 0);
      return;
    }

    const choice = event.target.closest?.('[data-sdr-choice-index]');
    if (choice) {
      record('receiver-choice-click', {
        index: Number(choice.dataset.sdrChoiceIndex || -1),
        name: safeText(choice.querySelector('.sdr-choice-name')?.textContent, 140),
        selectedBeforeClick: choice.classList.contains('is-selected')
      });
    }
  }, true);

  function report() {
    return {
      version: 'live-sdr-path-v1',
      elapsedSec: Math.round((performance.now() - START) / 10) / 100,
      droppedEvents,
      events: events.slice(),
      baseTrace: baseTrace.rawReport()
    };
  }

  async function copyReport(button) {
    const text = JSON.stringify(report(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      if (button) {
        const previous = button.textContent;
        button.textContent = 'LIVE TRACE COPIED';
        window.setTimeout(() => { button.textContent = previous; }, 1500);
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

  function installCopyControl() {
    const controls = document.querySelector('[data-sdr-early-trace-controls]');
    if (!controls || controls.querySelector('[data-sdr-live-path-copy]')) return false;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.sdrLivePathCopy = 'true';
    button.textContent = 'COPY LIVE TRACE';
    const reference = controls.querySelector('button');
    button.style.cssText = reference?.style?.cssText || 'border:1px solid #28d7e5;border-radius:7px;padding:8px 10px;background:#07131d;color:#d9f7ff;font:800 10px monospace;';
    button.addEventListener('click', () => copyReport(button));
    controls.appendChild(button);
    return true;
  }

  function bootLate() {
    installOuterFetch();
    installPlayerSearchObserver();
    if (!installCopyControl()) {
      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        if (installCopyControl() || attempts > 60) window.clearInterval(timer);
      }, 100);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.setTimeout(bootLate, 0), { once: true });
  } else {
    window.setTimeout(bootLate, 0);
  }

  window.__freqbeaconSdrLivePathTrace = {
    version: 'live-sdr-path-v1',
    events,
    record,
    report,
    copy: () => copyReport(null)
  };
})();
