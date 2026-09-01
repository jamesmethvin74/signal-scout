import baseWorker from './worker-sdr-diagnostic-control-v3.js';

const MARKER = 'freqbeacon-sdr-copy-report-v7-instant';

function bootstrap() {
  return `<script>
(() => {
  if (window.__freqbeaconSdrCopyReportV7) return;
  window.__freqbeaconSdrCopyReportV7 = true;

  function reportText() {
    try {
      const report = window.__freqbeaconSdrLifecycleV3?.getReport?.();
      if (report) return JSON.stringify(report, null, 2);
    } catch {}
    return JSON.stringify({
      version: '${MARKER}',
      capturedAt: new Date().toISOString(),
      error: 'SDR lifecycle report is not available.',
      player: {
        status: document.querySelector('#sdrPlayer [data-sdr-status]')?.textContent?.trim() || '',
        receiver: document.querySelector('#sdrPlayer [data-sdr-receiver-button-name]')?.textContent?.trim() || '',
        message: document.querySelector('#sdrPlayer [data-sdr-message]')?.textContent?.trim() || ''
      }
    }, null, 2);
  }

  function setStatus(box, text) {
    const status = box?.querySelector('[data-sdr-diagnostic-status-v5]');
    if (status) status.textContent = text;
  }

  function showSelectedReport(box, text) {
    const textarea = box?.querySelector('[data-sdr-diagnostic-report-v5]');
    const showButton = box?.querySelector('[data-sdr-diagnostic-show-v5]');
    if (!textarea) return;
    textarea.value = text;
    textarea.hidden = false;
    if (showButton) showButton.textContent = 'Hide report';
    textarea.focus();
    try { textarea.setSelectionRange(0, textarea.value.length); } catch {}
    textarea.scrollTop = 0;
  }

  function execCopy(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:.01;z-index:2147483647';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try { textarea.setSelectionRange(0, textarea.value.length); } catch {}
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    textarea.remove();
    return ok;
  }

  function markCopied(box, button) {
    button.textContent = 'Copied — paste into ChatGPT';
    setStatus(box, 'SDR diagnostic copied to clipboard.');
    setTimeout(() => { button.textContent = 'Copy report'; }, 2200);
  }

  function copyReport(box, button) {
    // Snapshot immediately when the user taps. Never await Android clipboard
    // promises before returning control to the UI.
    const text = reportText();

    if (execCopy(text)) {
      markCopied(box, button);
      return;
    }

    // If synchronous copy is blocked, expose/select the snapshot immediately.
    // The async clipboard attempt below is fire-and-forget and cannot delay this UI.
    showSelectedReport(box, text);
    button.textContent = 'Report ready — selected below';
    setStatus(box, 'Report captured instantly. Android blocked synchronous copy; the report is selected below.');

    try {
      const pending = navigator.clipboard?.writeText?.(text);
      if (pending?.then) {
        pending.then(() => markCopied(box, button)).catch(() => {});
      }
    } catch {}

    setTimeout(() => {
      if (button.textContent === 'Report ready — selected below') button.textContent = 'Copy report';
    }, 2600);
  }

  function patchBox() {
    const box = document.querySelector('#sdrPlayer [data-sdr-diagnostic-control-v5]');
    if (!box) return false;

    box.querySelector('[data-sdr-diagnostic-share-v5]')?.remove();
    box.querySelector('[data-sdr-diagnostic-download-v5]')?.remove();

    const actions = box.querySelector('[data-sdr-diagnostic-actions-v5]');
    if (!actions) return false;

    let copy = box.querySelector('[data-sdr-diagnostic-copy-v6]');
    if (!copy) {
      copy = document.createElement('button');
      copy.type = 'button';
      copy.dataset.sdrDiagnosticCopyV6 = '1';
      copy.textContent = 'Copy report';
      copy.addEventListener('click', () => copyReport(box, copy));
      actions.prepend(copy);
    }
    return true;
  }

  patchBox();
  const timer = setInterval(patchBox, 250);
  window.addEventListener('pagehide', () => clearInterval(timer), { once:true });
  window.addEventListener('freqbeacon:snd-created', patchBox);
  window.addEventListener('freqbeacon:snd-ready', patchBox);
  window.addEventListener('freqbeacon:snd-audio', patchBox);
  window.addEventListener('freqbeacon:sdr-diagnostic-updated', patchBox);
})();
</script>`;
}

function patchRoot(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;
  return response.text().then((html) => {
    const injection = bootstrap();
    if (!html.includes(MARKER)) {
      html = html.replace('</body>', `${injection}\n</body>`);
    }
    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-sdr-copy-report', MARKER);
    return new Response(html, { status:response.status, statusText:response.statusText, headers });
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await baseWorker.fetch(request, env, ctx);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return patchRoot(response);
    }
    return response;
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') {
      return baseWorker.scheduled(event, env, ctx);
    }
  }
};
