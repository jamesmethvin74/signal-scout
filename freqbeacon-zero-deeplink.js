(() => {
  'use strict';

  // Lookup handoff adapter only. It does not open sockets or send Kiwi commands.
  // Zero's proven engine/dial already understand ?from=lookup&frequency=... and
  // use that value as their INITIAL SND + W/F center. Category browse links use
  // from=lookup-category, so normalize that source before deferred module scripts
  // initialize instead of queueing a second post-start retune.
  const params = new URLSearchParams(window.location.search);
  const source = params.get('from');
  if (source !== 'lookup' && source !== 'lookup-category') return;

  const targetKHz = Number(params.get('frequency') || params.get('freq'));
  const requestedMode = String(params.get('mode') || 'am').toLowerCase();
  const allowedModes = new Set(['am', 'sam', 'usb', 'lsb', 'cw', 'nbfm']);
  if (!Number.isFinite(targetKHz) || targetKHz < 30 || targetKHz > 30000) return;
  const mode = allowedModes.has(requestedMode) ? requestedMode : 'am';

  if (source === 'lookup-category') {
    params.set('from', 'lookup');
    const query = params.toString();
    history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }

  // Controls are already attached because this is a classic script that runs
  // after the shell control scripts but before the deferred Zero engine modules.
  // Clicking the MODE button while OFF only updates Zero's selected mode; it does
  // not touch the network. Do NOT click a band button here: that would create a
  // pending post-start retune and can disturb the paired W/F startup sequence.
  const modeButton = document.querySelector(`[data-shell-mode="${mode}"]`);
  if (modeButton && !modeButton.classList.contains('active')) modeButton.click();

  function primeLookupTarget() {
    const display = document.querySelector('#frequencyDisplay');
    const bridge = document.querySelector('#frequencyValue');
    const center = document.querySelector('#centerMark');
    if (display) display.textContent = targetKHz.toFixed(3);
    if (bridge) bridge.textContent = (targetKHz / 1000).toFixed(6);
    if (center) center.textContent = `VIEW ${targetKHz.toFixed(3)} kHz`;
  }

  primeLookupTarget();

  const notice = document.createElement('div');
  notice.setAttribute('role', 'status');
  notice.style.cssText = [
    'position:fixed', 'z-index:40', 'left:50%', 'bottom:max(66px,calc(54px + env(safe-area-inset-bottom)))',
    'transform:translateX(-50%)', 'max-width:calc(100vw - 24px)', 'padding:9px 12px',
    'border:1px solid rgba(245,189,105,.5)', 'border-radius:999px', 'background:rgba(12,10,7,.95)',
    'color:#ffe0a5', 'box-shadow:0 10px 28px rgba(0,0,0,.34),0 0 18px rgba(245,189,105,.08)',
    'font:800 9px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace', 'letter-spacing:.06em',
    'text-align:center', 'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis', 'pointer-events:none'
  ].join(';');
  notice.textContent = `LOOKUP TARGET · ${targetKHz.toLocaleString(undefined, { maximumFractionDigits: 3 })} kHz · PRESS START`;
  document.body.appendChild(notice);
  window.setTimeout(() => notice.remove(), 5000);
})();