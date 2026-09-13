(() => {
  'use strict';

  // Display-only S-meter calibration. The receiver's dBm telemetry remains
  // authoritative; this adapter only maps that value onto the analog scale.
  // Conventional HF reference: S9 = -73 dBm, 6 dB per S-unit below S9.
  const signalValue = document.querySelector('#signalValue');
  const meterNeedle = document.querySelector('#meterNeedle');
  const analogMeter = document.querySelector('.analog-meter');

  if (!signalValue || !meterNeedle) return;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function meterPercent(dbm) {
    // Printed scale positions are S1, S3, S5, S7, S9, +20.
    // S1 = -121 dBm, S3 = -109, S5 = -97, S7 = -85, S9 = -73.
    // The final 20% of the sweep represents S9 through S9+20 (-53 dBm).
    if (dbm <= -121) return 0;
    if (dbm <= -73) return clamp(((dbm + 121) / 48) * 0.8, 0, 0.8);
    return clamp(0.8 + ((dbm + 73) / 20) * 0.2, 0.8, 1);
  }

  function meterLabel(dbm) {
    if (dbm >= -73) {
      const over = Math.max(0, Math.round(dbm + 73));
      return over ? `S9 +${over}` : 'S9';
    }
    const s = clamp(9 + (dbm + 73) / 6, 1, 9);
    return `S${s.toFixed(s < 2 ? 1 : 0)}`;
  }

  function updateMeter() {
    const match = String(signalValue.textContent || '').match(/-?\d+(?:\.\d+)?/);
    const dbm = match ? Number(match[0]) : NaN;

    if (!Number.isFinite(dbm)) {
      meterNeedle.style.setProperty('--meter-cal-angle', '-48deg');
      analogMeter?.setAttribute('aria-label', 'Signal meter');
      return;
    }

    const pct = meterPercent(dbm);
    const angle = -48 + pct * 96;
    meterNeedle.style.setProperty('--meter-cal-angle', `${angle.toFixed(1)}deg`);
    analogMeter?.setAttribute('aria-label', `Signal meter ${meterLabel(dbm)}, ${Math.round(dbm)} dBm`);
  }

  new MutationObserver(updateMeter).observe(signalValue, {
    childList: true,
    characterData: true,
    subtree: true
  });

  updateMeter();
})();
