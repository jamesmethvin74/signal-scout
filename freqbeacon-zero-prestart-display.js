(() => {
  'use strict';

  // UI-only helper: when a band/lookup target is selected while Zero is off,
  // reflect that pending target in the visible readout immediately. The existing
  // Zero control path still owns pendingBand and performs the actual receiver
  // tune only after START. No sockets, Kiwi commands, RF, audio, or tuning engine
  // behavior is changed here.
  const power = document.querySelector('#power');
  const display = document.querySelector('#frequencyDisplay');
  const unit = document.querySelector('#frequencyUnit');
  const bandButtons = [...document.querySelectorAll('[data-band-khz]')];

  if (!display || !bandButtons.length) return;

  function radioOn() {
    return power?.getAttribute('aria-pressed') === 'true';
  }

  function showTarget(kHz) {
    if (radioOn() || !Number.isFinite(kHz)) return;
    display.textContent = kHz.toLocaleString('en-US', {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3
    });
    if (unit) unit.textContent = 'kHz';
  }

  for (const button of bandButtons) {
    button.addEventListener('click', () => {
      showTarget(Number(button.dataset.bandKhz));
    });
  }
})();
