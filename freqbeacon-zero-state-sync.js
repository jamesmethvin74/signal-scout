(() => {
  'use strict';

  // Display/control-state adapter only. It observes the qualified Zero engine's
  // existing DOM state and does not own sockets, tuning commands, RF decoding,
  // audio, spectrum, or waterfall behavior.
  const power = document.querySelector('#power');
  const signalValue = document.querySelector('#signalValue');
  const dbmReadout = document.querySelector('#dbmReadout');
  const meterNeedle = document.querySelector('#meterNeedle');
  const frequencyBridge = document.querySelector('#frequencyValue');
  const bandButtons = [...document.querySelectorAll('[data-band-khz]')];

  const BAND_RANGES = Object.freeze([
    Object.freeze({ label: 'LW', min: 30, max: 300 }),
    Object.freeze({ label: 'AM BC', min: 520, max: 1710 }),
    Object.freeze({ label: '160m', min: 1800, max: 2000 }),
    Object.freeze({ label: '80m', min: 3500, max: 4000 }),
    Object.freeze({ label: '60m', min: 5330, max: 5407 }),
    Object.freeze({ label: '40m', min: 7000, max: 7300 }),
    Object.freeze({ label: 'Utility', min: 8890, max: 9095 }),
    Object.freeze({ label: '30m', min: 10100, max: 10150 }),
    Object.freeze({ label: 'Aviation', min: 11050, max: 11300 }),
    Object.freeze({ label: '20m', min: 14000, max: 14350 }),
    Object.freeze({ label: '17m', min: 18068, max: 18168 }),
    Object.freeze({ label: '15m', min: 21000, max: 21450 }),
    Object.freeze({ label: '12m', min: 24890, max: 24990 }),
    Object.freeze({ label: 'CB', min: 26965, max: 27405 }),
    Object.freeze({ label: '10m', min: 28000, max: 29700 })
  ]);

  function radioOn() {
    return power?.getAttribute('aria-pressed') === 'true';
  }

  function resetMetersWhenStopped() {
    if (radioOn()) return;
    if (dbmReadout) dbmReadout.textContent = '— dBm';
    if (meterNeedle) meterNeedle.style.setProperty('--meter-cal-angle', '-66deg');
  }

  function tunedKHz() {
    const mhz = Number(frequencyBridge?.textContent);
    return Number.isFinite(mhz) ? mhz * 1000 : NaN;
  }

  function bandLabelFor(kHz) {
    if (!Number.isFinite(kHz)) return null;

    const specific = BAND_RANGES.find((band) => kHz >= band.min && kHz <= band.max);
    if (specific) return specific.label;

    // General shortwave fallback after specific amateur / utility / CB ranges.
    if (kHz >= 2300 && kHz <= 26100) return 'Shortwave';
    return null;
  }

  function syncBandHighlight() {
    const activeLabel = bandLabelFor(tunedKHz());
    for (const button of bandButtons) {
      const active = button.textContent.trim() === activeLabel;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  }

  if (power) {
    new MutationObserver(resetMetersWhenStopped).observe(power, {
      attributes: true,
      attributeFilter: ['aria-pressed']
    });
  }

  if (signalValue) {
    new MutationObserver(resetMetersWhenStopped).observe(signalValue, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  if (frequencyBridge) {
    new MutationObserver(syncBandHighlight).observe(frequencyBridge, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  for (const button of bandButtons) {
    button.addEventListener('click', () => window.setTimeout(syncBandHighlight, 0));
  }

  resetMetersWhenStopped();
  syncBandHighlight();
})();
