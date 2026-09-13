(() => {
  'use strict';

  // UI-only helper for a target selected before the live Zero receiver starts.
  // The qualified Zero control/session path still owns the actual receiver tune.
  // This helper only keeps the visible frequency readout aligned with the pending
  // target until Zero's real frequency bridge reaches that same value.
  const power = document.querySelector('#power');
  const display = document.querySelector('#frequencyDisplay');
  const unit = document.querySelector('#frequencyUnit');
  const bridge = document.querySelector('#frequencyValue');
  const bandButtons = [...document.querySelectorAll('[data-band-khz]')];

  if (!display || !bandButtons.length) return;

  let pendingKHz = NaN;
  let bridgeObserver = null;

  function radioOn() {
    return power?.getAttribute('aria-pressed') === 'true';
  }

  function bridgeKHz() {
    const mhz = Number(bridge?.textContent);
    return Number.isFinite(mhz) ? mhz * 1000 : NaN;
  }

  function formatKHz(kHz) {
    return kHz.toLocaleString('en-US', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    });
  }

  function targetReached() {
    const actualKHz = bridgeKHz();
    return Number.isFinite(pendingKHz)
      && Number.isFinite(actualKHz)
      && Math.abs(actualKHz - pendingKHz) <= 0.6;
  }

  function paintPendingTarget() {
    if (!Number.isFinite(pendingKHz)) return;

    if (targetReached()) {
      display.textContent = formatKHz(pendingKHz);
      if (unit) unit.textContent = 'kHz';
      pendingKHz = NaN;
      bridgeObserver?.disconnect();
      bridgeObserver = null;
      return;
    }

    // Zero's deferred module initializes at 560 kHz and START also resets its
    // bridge before the pending target is applied. Keep the requested target
    // visible through both transitions so the user never sees a false 560 kHz.
    display.textContent = formatKHz(pendingKHz);
    if (unit) unit.textContent = 'kHz';
  }

  function watchBridge() {
    if (!bridge || bridgeObserver) return;
    bridgeObserver = new MutationObserver(paintPendingTarget);
    bridgeObserver.observe(bridge, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  function queuePendingTarget(kHz) {
    if (!Number.isFinite(kHz)) return;
    pendingKHz = kHz;
    watchBridge();
    paintPendingTarget();
  }

  for (const button of bandButtons) {
    button.addEventListener('click', () => {
      // When already live, the qualified Zero tuning path updates the readout.
      // This helper is only for the pre-start/pending state.
      if (radioOn()) return;
      queuePendingTarget(Number(button.dataset.bandKhz));
    });
  }

  // Lookup's deep-link click fires before deferred Zero modules finish loading.
  // Reassert the requested target after module initialization as a final guard.
  const params = new URLSearchParams(window.location.search);
  const lookupTarget = Number(params.get('frequency') || params.get('freq'));
  if (params.get('from') === 'lookup' && Number.isFinite(lookupTarget)) {
    const afterZeroInit = () => {
      queuePendingTarget(lookupTarget);
      window.requestAnimationFrame(paintPendingTarget);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', afterZeroInit, { once: true });
    } else {
      window.queueMicrotask(afterZeroInit);
    }
  }
})();
