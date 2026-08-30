(() => {
  const isTrace = /\/sdr-runtime-trace\.html$/i.test(location.pathname);
  const isDiagnostics = isTrace || /\/sdr-diagnostics\.html$/i.test(location.pathname);
  if (!isDiagnostics || document.querySelector('[data-freqbeacon-return-home]')) return;

  const link = document.createElement('a');
  link.href = '/?from=diagnostics';
  link.dataset.freqbeaconReturnHome = 'true';
  link.textContent = isTrace ? '▶ CLEAR TRACE & START SDR TEST' : '← Return to FREQBEACON';
  link.setAttribute('aria-label', isTrace ? 'Clear the SDR trace and start the test in FREQBEACON' : 'Return to FREQBEACON home');
  link.style.cssText = [
    'position:sticky',
    'top:8px',
    'z-index:2147483647',
    'display:block',
    'width:100%',
    'max-width:900px',
    'margin:0 0 14px 0',
    'padding:14px 16px',
    'border:1px solid #54c7f3',
    'border-radius:12px',
    'background:#123f5b',
    'color:#fff',
    'font:900 15px/1.2 system-ui,-apple-system,sans-serif',
    'text-align:center',
    'text-decoration:none',
    'box-shadow:0 8px 24px rgba(0,0,0,.32)'
  ].join(';');

  link.addEventListener('click', (event) => {
    event.preventDefault();
    if (isTrace) {
      try { localStorage.removeItem('freqbeacon:sdr-runtime-trace:v1'); } catch {}
      location.replace('/?sdrtest=1');
      return;
    }
    location.replace('/?from=diagnostics');
  });

  const host = document.querySelector('.wrap') || document.body;
  host.insertBefore(link, host.firstChild);
})();
