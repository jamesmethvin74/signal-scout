(() => {
  const HEALTH_KEY = 'signalScout:sdrHealth:v1';
  const PreviousFetch = window.fetch.bind(window);

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

  // Hard-skip receivers that the device has already learned are failing.
  // The earlier health layer still ranks and annotates receivers; this layer
  // removes active-cooldown receivers from automatic candidate lists so the
  // player cannot keep cycling through sites that just timed out or refused us.
  window.fetch = async (...args) => {
    const response = await PreviousFetch(...args);
    const url = requestUrl(args[0]);
    if (!url || url.origin !== window.location.origin || url.pathname !== '/api/sdr/receivers') return response;

    try {
      const payload = await response.clone().json();
      if (!Array.isArray(payload?.receivers) || !payload.receivers.length) return response;

      const health = loadHealth();
      const now = Date.now();
      const available = payload.receivers.filter((receiver) => {
        const entry = health[receiver?.id] || {};
        return Number(entry.cooldownUntil || 0) <= now;
      });

      // Never turn a temporarily bad health cache into "no SDRs". If every
      // candidate is cooling, keep the least-bad ranked list so manual recovery
      // is still possible. Otherwise automatic play sees only usable candidates.
      const receivers = available.length ? available : payload.receivers;
      if (receivers === payload.receivers) return response;

      receivers.forEach((receiver, index) => {
        receiver.recommended = index === 0;
      });

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

    // Only draw standby before RF v2 has painted a real stage/frame.
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
})();
