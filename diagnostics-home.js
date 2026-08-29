(() => {
  const isDiagnostics = /\/(?:sdr-diagnostics|sdr-runtime-trace)\.html$/i.test(location.pathname);
  if (!isDiagnostics || document.querySelector('[data-freqbeacon-return-home]')) return;

  const link = document.createElement('a');
  link.href = '/?from=diagnostics';
  link.dataset.freqbeaconReturnHome = 'true';
  link.textContent = '← Return to FREQBEACON';
  link.setAttribute('aria-label', 'Return to FREQBEACON home');
  link.style.cssText = [
    'position:sticky',
    'top:8px',
    'z-index:2147483647',
    'display:block',
    'width:max-content',
    'max-width:100%',
    'margin:0 0 12px 0',
    'padding:10px 13px',
    'border:1px solid #2b678e',
    'border-radius:11px',
    'background:#123550',
    'color:#fff',
    'font:800 14px/1.2 system-ui,-apple-system,sans-serif',
    'text-decoration:none',
    'box-shadow:0 6px 18px rgba(0,0,0,.25)'
  ].join(';');

  link.addEventListener('click', (event) => {
    event.preventDefault();
    location.replace('/?from=diagnostics');
  });

  const host = document.querySelector('.wrap') || document.body;
  host.insertBefore(link, host.firstChild);
})();
