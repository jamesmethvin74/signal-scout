(() => {
  'use strict';

  const display = document.querySelector('#frequencyDisplay');
  const unit = document.querySelector('#frequencyUnit');
  const power = document.querySelector('#power');
  const scopeStart = document.querySelector('#scopeStartButton');

  function parseDisplayedHz() {
    const raw = String(display?.textContent || '').replace(/[^0-9.-]/g, '');
    const value = Number(raw);
    return Number.isFinite(value) ? value : NaN;
  }

  function normalizeFrequencyReadout() {
    if (!display || !unit) return;
    const hz = parseDisplayedHz();
    if (!Number.isFinite(hz)) return;

    if (hz < 1_000_000) {
      display.textContent = (hz / 1000).toFixed(3);
      unit.textContent = 'kHz';
    } else {
      display.textContent = (hz / 1_000_000).toFixed(6);
      unit.textContent = 'MHz';
    }
  }

  let normalizing = false;
  if (display) {
    const observer = new MutationObserver(() => {
      if (normalizing) return;
      normalizing = true;
      normalizeFrequencyReadout();
      normalizing = false;
    });
    observer.observe(display, { childList: true, characterData: true, subtree: true });
    normalizeFrequencyReadout();
  }

  function syncScopeStart() {
    if (!scopeStart || !power) return;
    const running = power.getAttribute('aria-pressed') === 'true';
    scopeStart.hidden = running;
    scopeStart.disabled = power.disabled;
  }

  scopeStart?.addEventListener('click', () => {
    if (!power || power.disabled) return;
    power.click();
  });

  if (power) {
    new MutationObserver(syncScopeStart).observe(power, {
      attributes: true,
      attributeFilter: ['aria-pressed', 'disabled']
    });
  }

  syncScopeStart();
})();
