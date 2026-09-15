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
  const CB_HALF_SEGMENT_KHZ = 4; // 8 kHz AM channel-width treatment.

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

    ctx.font = '700 16px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = band.kind === 'ham' ? '#75e2bd' : '#ffc46f';
    const labelX = Math.max(8, x1 + 8);
    ctx.fillText(band.label, Math.min(width - 160, labelX), 0);
  }

  function drawCbChannels(left, right, span, width, scaleY, bandH) {
    const cbLeft = Math.max(left, 26961);
    const cbRight = Math.min(right, 27409);
    if (cbRight <= cbLeft) return;

    const visibleChannels = CB_CHANNELS
      .filter(({ center }) => center + CB_HALF_SEGMENT_KHZ > left && center - CB_HALF_SEGMENT_KHZ < right)
      .sort((a, b) => a.center - b.center);
    if (!visibleChannels.length) return;

    // Keep the overall CB identity, then let the numbered channel cells carry
    // the detail. At wider zooms the labels thin out while all 40 segments stay.
    const labelStart = Math.max(8, xFor(Math.max(left, 26965), left, span, width) + 8);
    ctx.font = '700 16px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffc46f';
    ctx.fillText('CB', Math.min(width - 60, labelStart), 0);

    const tenKHzPx = (10 / span) * width;
    const labelEvery = tenKHzPx >= 24 ? 1 : tenKHzPx >= 12 ? 5 : 10;

    for (const { channel, center } of visibleChannels) {
      const segmentLeft = center - CB_HALF_SEGMENT_KHZ;
      const segmentRight = center + CB_HALF_SEGMENT_KHZ;
      const x1 = Math.max(0, xFor(Math.max(left, segmentLeft), left, span, width));
      const x2 = Math.min(width, xFor(Math.min(right, segmentRight), left, span, width));
      if (x2 <= x1) continue;

      ctx.fillStyle = '#df872b';
      ctx.fillRect(x1, scaleY, Math.max(1, x2 - x1), bandH);

      // A faint center tick makes each channel center readable even when the
      // 8 kHz segment is only a few pixels wide.
      const centerX = xFor(center, left, span, width);
      if (centerX >= 0 && centerX <= width) {
        ctx.fillStyle = 'rgba(255, 226, 174, .68)';
        ctx.fillRect(Math.round(centerX), scaleY, 1, bandH);
      }

      if (labelEvery === 1 || channel === 1 || channel === 40 || channel % labelEvery === 0) {
        const cellWidth = Math.max(1, x2 - x1);
        ctx.font = `${tenKHzPx >= 24 ? 11 : 9}px ui-monospace, SFMono-Regular, Menlo, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillStyle = '#f3d4a0';
        ctx.fillText(String(channel), x1 + cellWidth / 2, scaleY + 1);
      }
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
