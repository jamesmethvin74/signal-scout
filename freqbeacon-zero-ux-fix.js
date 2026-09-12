(() => {
  'use strict';

  const display = document.querySelector('#frequencyDisplay');
  const unit = document.querySelector('#frequencyUnit');
  const power = document.querySelector('#power');
  const scopePower = document.querySelector('#scopeStartButton');

  function normalizeFrequencyReadout() {
    if (!display || !unit) return;

    const raw = String(display.textContent || '').trim();
    if (!raw.includes(',')) return;

    const hz = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(hz)) return;

    if (hz < 1_000_000) {
      display.textContent = (hz / 1000).toFixed(3);
      unit.textContent = 'kHz';
    } else {
      display.textContent = (hz / 1_000_000).toFixed(6);
      unit.textContent = 'MHz';
    }
  }

  if (display) {
    new MutationObserver(normalizeFrequencyReadout).observe(display, {
      childList: true,
      characterData: true,
      subtree: true
    });
    normalizeFrequencyReadout();
  }

  function syncScopePower() {
    if (!scopePower || !power) return;
    const running = power.getAttribute('aria-pressed') === 'true';
    const busy = power.disabled;

    scopePower.hidden = false;
    scopePower.disabled = busy;
    scopePower.classList.toggle('is-running', running);
    scopePower.textContent = busy && running ? 'STARTING' : running ? 'STOP' : 'START';
    scopePower.setAttribute(
      'aria-label',
      busy && running ? 'Receiver starting' : running ? 'Stop receiver' : 'Start receiver'
    );
  }

  scopePower?.addEventListener('click', () => {
    if (!power || power.disabled) return;
    power.click();
  });

  if (power) {
    new MutationObserver(syncScopePower).observe(power, {
      attributes: true,
      attributeFilter: ['aria-pressed', 'disabled']
    });
  }

  function loadKnobFollowAdapter() {
    if (document.querySelector('script[data-zero-knob-follow]')) return;
    const script = document.createElement('script');
    script.src = '/freqbeacon-zero-knob-follow.js?v=2';
    script.dataset.zeroKnobFollow = 'true';
    document.body.appendChild(script);
  }

  // Zero's qualified dial is a deferred module. Wait until DOMContentLoaded so
  // its direct-manipulation listeners are installed before the shell follow
  // adapter attaches after them.
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', loadKnobFollowAdapter, { once: true });
  } else {
    loadKnobFollowAdapter();
  }

  syncScopePower();
})();
