(() => {
  'use strict';

  const canvas = document.querySelector('#rfCanvas');
  const cursor = document.querySelector('.tune-cursor');
  const centerMark = document.querySelector('#centerMark');
  const frequencyValue = document.querySelector('#frequencyValue');
  const power = document.querySelector('#power');
  const scope = document.querySelector('.scope');

  if (!canvas || !cursor || !centerMark || !frequencyValue || !scope) return;

  const FULL_BANDWIDTH_KHZ = 30000;
  const ZOOM = 8;
  const SPAN_KHZ = FULL_BANDWIDTH_KHZ / (2 ** ZOOM);
  const HALF_SPAN_KHZ = SPAN_KHZ / 2;
  const MIN_CENTER_KHZ = HALF_SPAN_KHZ;
  const MAX_CENTER_KHZ = FULL_BANDWIDTH_KHZ - HALF_SPAN_KHZ;
  const NEEDLE_HIT_PX = 30;
  const EPSILON_KHZ = 0.002;

  const gesture = {
    pointerId: null,
    mode: null,
    startX: 0,
    startCenterKHz: 0
  };

  function running() {
    return power?.getAttribute('aria-pressed') === 'true';
  }

  function parseCenterKHz() {
    const match = String(centerMark.textContent || '').match(/(-?\d+(?:\.\d+)?)\s*kHz/i);
    const value = match ? Number(match[1]) : NaN;
    return Number.isFinite(value) ? value : NaN;
  }

  function cursorClientX() {
    const rect = cursor.getBoundingClientRect();
    return rect.left + rect.width / 2;
  }

  function desiredCenterFor(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return gesture.startCenterKHz;
    const dx = event.clientX - gesture.startX;
    return gesture.startCenterKHz - (dx / rect.width) * SPAN_KHZ;
  }

  function boundaryClientX(boundaryKHz) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return gesture.startX;
    const dx = ((gesture.startCenterKHz - boundaryKHz) / SPAN_KHZ) * rect.width;
    return gesture.startX + dx;
  }

  function dispatchBoundaryPointer(type, source, boundaryKHz, buttons) {
    if (typeof PointerEvent !== 'function') return;
    canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: source.pointerId,
      pointerType: source.pointerType || 'touch',
      isPrimary: source.isPrimary !== false,
      clientX: boundaryClientX(boundaryKHz),
      clientY: source.clientY,
      buttons
    }));
  }

  function beyondBoundary(event) {
    if (gesture.pointerId !== event.pointerId || gesture.mode !== 'surface') return null;
    const desired = desiredCenterFor(event);
    if (desired < MIN_CENTER_KHZ) return MIN_CENTER_KHZ;
    if (desired > MAX_CENTER_KHZ) return MAX_CENTER_KHZ;
    return null;
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (!event.isTrusted || !running()) return;
    const center = parseCenterKHz();
    if (!Number.isFinite(center)) return;

    gesture.pointerId = event.pointerId;
    gesture.startX = event.clientX;
    gesture.startCenterKHz = center;
    gesture.mode = Math.abs(event.clientX - cursorClientX()) <= NEEDLE_HIT_PX ? 'needle' : 'surface';
  }, { capture: true });

  canvas.addEventListener('pointermove', (event) => {
    if (!event.isTrusted) return;
    const boundary = beyondBoundary(event);
    if (boundary == null) return;

    const currentCenter = parseCenterKHz();
    if (Number.isFinite(currentCenter) && Math.abs(currentCenter - boundary) > EPSILON_KHZ) {
      dispatchBoundaryPointer('pointermove', event, boundary, 1);
    }

    // The qualified dial correctly clamps the receiver state at the RF edge, but
    // its local display shifter used the raw finger delta. Blocking the physical
    // event here prevents the spectrum/waterfall from appearing to move beyond
    // a frequency range the receiver cannot actually enter.
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true });

  canvas.addEventListener('pointerup', (event) => {
    if (!event.isTrusted || gesture.pointerId !== event.pointerId) return;
    const boundary = beyondBoundary(event);
    if (boundary != null) {
      const currentCenter = parseCenterKHz();
      if (Number.isFinite(currentCenter) && Math.abs(currentCenter - boundary) > EPSILON_KHZ) {
        dispatchBoundaryPointer('pointermove', event, boundary, 1);
      }
      dispatchBoundaryPointer('pointerup', event, boundary, 0);
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    gesture.pointerId = null;
    gesture.mode = null;
  }, { capture: true });

  canvas.addEventListener('pointercancel', (event) => {
    if (gesture.pointerId !== event.pointerId) return;
    gesture.pointerId = null;
    gesture.mode = null;
  }, { capture: true });

  function currentKHz() {
    const mhz = Number(frequencyValue.textContent);
    return Number.isFinite(mhz) ? mhz * 1000 : NaN;
  }

  function lwContext(kHz) {
    if (!Number.isFinite(kHz) || kHz >= 530) return '';
    if (kHz < 300) return 'LONGWAVE';
    return 'BEACONS / NAV';
  }

  function installContextLabel() {
    if (scope.querySelector('.zero-lw-context')) return;

    const label = document.createElement('div');
    label.className = 'zero-lw-context';
    label.setAttribute('aria-hidden', 'true');
    scope.appendChild(label);

    const style = document.createElement('style');
    style.textContent = `
      /* The qualified canvas still paints its original static scale underneath
         the moving band overlay. Make the overlay's formerly-transparent label
         strip opaque so only the live, moving scale remains visible. */
      .zero-band-overlay {
        background: #060a0c;
      }
      .zero-lw-context {
        position: absolute;
        z-index: 3;
        left: 8px;
        top: 27.6%;
        height: 4.2%;
        display: flex;
        align-items: flex-start;
        pointer-events: none;
        color: #ffc46f;
        font: 700 clamp(7px, 1.55vw, 10px) ui-monospace, SFMono-Regular, Menlo, monospace;
        line-height: 1;
        letter-spacing: .02em;
        text-shadow: 0 1px 2px rgba(0,0,0,.8);
      }
      .zero-lw-context:empty { display: none; }
    `;
    document.head.appendChild(style);

    const render = () => {
      label.textContent = lwContext(currentKHz());
    };

    new MutationObserver(render).observe(frequencyValue, {
      childList: true,
      characterData: true,
      subtree: true
    });
    render();
  }

  // Module scripts append the qualified band overlay before DOMContentLoaded.
  // Installing this fallback afterward lets the LW context sit cleanly on top
  // without changing the qualified band's drawing code.
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', installContextLabel, { once: true });
  } else {
    installContextLabel();
  }
})();
