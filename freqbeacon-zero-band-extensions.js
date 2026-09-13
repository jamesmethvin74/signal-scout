(() => {
  'use strict';

  // Display-only extension for service/band ranges that are intentionally kept
  // outside the qualified Zero dial/SDR engine. This adapter observes the
  // existing viewport bridge and paints only the missing allocation bars.
  const EXTRA_BANDS = Object.freeze([
    Object.freeze({ start: 8890, end: 9095, label: 'UTILITY', kind: 'service' }),
    Object.freeze({ start: 11050, end: 11300, label: 'AVIATION', kind: 'service' }),
    Object.freeze({ start: 24890, end: 24990, label: '12 m HAM', kind: 'ham' }),
    Object.freeze({ start: 26965, end: 27405, label: 'CB', kind: 'service' })
  ]);

  const centerMark = document.querySelector('#centerMark');
  const scope = document.querySelector('.scope');
  if (!centerMark || !scope) return;

  const VIEW_SPAN_KHZ = 30000 / (2 ** 8);
  let overlay = null;
  let ctx = null;

  function centerKHz() {
    const match = centerMark.textContent.match(/VIEW\s+([0-9.]+)\s+kHz/i);
    return match ? Number(match[1]) : NaN;
  }

  function draw() {
    if (!overlay || !ctx) return;
    const center = centerKHz();
    if (!Number.isFinite(center)) return;

    const left = center - (VIEW_SPAN_KHZ / 2);
    const right = center + (VIEW_SPAN_KHZ / 2);
    const span = right - left;
    const w = overlay.width;
    const scaleY = 28;
    const bandH = 12;

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const visible = EXTRA_BANDS.filter((band) => band.end > left && band.start < right);
    for (const band of visible) {
      const x1 = Math.max(0, ((Math.max(left, band.start) - left) / span) * w);
      const x2 = Math.min(w, ((Math.min(right, band.end) - left) / span) * w);
      if (x2 <= x1) continue;

      ctx.fillStyle = band.kind === 'ham' ? '#159a78' : '#df872b';
      ctx.fillRect(x1, scaleY, Math.max(1, x2 - x1), bandH);

      ctx.font = '700 16px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = band.kind === 'ham' ? '#75e2bd' : '#ffc46f';
      const labelX = Math.max(8, x1 + 8);
      ctx.fillText(band.label, Math.min(w - 160, labelX), 0);
    }
  }

  function attach() {
    const baseOverlay = scope.querySelector('.zero-band-overlay');
    if (!baseOverlay) {
      requestAnimationFrame(attach);
      return;
    }

    overlay = document.createElement('canvas');
    overlay.className = 'zero-band-extension-overlay';
    overlay.width = 1024;
    overlay.height = 70;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = [
      'position:absolute',
      'z-index:3',
      'left:0',
      'top:27.4074%',
      'width:100%',
      'height:12.9630%',
      'pointer-events:none'
    ].join(';');
    scope.appendChild(overlay);
    ctx = overlay.getContext('2d');

    new MutationObserver(draw).observe(centerMark, {
      childList: true,
      characterData: true,
      subtree: true
    });

    draw();
  }

  attach();
})();
