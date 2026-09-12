(() => {
  'use strict';

  // Shell-only tuning follow adapter. It never opens sockets or rewrites the
  // qualified Zero dial. It expresses viewport follow as the same pointer
  // gestures the qualified direct-manipulation layer already understands.
  const FULL_BAND_KHZ = 30000;
  const SPAN_KHZ = FULL_BAND_KHZ / (2 ** 8);
  const HALF_SPAN_KHZ = SPAN_KHZ / 2;
  const MIN_CENTER_KHZ = HALF_SPAN_KHZ;
  const MAX_CENTER_KHZ = FULL_BAND_KHZ - HALF_SPAN_KHZ;
  const FOLLOW_LEFT = 0.20;
  const FOLLOW_RIGHT = 0.80;
  const EPSILON_KHZ = 0.05;
  const MIN_FOLLOW_PIXELS = 8;

  const knob = document.querySelector('#tuningKnob');
  const canvas = document.querySelector('#rfCanvas');
  const cursor = document.querySelector('.tune-cursor');
  const frequencyBridge = document.querySelector('#frequencyValue');
  const centerMark = document.querySelector('#centerMark');
  const power = document.querySelector('#power');
  const fineButtons = [...document.querySelectorAll('[data-fine]')];

  if (!knob || !canvas || !cursor || !frequencyBridge || !centerMark) return;

  let recentering = false;
  let pointerSequence = 9400;

  function running() {
    return power?.getAttribute('aria-pressed') === 'true';
  }

  function tunedKHz() {
    const mhz = Number(frequencyBridge.textContent);
    return Number.isFinite(mhz) ? mhz * 1000 : NaN;
  }

  function centerKHz() {
    const match = String(centerMark.textContent || '').match(/(-?\d+(?:\.\d+)?)\s*kHz/i);
    const value = match ? Number(match[1]) : NaN;
    return Number.isFinite(value) ? value : NaN;
  }

  function clampCenter(value) {
    return Math.max(MIN_CENTER_KHZ, Math.min(MAX_CENTER_KHZ, value));
  }

  function ratioFor(tuned, center) {
    return (tuned - (center - HALF_SPAN_KHZ)) / SPAN_KHZ;
  }

  function nextPointerId() {
    pointerSequence += 1;
    if (pointerSequence > 9800) pointerSequence = 9401;
    return pointerSequence;
  }

  function dispatchPointer(type, x, pointerId, buttons) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || typeof PointerEvent !== 'function') return false;
    const y = rect.top + Math.max(8, Math.min(rect.height - 8, rect.height * 0.22));
    canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'mouse',
      isPrimary: true,
      clientX: x,
      clientY: y,
      buttons
    }));
    return true;
  }

  function cursorClientX() {
    const rect = cursor.getBoundingClientRect();
    return rect.left + rect.width / 2;
  }

  function surfacePanDelta(deltaKHz) {
    if (!Number.isFinite(deltaKHz) || Math.abs(deltaKHz) < EPSILON_KHZ) return true;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return false;

    const cursorX = cursorClientX();
    const inset = Math.max(38, Math.min(72, rect.width * 0.12));
    const leftStart = rect.left + inset;
    const rightStart = rect.right - inset;
    let startX = Math.abs(leftStart - cursorX) > Math.abs(rightStart - cursorX) ? leftStart : rightStart;
    if (Math.abs(startX - cursorX) <= 34) startX = cursorX < rect.left + rect.width / 2 ? rightStart : leftStart;

    const finalDx = -(deltaKHz / SPAN_KHZ) * rect.width;
    const endX = startX + finalDx;
    const pointerId = nextPointerId();

    dispatchPointer('pointerdown', startX, pointerId, 1);
    dispatchPointer('pointermove', endX, pointerId, 1);
    dispatchPointer('pointerup', endX, pointerId, 0);
    return true;
  }

  function needleTo(targetKHz) {
    const currentCenter = centerKHz();
    if (!Number.isFinite(currentCenter) || !Number.isFinite(targetKHz)) return false;

    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return false;
    const left = currentCenter - HALF_SPAN_KHZ;
    const targetRatio = Math.max(0, Math.min(1, (targetKHz - left) / SPAN_KHZ));
    const startX = cursorClientX();
    const endX = rect.left + targetRatio * rect.width;
    const pointerId = nextPointerId();

    dispatchPointer('pointerdown', startX, pointerId, 1);
    dispatchPointer('pointermove', endX, pointerId, 1);
    dispatchPointer('pointerup', endX, pointerId, 0);
    return true;
  }

  function autoFollow() {
    if (recentering || !running()) return;

    const tuned = tunedKHz();
    const center = centerKHz();
    if (!Number.isFinite(tuned) || !Number.isFinite(center)) return;

    const ratio = ratioFor(tuned, center);
    let followRatio = null;
    if (ratio > FOLLOW_RIGHT) followRatio = FOLLOW_RIGHT;
    else if (ratio < FOLLOW_LEFT) followRatio = FOLLOW_LEFT;
    else return;

    // Edge-follow instead of recentering: once the needle reaches the soft edge,
    // move the viewport only by the amount the needle has crossed that edge.
    // The needle therefore stays near 20%/80% while the RF world glides beneath
    // it, avoiding the large 15-20 kHz jumps of the original follow behavior.
    const desiredCenter = clampCenter(tuned - (followRatio - 0.5) * SPAN_KHZ);
    const centerDelta = desiredCenter - center;
    if (Math.abs(centerDelta) < EPSILON_KHZ) return; // Actual receiver edge.

    // The qualified dial intentionally ignores tiny surface drags. Accumulate
    // sub-pixel/fine-step movement until it represents one real drag threshold,
    // then apply that small delta. At a 1 kHz tuning step this is effectively
    // continuous on a phone-sized scope instead of a visible chunked recenter.
    const rect = canvas.getBoundingClientRect();
    const minDeltaKHz = rect.width
      ? (MIN_FOLLOW_PIXELS / rect.width) * SPAN_KHZ
      : EPSILON_KHZ;
    if (Math.abs(centerDelta) < Math.max(EPSILON_KHZ, minDeltaKHz)) return;

    recentering = true;
    try {
      surfacePanDelta(centerDelta);
      needleTo(tuned);
    } finally {
      recentering = false;
    }
  }

  // Existing knob/fine-control handlers run first; this adapter follows their
  // resulting tuned position and only shifts the viewport after the needle
  // reaches a soft edge. Fine steps remain owned by the existing control layer.
  knob.addEventListener('pointermove', autoFollow);
  knob.addEventListener('wheel', autoFollow, { passive: true });
  for (const button of fineButtons) button.addEventListener('click', autoFollow);
})();
