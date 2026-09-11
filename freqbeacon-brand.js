(() => {
  const OLD_NAME = 'Signal Scout';
  const NEW_NAME = 'FreqBeacon';
  const DISPLAY_NAME = 'FREQBEACON';
  const TAGLINE = 'Explore the airwaves.';
  const STARTUP_SRC = 'freqbeacon-startup-v3.avif';
  const SPLASH_HOLD_MS = 1250;
  const SPLASH_FADE_MS = 300;
  const SPLASH_MAX_WAIT_MS = 4000;

  // Diagnostic-only hook. The normal app does not load or execute the SDR
  // tracer. When explicitly requested, insert it synchronously at this parser
  // position so it captures the native WebSocket before RF/health/player wrap it.
  if (new URLSearchParams(window.location.search).get('sdrTrace') === '1') {
    document.write('<script src="sdr-early-trace.js?v=2"><\/script>');
  }

  function replaceString(value) {
    return typeof value === 'string' && value.includes(OLD_NAME)
      ? value.replaceAll(OLD_NAME, NEW_NAME)
      : value;
  }

  function disablePwaServiceWorker() {
    // Emergency stability mode: FREQBEACON must not install or re-install a
    // service worker while Android startup is being stabilized. Existing
    // registrations/caches are removed best-effort; the normal web app remains
    // fully usable and live SDR/data requests continue directly to the network.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then((registrations) => Promise.allSettled(registrations.map((registration) => registration.unregister())))
        .catch(() => {});
    }
    if ('caches' in window) {
      caches.keys()
        .then((names) => Promise.allSettled(
          names
            .filter((name) => /freqbeacon|signal-scout/i.test(name))
            .map((name) => caches.delete(name))
        ))
        .catch(() => {});
    }
  }

  function installLocationReliability() {
    const geo = navigator.geolocation;
    if (!geo) return;

    const marker = '__freqbeaconReliableGeolocationV1';
    const proto = Object.getPrototypeOf(geo);
    const target = proto && typeof proto.getCurrentPosition === 'function' ? proto : geo;
    const original = target.getCurrentPosition;

    if (typeof original === 'function' && !original[marker]) {
      const wrapped = function getCurrentPositionReliable(success, error, options = {}) {
        const requested = options && typeof options === 'object' ? options : {};
        const requestedTimeout = Number(requested.timeout);
        const requestedMaxAge = Number(requested.maximumAge);
        let fallbackStarted = false;

        const highAccuracyOptions = {
          ...requested,
          enableHighAccuracy: true,
          timeout: Number.isFinite(requestedTimeout) && requestedTimeout > 0
            ? Math.min(Math.max(requestedTimeout, 8000), 15000)
            : 12000,
          maximumAge: Number.isFinite(requestedMaxAge) && requestedMaxAge >= 0
            ? Math.min(requestedMaxAge, 120000)
            : 60000
        };

        const highAccuracyError = (geoError) => {
          if (geoError?.code === 1 || fallbackStarted) {
            error?.(geoError);
            return;
          }

          fallbackStarted = true;
          const fallbackOptions = {
            ...requested,
            enableHighAccuracy: false,
            timeout: 7000,
            maximumAge: Math.max(
              Number.isFinite(requestedMaxAge) && requestedMaxAge >= 0 ? requestedMaxAge : 0,
              15 * 60 * 1000
            )
          };
          original.call(this, success, error, fallbackOptions);
        };

        return original.call(this, success, highAccuracyError, highAccuracyOptions);
      };

      try {
        Object.defineProperty(wrapped, marker, { value: true });
        Object.defineProperty(target, 'getCurrentPosition', {
          configurable: true,
          writable: true,
          value: wrapped
        });
      } catch {
        try {
          target.getCurrentPosition = wrapped;
        } catch {
          // Leave the browser implementation untouched if it cannot be wrapped.
        }
      }
    }

    const originalFetch = window.fetch;
    if (typeof originalFetch !== 'function' || originalFetch.__freqbeaconLocationLookupTimeoutV1) return;

    const wrappedFetch = function freqbeaconFetch(input, init = undefined) {
      let url;
      try {
        const href = typeof input === 'string' ? input : input?.url;
        url = new URL(href, window.location.href);
      } catch {
        return originalFetch.call(this, input, init);
      }

      const isReverseGeocode = url.hostname === 'nominatim.openstreetmap.org' && url.pathname === '/reverse';
      const isTimeZoneLookup = url.hostname === 'api.open-meteo.com'
        && url.pathname === '/v1/forecast'
        && url.searchParams.get('timezone') === 'auto';

      if ((!isReverseGeocode && !isTimeZoneLookup) || init?.signal) {
        return originalFetch.call(this, input, init);
      }

      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 4500);
      return originalFetch.call(this, input, { ...(init || {}), signal: controller.signal })
        .finally(() => window.clearTimeout(timer));
    };

    try {
      Object.defineProperty(wrappedFetch, '__freqbeaconLocationLookupTimeoutV1', { value: true });
      window.fetch = wrappedFetch;
    } catch {
      // The stock fetch remains available if the environment prevents wrapping.
    }
  }

  function installApprovedSplash() {
    const splash = document.querySelector('.freqbeacon-splash');
    if (!splash) return;

    let art = splash.querySelector('.freqbeacon-splash__art');
    if (!art) {
      art = document.createElement('img');
      art.className = 'freqbeacon-splash__art';
      art.alt = '';
      art.loading = 'eager';
      art.decoding = 'sync';
      art.fetchPriority = 'high';
      art.setAttribute('aria-hidden', 'true');
      splash.replaceChildren(art);
    }
    art.src = STARTUP_SRC;

    let leaving = false;
    let removed = false;
    const removeSplash = () => {
      if (removed) return;
      removed = true;
      splash.remove();
    };

    const beginHold = () => {
      if (leaving) return;
      leaving = true;
      window.setTimeout(() => {
        splash.classList.add('is-leaving');
        window.setTimeout(removeSplash, SPLASH_FADE_MS + 75);
      }, SPLASH_HOLD_MS);
    };

    if (art.complete && art.naturalWidth > 0) {
      beginHold();
    } else {
      art.addEventListener('load', beginHold, { once: true });
      art.addEventListener('error', beginHold, { once: true });
      window.setTimeout(beginHold, SPLASH_MAX_WAIT_MS);
    }
  }

  function brandNode(root) {
    if (!root) return;

    if (root.nodeType === Node.TEXT_NODE) {
      const next = replaceString(root.nodeValue);
      if (next !== root.nodeValue) root.nodeValue = next;
      return;
    }

    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;

    if (root.nodeType === Node.ELEMENT_NODE) {
      for (const attr of ['aria-label', 'title', 'placeholder']) {
        if (!root.hasAttribute?.(attr)) continue;
        const current = root.getAttribute(attr);
        const next = replaceString(current);
        if (next !== current) root.setAttribute(attr, next);
      }
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const next = replaceString(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    }

    root.querySelectorAll?.('[aria-label],[title],[placeholder]').forEach((el) => {
      for (const attr of ['aria-label', 'title', 'placeholder']) {
        if (!el.hasAttribute(attr)) continue;
        const current = el.getAttribute(attr);
        const next = replaceString(current);
        if (next !== current) el.setAttribute(attr, next);
      }
    });
  }

  function applyPrimaryBrand() {
    document.title = `${DISPLAY_NAME} — ${TAGLINE}`;

    const description = document.querySelector('meta[name="description"]');
    if (description) {
      description.content = 'FreqBeacon helps radio listeners discover shortwave, medium-wave, longwave, and amateur radio signals, then explore them with live remote SDR spectrum and audio.';
    }

    const title = document.querySelector('.brand h1');
    if (title) title.textContent = DISPLAY_NAME;

    const tagline = document.querySelector('.brand p');
    if (tagline) tagline.textContent = TAGLINE;

    const mark = document.querySelector('.signal-logo');
    if (mark) {
      mark.style.backgroundImage = "url('freqbeacon-icon-v3-192.webp')";
      mark.setAttribute('role', 'img');
      mark.setAttribute('aria-label', 'FreqBeacon Beacon Tower logo');
      mark.removeAttribute('aria-hidden');
    }

    // Current production markup is already FREQBEACON-branded. Keep one
    // compatibility pass for any stale static text, but do not continuously
    // walk every dynamically-added subtree. The old page-wide observer made
    // normal card/player rendering pay an unnecessary recursive DOM-scan cost.
    brandNode(document.body);
  }

  function installGuidedListeningAssets() {
    if (new URLSearchParams(window.location.search).get('classic') === '1') return;

    if (!document.querySelector('link[data-freqbeacon-guide]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'freqbeacon-guide.css?v=1';
      link.dataset.freqbeaconGuide = '1';
      document.head.appendChild(link);
    }

    const loadScript = () => {
      if (document.querySelector('script[data-freqbeacon-guide]')) return;
      const script = document.createElement('script');
      script.src = 'freqbeacon-guide.js?v=1';
      script.dataset.freqbeaconGuide = '1';
      document.body.appendChild(script);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', loadScript, { once: true });
    } else {
      loadScript();
    }
  }

  disablePwaServiceWorker();
  installLocationReliability();
  installApprovedSplash();
  applyPrimaryBrand();
  installGuidedListeningAssets();
})();
