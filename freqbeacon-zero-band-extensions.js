(() => {
  'use strict';

  // Display-only extension for service/band ranges that are intentionally kept
  // outside the qualified Zero dial/SDR engine. This adapter observes the
  // existing viewport bridge and paints only the missing allocation bars.
  const EXTRA_BANDS = Object.freeze([
    Object.freeze({ start: 8890, end: 9095, label: 'UTILITY', kind: 'service' }),
    Object.freeze({ start: 11050, end: 11300, label: 'AVIATION', kind: 'service' }),
    Object.freeze({ start: 24890, end: 24990, label: '12 m HAM', kind: 'ham' }),
    Object.freeze({ start: 26965, end: 27405, label: 'CB', kind: 'cb' })
  ]);

  // FCC CBRS channel center frequencies. Channels 24 and 25 sit below channel
  // 23 in frequency, so frequency-order labels intentionally read 22, 24, 25,
  // 23, 26 across that portion of the scale.
  const CB_CHANNELS = Object.freeze([
    [1, 26965], [2, 26975], [3, 26985], [4, 27005], [5, 27015],
    [6, 27025], [7, 27035], [8, 27055], [9, 27065], [10, 27075],
    [11, 27085], [12, 27105], [13, 27115], [14, 27125], [15, 27135],
    [16, 27155], [17, 27165], [18, 27175], [19, 27185], [20, 27205],
    [21, 27215], [22, 27225], [23, 27255], [24, 27235], [25, 27245],
    [26, 27265], [27, 27275], [28, 27285], [29, 27295], [30, 27305],
    [31, 27315], [32, 27325], [33, 27335], [34, 27345], [35, 27355],
    [36, 27365], [37, 27375], [38, 27385], [39, 27395], [40, 27405]
  ].map(([channel, center]) => Object.freeze({ channel, center })));

  const DEFAULT_VIEW_SPAN_KHZ = 30000 / (2 ** 8);

  const centerMark = document.querySelector('#centerMark');
  const leftEdge = document.querySelector('#leftEdge');
  const rightEdge = document.querySelector('#rightEdge');
  const scope = document.querySelector('.scope');
  if (!centerMark || !scope) return;

  let overlay = null;
  let ctx = null;

  function parseMHzBridge(node) {
    const match = String(node?.textContent || '').match(/(-?\d+(?:\.\d+)?)\s*MHz/i);
    const value = match ? Number(match[1]) : NaN;
    return Number.isFinite(value) ? value * 1000 : NaN;
  }

  function centerKHz() {
    const match = centerMark.textContent.match(/VIEW\s+([0-9.]+)\s+kHz/i);
    return match ? Number(match[1]) : NaN;
  }

  function viewport() {
    const bridgeLeft = parseMHzBridge(leftEdge);
    const bridgeRight = parseMHzBridge(rightEdge);
    if (Number.isFinite(bridgeLeft) && Number.isFinite(bridgeRight) && bridgeRight > bridgeLeft) {
      return { left: bridgeLeft, right: bridgeRight };
    }

    const center = centerKHz();
    if (!Number.isFinite(center)) return null;
    return {
      left: center - DEFAULT_VIEW_SPAN_KHZ / 2,
      right: center + DEFAULT_VIEW_SPAN_KHZ / 2
    };
  }

  function xFor(kHz, left, span, width) {
    return ((kHz - left) / span) * width;
  }

  function drawStandardBand(band, left, right, span, width, scaleY, bandH) {
    const x1 = Math.max(0, xFor(Math.max(left, band.start), left, span, width));
    const x2 = Math.min(width, xFor(Math.min(right, band.end), left, span, width));
    if (x2 <= x1) return;

    ctx.fillStyle = band.kind === 'ham' ? '#159a78' : '#df872b';
    ctx.fillRect(x1, scaleY, Math.max(1, x2 - x1), bandH);

    ctx.font = '700 22px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = band.kind === 'ham' ? '#86efd0' : '#ffd188';
    const labelX = Math.max(8, x1 + 8);
    ctx.fillText(band.label, Math.min(width - 190, labelX), 0);
  }

  function drawCbChannels(left, right, span, width, scaleY, bandH) {
    const cbStart = 26965;
    const cbEnd = 27405;
    const visibleLeft = Math.max(left, cbStart);
    const visibleRight = Math.min(right, cbEnd);
    if (visibleRight <= visibleLeft) return;

    const x1 = Math.max(0, xFor(visibleLeft, left, span, width));
    const x2 = Math.min(width, xFor(visibleRight, left, span, width));
    if (x2 <= x1) return;

    // One continuous CB allocation bar. Channel boundaries are black separators
    // between adjacent channel centers so the band stays unified but readable.
    ctx.fillStyle = '#df872b';
    ctx.fillRect(x1, scaleY, Math.max(1, x2 - x1), bandH);

    ctx.font = '700 24px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffd188';
    const cbLabelX = Math.max(8, x1 + 8);
    ctx.fillText('CB', Math.min(width - 48, cbLabelX), 0);

    const ordered = [...CB_CHANNELS].sort((a, b) => a.center - b.center);

    // Draw a thin black divider halfway between each neighboring channel center.
    // This preserves the true irregular spacing around the RC gaps and 23/24/25.
    ctx.fillStyle = 'rgba(3, 6, 8, .98)';
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const boundary = (ordered[i].center + ordered[i + 1].center) / 2;
      if (boundary <= left || boundary >= right) continue;
      const boundaryX = xFor(boundary, left, span, width);
      if (boundaryX < x1 || boundaryX > x2) continue;
      ctx.fillRect(Math.round(boundaryX), scaleY, 1, bandH);
    }

    const tenKHzPx = (10 / span) * width;
    const labelEvery = tenKHzPx >= 34 ? 1 : tenKHzPx >= 16 ? 5 : 10;
    const channelFontSize = tenKHzPx >= 34 ? 22 : tenKHzPx >= 16 ? 18 : 16;

    for (let i = 0; i < ordered.length; i += 1) {
      const { channel, center } = ordered[i];
      if (center < left || center > right) continue;
      if (labelEvery !== 1 && channel !== 1 && channel !== 40 && channel % labelEvery !== 0) continue;

      // The black dividers define the visible channel cell. Center the label on
      // that cell, not on the RF center frequency, so irregular CB spacing does
      // not make the typography look left- or right-justified.
      const cellLeft = i === 0
        ? cbStart
        : (ordered[i - 1].center + center) / 2;
      const cellRight = i === ordered.length - 1
        ? cbEnd
        : (center + ordered[i + 1].center) / 2;
      const labelFrequency = (cellLeft + cellRight) / 2;
      const labelX = xFor(labelFrequency, left, span, width);
      if (labelX < 0 || labelX > width) continue;

      // Channel numbers stay above the bar on the same row as the CB label.
      // Suppress only labels that would directly overlap the letters "CB".
      if (labelX < cbLabelX + 44 && labelX > cbLabelX - 8) continue;
      ctx.font = `700 ${channelFontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#fff0c9';
      ctx.fillText(String(channel), labelX, 1);
    }
  }

  function drawReadableScale(left, right, width, scaleY, bandH) {
    const span = right - left;
    const scaleTop = scaleY + bandH;

    // Cover the smaller base-canvas scale typography and repaint it at a size
    // that remains legible on a phone held at normal viewing distance.
    ctx.fillStyle = '#060a0c';
    ctx.fillRect(0, scaleTop, width, overlay.height - scaleTop);

    ctx.strokeStyle = 'rgba(145, 169, 177, .58)';
    ctx.fillStyle = 'rgba(218, 229, 232, .96)';
    ctx.font = '600 26px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'top';

    for (let i = 0; i <= 8; i += 1) {
      const x = (i / 8) * width;
      const major = i % 2 === 0;
      ctx.beginPath();
      ctx.moveTo(Math.round(x) + .5, scaleTop);
      ctx.lineTo(Math.round(x) + .5, scaleTop + (major ? 7 : 4));
      ctx.stroke();

      if (!major) continue;
      const frequency = left + (i / 8) * span;
      ctx.textAlign = i === 0 ? 'left' : i === 8 ? 'right' : 'center';
      ctx.fillText(
        (frequency / 1000).toFixed(4),
        Math.max(3, Math.min(width - 3, x)),
        scaleTop + 4
      );
    }
  }

  function draw() {
    if (!overlay || !ctx) return;
    const view = viewport();
    if (!view) return;

    const { left, right } = view;
    const span = right - left;
    const width = overlay.width;
    const scaleY = 28;
    const bandH = 12;

    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const visible = EXTRA_BANDS.filter((band) => band.end > left && band.start < right);
    for (const band of visible) {
      if (band.kind === 'cb') {
        drawCbChannels(left, right, span, width, scaleY, bandH);
      } else {
        drawStandardBand(band, left, right, span, width, scaleY, bandH);
      }
    }

    drawReadableScale(left, right, width, scaleY, bandH);
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

    const observer = new MutationObserver(draw);
    for (const bridge of [centerMark, leftEdge, rightEdge]) {
      if (!bridge) continue;
      observer.observe(bridge, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }

    window.addEventListener('freqbeacon:zero-zoom', draw);
    draw();
  }

  attach();
})();
