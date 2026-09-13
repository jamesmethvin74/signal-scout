(() => {
  'use strict';

  // Display-only S-meter calibration. The Kiwi dBm telemetry remains
  // authoritative. This adapter maps that value to the rendered meter marks.
  const signalValue = document.querySelector('#signalValue');
  const meterNeedle = document.querySelector('#meterNeedle');
  const analogMeter = document.querySelector('.analog-meter');
  const meterWindow = document.querySelector('.meter-window');
  const meterScale = document.querySelector('.meter-scale');

  if (!signalValue || !meterNeedle || !meterWindow || !meterScale) return;

  const baseMarks = [...meterScale.querySelectorAll('span')];
  if (baseMarks[0]) baseMarks[0].textContent = '1';
  if (baseMarks[5]) baseMarks[5].textContent = '+10';

  if (meterScale.children.length < 8) {
    for (const label of ['+40', '+60 dBm']) {
      const mark = document.createElement('span');
      mark.textContent = label;
      mark.className = 'meter-over-mark';
      meterScale.append(mark);
    }
  }

  const scaleMarks = [...meterScale.querySelectorAll('span')].slice(0, 8);

  // Conventional HF S-meter reference: S9 = -73 dBm and 6 dB per S-unit
  // below S9. Above S9, the printed over-S9 marks are literal dB offsets.
  const DBM_MARKS = Object.freeze([-121, -109, -97, -85, -73, -63, -33, -13]);
  const FALLBACK_ANGLES = Object.freeze([-66, -49, -31, -12, 8, 22, 47, 65]);
  let markAngles = [...FALLBACK_ANGLES];
  let resizeFrame = 0;

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function measureScaleAngles() {
    const windowRect = meterWindow.getBoundingClientRect();
    if (!windowRect.width || !windowRect.height) return;

    const pivotX = windowRect.left + windowRect.width / 2;
    const pivotY = windowRect.bottom - 1;
    const measured = scaleMarks.map((mark) => {
      const rect = mark.getBoundingClientRect();
      const targetX = rect.left + rect.width / 2;
      const targetY = windowRect.top + windowRect.height * 0.48;
      return Math.atan2(targetX - pivotX, pivotY - targetY) * 180 / Math.PI;
    });

    if (measured.length === DBM_MARKS.length && measured.every(Number.isFinite)) {
      markAngles = measured;
    }
  }

  function angleForDbm(dbm) {
    if (dbm <= DBM_MARKS[0]) return markAngles[0];
    if (dbm >= DBM_MARKS[DBM_MARKS.length - 1]) return markAngles[markAngles.length - 1];

    for (let i = 0; i < DBM_MARKS.length - 1; i += 1) {
      const lowDbm = DBM_MARKS[i];
      const highDbm = DBM_MARKS[i + 1];
      if (dbm > highDbm) continue;
      const t = (dbm - lowDbm) / (highDbm - lowDbm);
      return markAngles[i] + (markAngles[i + 1] - markAngles[i]) * t;
    }

    return markAngles[markAngles.length - 1];
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
      meterNeedle.style.setProperty('--meter-cal-angle', `${markAngles[0].toFixed(1)}deg`);
      analogMeter?.setAttribute('aria-label', 'Signal meter');
      return;
    }

    const angle = angleForDbm(dbm);
    meterNeedle.style.setProperty('--meter-cal-angle', `${angle.toFixed(1)}deg`);
    analogMeter?.setAttribute('aria-label', `Signal meter ${meterLabel(dbm)}, ${Math.round(dbm)} dBm`);
  }

  function remeasureAndUpdate() {
    measureScaleAngles();
    updateMeter();
  }

  new MutationObserver(updateMeter).observe(signalValue, {
    childList: true,
    characterData: true,
    subtree: true
  });

  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(remeasureAndUpdate);
  }, { passive: true });

  requestAnimationFrame(remeasureAndUpdate);
})();
