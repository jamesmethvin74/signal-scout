import baseWorker from './worker-sdr-diagnostic-control-v3.js';

const MARKER = 'freqbeacon-sdr-copy-report-v7';

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

  async function copyReport(box, button) {
    const text = reportText();

    // Android Chrome is much more reliable when the legacy copy operation is
    // attempted synchronously inside the original tap. Waiting on a rejected
    // Clipboard API promise can consume the user-activation window first.
    let copied = execCopy(text);

    if (!copied) {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          copied = true;
        }
      } catch {}
    }

    if (!copied) {
      try {
        if (navigator.clipboard?.write && window.ClipboardItem) {
          const item = new ClipboardItem({ 'text/plain': new Blob([text], { type:'text/plain' }) });
          await navigator.clipboard.write([item]);
          copied = true;
        }
      } catch {}
    }

    if (copied) {
      button.textContent = 'Copied — paste into ChatGPT';
      setStatus(box, 'SDR diagnostic copied to clipboard.');
      setTimeout(() => { button.textContent = 'Copy report'; }, 2200);
      return;
    }

    showSelectedReport(box, text);
    button.textContent = 'Copy blocked — report selected below';
    setStatus(box, 'Android blocked automatic copy. The report is selected below; long-press it and tap Copy.');
    setTimeout(() => { button.textContent = 'Copy report'; }, 2600);
  }

  function patchBox() {
    const box = document.querySelector('#sdrPlayer [data-sdr-diagnostic-control-v5]');
    if (!box) return false;

    box.querySelector('[data-sdr-diagnostic-share-v5]')?.remove();
    box.querySelector('[data-sdr-diagnostic-download-v5]')?.remove();

    const actions = box.querySelector('[data-sdr-diagnostic-actions-v5]');
    if (!actions) return false;

    let copy = box.querySelector('[data-sdr-diagnostic-copy-v7]');
    if (!copy) {
      box.querySelector('[data-sdr-diagnostic-copy-v6]')?.remove();
      copy = document.createElement('button');
      copy.type = 'button';
      copy.dataset.sdrDiagnosticCopyV7 = '1';
      copy.textContent = 'Copy report';
      copy.addEventListener('click', () => copyReport(box, copy));
      actions.prepend(copy);
    }
    return true;
  }

  let timer = null;
  const arm = () => {
    if (patchBox()) {
      if (timer) clearInterval(timer);
      timer = null;
      return;
    }
    if (!timer) {
      timer = setInterval(() => {
        if (patchBox()) {
          clearInterval(timer);
          timer = null;
        }
      }, 250);
    }
  };

  arm();
  window.addEventListener('pagehide', () => { if (timer) clearInterval(timer); }, { once:true });
  window.addEventListener('freqbeacon:snd-created', arm);
  window.addEventListener('freqbeacon:snd-ready', arm);
  window.addEventListener('freqbeacon:snd-audio', arm);
  window.addEventListener('freqbeacon:sdr-diagnostic-updated', arm);
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
