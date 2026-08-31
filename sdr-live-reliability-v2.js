(() => {
  const HEALTH_KEY = 'signalScout:sdrHealth:v1';
  const RECENT_SUCCESS_MS = 45 * 60 * 1000;
  const PreviousFetch = window.fetch.bind(window);
  const MAX_RF_FALLBACKS = 4;

  const rfFallback = {
    attempted: new Set(),
    switches: 0,
    lastHandled: '',
    busy: false
  };

  function loadHealth() {
    try {
      const parsed = JSON.parse(window.localStorage?.getItem(HEALTH_KEY) || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function requestUrl(input) {
    try {
      if (typeof input === 'string') return new URL(input, window.location.href);
      if (input instanceof URL) return new URL(input.toString(), window.location.href);
      if (input?.url) return new URL(input.url, window.location.href);
    } catch {
      return null;
    }
    return null;
  }

  function hamViewActive() {
    return document.getElementById('signalGrid')?.dataset.hamView === 'true';
  }

  function distanceMiles(receiver) {
    const distance = Number(receiver?.distanceMiles);
    return Number.isFinite(distance) ? distance : Infinity;
  }

  function hamDistanceBucket(distance) {
    if (distance <= 400) return 0;
    if (distance <= 900) return 1;
    if (distance <= 1800) return 2;
    if (distance <= 3000) return 3;
    return 4;
  }

  function rankHamReceivers(receivers) {
    const health = loadHealth();
    const timestamp = Date.now();
    const ranked = receivers.map((receiver, index) => {
      const copy = { ...receiver };
      const distance = distanceMiles(copy);
      const entry = health[copy.id] || {};
      const cooling = Number(entry.cooldownUntil || 0) > timestamp;
      const recentSuccess = Number(entry.lastSuccess || 0) > timestamp - RECENT_SUCCESS_MS;
      const failures = Math.max(0, Number(entry.failures || 0));

      // For amateur monitoring, RF geography is the first-order requirement.
      // A local/regional receiver that recently timed out is still a more
      // sensible observation point than a healthy SDR on another continent.
      // Health only breaks ties inside broad geographic zones.
      const bucket = hamDistanceBucket(distance);
      const healthPenalty = cooling ? 450 + failures * 120 : 0;
      const successBonus = recentSuccess ? 90 : 0;
      const effectiveDistance = distance + healthPenalty - successBonus;
      return { copy, index, distance, bucket, effectiveDistance, cooling, recentSuccess };
    });

    ranked.sort((a, b) =>
      a.bucket - b.bucket
      || a.effectiveDistance - b.effectiveDistance
      || a.index - b.index
    );

    return ranked.map((item, index) => {
      const receiver = item.copy;
      receiver.recommended = index === 0;
      receiver.connectionHealth = item.cooling
        ? 'cooldown'
        : (item.recentSuccess ? 'recent-success' : 'unknown');

      if (index === 0) {
        const distanceText = Number.isFinite(item.distance)
          ? `${Math.round(item.distance).toLocaleString()} mi from you`
          : 'nearest useful public receiver';
        receiver.role = 'NEAR YOU';
        receiver.reason = `Best nearby observation point for amateur-band activity · ${distanceText}. Ham activity is local/regional and changes minute to minute.`;
      } else if (Number.isFinite(item.distance) && item.distance <= 1800) {
        receiver.role = receiver.role === 'STATION CHECK' ? 'ALTERNATE' : (receiver.role || 'ALTERNATE');
        if (!receiver.reason || /transmitter|station check/i.test(receiver.reason)) {
          receiver.reason = 'Nearby alternate for comparing amateur-band activity and propagation.';
        }
      }
      return receiver;
    });
  }

  // Preserve the existing hard cooldown behavior for normal broadcast listening.
  // Amateur quick-tunes are different: a distant SDR is not a useful proxy just
  // because every nearby receiver has a temporary health penalty. Ham requests
  // keep the full server list and use geography-first ranking instead.
  window.fetch = async (...args) => {
    const response = await PreviousFetch(...args);
    const url = requestUrl(args[0]);
    if (!url || url.origin !== window.location.origin || url.pathname !== '/api/sdr/receivers') return response;

    try {
      const payload = await response.clone().json();
      if (!Array.isArray(payload?.receivers) || !payload.receivers.length) return response;

      let receivers;
      if (hamViewActive()) {
        receivers = rankHamReceivers(payload.receivers);
      } else {
        const health = loadHealth();
        const now = Date.now();
        const available = payload.receivers.filter((receiver) => {
          const entry = health[receiver?.id] || {};
          return Number(entry.cooldownUntil || 0) <= now;
        });
        receivers = available.length ? available : payload.receivers;
        if (receivers === payload.receivers) return response;
        receivers = receivers.map((receiver, index) => ({ ...receiver, recommended: index === 0 }));
      }

      const headers = new Headers(response.headers);
      headers.set('content-type', 'application/json; charset=utf-8');
      headers.set('cache-control', 'private, max-age=0, no-store');
      return new Response(JSON.stringify({ ...payload, receivers }), {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    } catch {
      return response;
    }
  };

  function drawStandby(canvas, title = 'RF RECEIVER STANDBY', detail = 'Waiting for a reachable SDR…') {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(300, Math.round((rect.width || 300) * dpr));
    const height = Math.max(120, Math.round((rect.height || 150) * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#020608';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(138,200,242,.09)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += width / 8) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y <= height; y += height / 5) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(183,218,239,.82)';
    ctx.font = `700 ${10 * dpr}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(title, width / 2, height / 2 - 5 * dpr);
    ctx.fillStyle = 'rgba(126,157,177,.82)';
    ctx.font = `${8 * dpr}px monospace`;
    ctx.fillText(detail, width / 2, height / 2 + 13 * dpr);
  }

  function installRfPlaceholder() {
    const wrap = document.querySelector('.sdr-spectrum-wrap');
    const original = wrap?.querySelector('[data-sdr-canvas]');
    if (!wrap || !original) return false;

    let canvas = wrap.querySelector('[data-sdr-rf-v2-canvas]');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'sdr-rf-v2-spectrum';
      canvas.dataset.sdrRfV2Canvas = 'true';
      canvas.setAttribute('aria-label', 'Live receiver RF spectrum and waterfall');
      original.insertAdjacentElement('afterend', canvas);
    }

    if (!document.getElementById('signal-scout-rf-standby-style')) {
      const style = document.createElement('style');
      style.id = 'signal-scout-rf-standby-style';
      style.textContent = `
        .sdr-spectrum-wrap > [data-sdr-canvas] { display:none !important; }
        .sdr-rf-v2-spectrum { display:block; width:100%; height:150px; background:#020608; }
        .sdr-spectrum-label { z-index:3 !important; text-shadow:0 1px 3px #020608; }
      `;
      document.head.appendChild(style);
    }

    const label = wrap.querySelector('.sdr-spectrum-label');
    if (label && !/live rf spectrum/i.test(label.textContent || '')) {
      label.textContent = 'Live RF spectrum / waterfall';
    }

    if (!canvas.dataset.rfStandbyPainted) {
      canvas.dataset.rfStandbyPainted = 'true';
      drawStandby(canvas);
    }
    return true;
  }

  if (!installRfPlaceholder()) {
    const observer = new MutationObserver(() => {
      if (installRfPlaceholder()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function resetRfFallback() {
    rfFallback.attempted.clear();
    rfFallback.switches = 0;
    rfFallback.lastHandled = '';
    rfFallback.busy = false;
  }

  function currentReceiverName() {
    return document.querySelector('[data-sdr-receiver-button-name]')?.textContent?.trim() || '';
  }

  function rfFailureText(text) {
    return /RF WATERFALL TIMEOUT|no W\/F rows|sent no W\/F rows/i.test(String(text || ''));
  }

  function tryNextHamRfReceiver(messageText) {
    if (!hamViewActive() || rfFallback.busy || !rfFailureText(messageText)) return;
    const current = currentReceiverName();
    const signature = `${current}|${String(messageText).trim()}`;
    if (!current || signature === rfFallback.lastHandled) return;
    rfFallback.lastHandled = signature;
    rfFallback.attempted.add(current);

    if (rfFallback.switches >= MAX_RF_FALLBACKS) {
      const message = document.querySelector('[data-sdr-message]');
      if (message) {
        message.textContent = 'Receiver audio is live, but the available nearby SDRs did not provide an RF waterfall. Use Receiver to try another manually.';
        message.classList.add('is-error');
      }
      return;
    }

    rfFallback.busy = true;
    const receiverButton = document.querySelector('[data-sdr-receiver-button]');
    receiverButton?.click();

    window.setTimeout(() => {
      const choices = [...document.querySelectorAll('[data-sdr-choice-index]')];
      const next = choices.find((choice) => {
        if (choice.classList.contains('is-selected')) return false;
        const name = choice.querySelector('.sdr-choice-name')?.textContent?.trim() || '';
        return name && !rfFallback.attempted.has(name);
      });

      if (!next) {
        const close = document.querySelector('[data-sdr-chooser-close]');
        close?.click();
        const message = document.querySelector('[data-sdr-message]');
        if (message) {
          message.textContent = 'Receiver audio is live, but no untried nearby SDR remains for the RF waterfall.';
          message.classList.add('is-error');
        }
        rfFallback.busy = false;
        return;
      }

      const name = next.querySelector('.sdr-choice-name')?.textContent?.trim() || '';
      if (name) rfFallback.attempted.add(name);
      rfFallback.switches += 1;
      next.click();
      rfFallback.busy = false;
    }, 120);
  }

  function installRfFailureWatcher() {
    const message = document.querySelector('[data-sdr-message]');
    if (!message || message.dataset.hamRfWatcher === '1') return false;
    message.dataset.hamRfWatcher = '1';
    const observer = new MutationObserver(() => tryNextHamRfReceiver(message.textContent || ''));
    observer.observe(message, { childList: true, characterData: true, subtree: true });
    tryNextHamRfReceiver(message.textContent || '');
    return true;
  }

  if (!installRfFailureWatcher()) {
    const observer = new MutationObserver(() => {
      if (installRfFailureWatcher()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('.listen-live-button')) resetRfFallback();
  }, true);
})();
