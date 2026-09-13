(() => {
  'use strict';

  // UI-only handoff from standalone Lookup into the existing qualified Zero
  // control path. It never opens sockets, sends Kiwi commands, owns tuning state,
  // or changes the SDR engine. It queues the target by invoking the same band
  // button handler a human tap already uses.
  const params = new URLSearchParams(window.location.search);
  if (params.get('from') !== 'lookup') return;

  const targetKHz = Number(params.get('frequency') || params.get('freq'));
  const requestedMode = String(params.get('mode') || 'am').toLowerCase();
  const allowedModes = new Set(['am', 'sam', 'usb', 'lsb', 'cw', 'nbfm']);
  if (!Number.isFinite(targetKHz) || targetKHz < 30 || targetKHz > 30000) return;
  const mode = allowedModes.has(requestedMode) ? requestedMode : 'am';

  const buttons = [...document.querySelectorAll('[data-band-khz]')];
  if (!buttons.length) return;

  function preferredButton() {
    if (targetKHz < 300) return buttons.find((button) => button.textContent.trim() === 'LW');
    if (targetKHz >= 520 && targetKHz <= 1710) return buttons.find((button) => button.textContent.trim() === 'AM BC');
    if (targetKHz >= 26965 && targetKHz <= 27405) return buttons.find((button) => button.textContent.trim() === 'CB');
    if (targetKHz >= 11050 && targetKHz <= 11300) return buttons.find((button) => button.textContent.trim() === 'Aviation');
    if (targetKHz >= 8890 && targetKHz <= 9095) return buttons.find((button) => button.textContent.trim() === 'Utility');
    return buttons.find((button) => button.textContent.trim() === 'Shortwave') || buttons[0];
  }

  const button = preferredButton() || buttons[0];
  const originalKHz = button.dataset.bandKhz;
  const originalMode = button.dataset.bandMode;
  button.dataset.bandKhz = String(targetKHz);
  button.dataset.bandMode = mode;
  button.click();
  button.dataset.bandKhz = originalKHz;
  if (originalMode == null) delete button.dataset.bandMode;
  else button.dataset.bandMode = originalMode;

  const notice = document.createElement('div');
  notice.setAttribute('role', 'status');
  notice.style.cssText = [
    'position:fixed', 'z-index:40', 'left:50%', 'bottom:max(14px,env(safe-area-inset-bottom))',
    'transform:translateX(-50%)', 'max-width:calc(100vw - 24px)', 'padding:9px 12px',
    'border:1px solid rgba(69,221,236,.42)', 'border-radius:999px', 'background:rgba(4,12,16,.94)',
    'color:#b9f8ff', 'box-shadow:0 10px 28px rgba(0,0,0,.34),0 0 18px rgba(69,221,236,.08)',
    'font:800 9px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace', 'letter-spacing:.06em',
    'text-align:center', 'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis', 'pointer-events:none'
  ].join(';');
  notice.textContent = `LOOKUP TARGET · ${targetKHz.toLocaleString(undefined, { maximumFractionDigits: 3 })} kHz · PRESS START`;
  document.body.appendChild(notice);

  const bridge = document.querySelector('#frequencyValue');
  if (!bridge) return;
  const observer = new MutationObserver(() => {
    const tunedKHz = Number(bridge.textContent) * 1000;
    if (!Number.isFinite(tunedKHz) || Math.abs(tunedKHz - targetKHz) > 0.6) return;
    notice.textContent = `TUNED FROM LOOKUP · ${targetKHz.toLocaleString(undefined, { maximumFractionDigits: 3 })} kHz`;
    observer.disconnect();
    window.setTimeout(() => notice.remove(), 2600);
  });
  observer.observe(bridge, { childList: true, characterData: true, subtree: true });
})();
