import baseWorker from './worker-direct-inmemory-ranking.js';

const DIAG_SCRIPT = 'sdr-lifecycle-diagnostics-v3.js?v=1';
const CONTROL_MARKER = 'freqbeacon-sdr-diagnostic-control-v5';

function diagnosticBootstrap() {
  return `<script src="${DIAG_SCRIPT}"></script>
  <script>
    (() => {
      if (window.__freqbeaconSdrDiagnosticControlV5) return;
      window.__freqbeaconSdrDiagnosticControlV5 = true;

      function reportPayload() {
        try {
          if (window.__freqbeaconSdrLifecycleV3?.getReport) {
            return window.__freqbeaconSdrLifecycleV3.getReport();
          }
        } catch {}
        return {
          version: '${CONTROL_MARKER}',
          capturedAt: new Date().toISOString(),
          error: 'Event-driven lifecycle recorder did not load.',
          loadedScripts: [...document.scripts].map((script) => script.src).filter(Boolean),
          player: {
            exists: Boolean(document.getElementById('sdrPlayer')),
            status: document.querySelector('#sdrPlayer [data-sdr-status]')?.textContent?.trim() || '',
            receiver: document.querySelector('#sdrPlayer [data-sdr-receiver-button-name]')?.textContent?.trim() || '',
            message: document.querySelector('#sdrPlayer [data-sdr-message]')?.textContent?.trim() || ''
          }
        };
      }

      function payloadText() {
        return JSON.stringify(reportPayload(), null, 2);
      }

      function suppressLegacy(panel) {
        panel?.querySelectorAll('[data-sdr-lifecycle-v2],[data-sdr-lifecycle-box],[data-sdr-diagnostic-control-v3],[data-sdr-diagnostic-control-v4]').forEach((node) => node.remove());
      }

      function setStatus(box, text) {
        const status = box?.querySelector('[data-sdr-diagnostic-status-v5]');
        if (status) status.textContent = text;
      }

      async function shareReport(box) {
        const text = payloadText();
        try {
          if (!navigator.share) throw new Error('Web Share unavailable');
          const file = new File([text], 'freqbeacon-sdr-diagnostic.json', { type: 'application/json' });
          if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({
              title: 'FREQBEACON SDR diagnostic',
              text: 'FREQBEACON SDR diagnostic report',
              files: [file]
            });
          } else {
            await navigator.share({ title: 'FREQBEACON SDR diagnostic', text });
          }
          setStatus(box, 'Report shared.');
        } catch (error) {
          setStatus(box, 'Share unavailable. Use Download JSON or Show report.');
        }
      }

      function downloadReport(box) {
        try {
          const text = payloadText();
          const blob = new Blob([text], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const anchor = document.createElement('a');
          anchor.href = url;
          anchor.download = 'freqbeacon-sdr-diagnostic.json';
          anchor.rel = 'noopener';
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
          setStatus(box, 'JSON report downloaded. Attach that file in ChatGPT.');
        } catch {
          setStatus(box, 'Download failed. Use Show report.');
        }
      }

      function toggleReport(box) {
        const textarea = box.querySelector('[data-sdr-diagnostic-report-v5]');
        const button = box.querySelector('[data-sdr-diagnostic-show-v5]');
        if (!textarea || !button) return;

        if (!textarea.hidden) {
          textarea.hidden = true;
          button.textContent = 'Show report';
          return;
        }

        textarea.value = payloadText();
        textarea.hidden = false;
        button.textContent = 'Hide report';
        textarea.scrollTop = 0;
      }

      function attach() {
        const panel = document.getElementById('sdrPlayer');
        const message = panel?.querySelector('[data-sdr-message]');
        if (!panel || !message) return false;

        suppressLegacy(panel);

        let box = panel.querySelector('[data-sdr-diagnostic-control-v5]');
        if (!box) {
          if (!document.getElementById('freqbeacon-sdr-diagnostic-control-v5-style')) {
            const style = document.createElement('style');
            style.id = 'freqbeacon-sdr-diagnostic-control-v5-style';
            style.textContent = '[data-sdr-lifecycle-v2],[data-sdr-lifecycle-box],[data-sdr-diagnostic-control-v3],[data-sdr-diagnostic-control-v4]{display:none!important}[data-sdr-diagnostic-control-v5]{margin-top:10px;padding:10px;border:1px solid rgba(95,208,255,.42);border-radius:9px;background:rgba(5,18,31,.86)}[data-sdr-diagnostic-status-v5]{margin-bottom:8px;color:#9eb7c8;font:10px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}[data-sdr-diagnostic-actions-v5]{display:grid;grid-template-columns:1fr;gap:7px}[data-sdr-diagnostic-control-v5] button{display:block;width:100%;min-height:42px;border:1px solid rgba(95,208,255,.72);border-radius:7px;background:rgba(95,208,255,.14);color:#e2f8ff;font:850 12px/1 system-ui,-apple-system,sans-serif}[data-sdr-diagnostic-report-v5]{box-sizing:border-box;width:100%;height:260px;margin-top:10px;padding:10px;border:1px solid rgba(95,208,255,.38);border-radius:7px;background:#06111d;color:#d8f5ff;font:10px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre;overflow:auto;resize:vertical}';
            document.head.appendChild(style);
          }

          box = document.createElement('div');
          box.dataset.sdrDiagnosticControlV5 = '1';
          box.innerHTML = '<div data-sdr-diagnostic-status-v5>Diagnostic armed · waiting for snd-created…</div><div data-sdr-diagnostic-actions-v5><button type="button" data-sdr-diagnostic-share-v5>Share report</button><button type="button" data-sdr-diagnostic-download-v5>Download JSON</button><button type="button" data-sdr-diagnostic-show-v5>Show report</button></div><textarea readonly hidden spellcheck="false" data-sdr-diagnostic-report-v5 aria-label="SDR diagnostic report"></textarea>';
          message.insertAdjacentElement('afterend', box);
          box.querySelector('[data-sdr-diagnostic-share-v5]').addEventListener('click', () => shareReport(box));
          box.querySelector('[data-sdr-diagnostic-download-v5]').addEventListener('click', () => downloadReport(box));
          box.querySelector('[data-sdr-diagnostic-show-v5]').addEventListener('click', () => toggleReport(box));
        }

        let summary = 'Diagnostic armed · waiting for snd-created…';
        try {
          summary = window.__freqbeaconSdrLifecycleV3?.getReport?.().summary || summary;
        } catch {}
        setStatus(box, summary);
        box.hidden = false;
        return true;
      }

      attach();
      const timer = setInterval(attach, 250);
      window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
      window.addEventListener('freqbeacon:snd-created', attach);
      window.addEventListener('freqbeacon:snd-ready', attach);
      window.addEventListener('freqbeacon:snd-audio', attach);
      window.addEventListener('freqbeacon:sdr-diagnostic-updated', attach);
      window.addEventListener('click', () => setTimeout(attach, 0), true);
    })();
  </script>`;
}

function patchRoot(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;

  return response.text().then((html) => {
    html = html.replace(/sdr-receiver-ui\.js\?v=\d+/g, 'sdr-receiver-ui.js?v=6');

    if (!html.includes(CONTROL_MARKER)) {
      const anchor = '<script src="sdr-live-reliability.js?v=1"></script>';
      const bootstrap = diagnosticBootstrap();
      html = html.includes(anchor)
        ? html.replace(anchor, `${bootstrap}\n  ${anchor}`)
        : html.replace('</body>', `${bootstrap}\n</body>`);
    }

    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-sdr-diagnostic-control', CONTROL_MARKER);
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  });
}

function noStore(response) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set('x-freqbeacon-sdr-diagnostic-control', CONTROL_MARKER);
  return response.body
    ? new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    : new Response(null, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await baseWorker.fetch(request, env, ctx);

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return patchRoot(response);
    }
    if (request.method === 'GET' && (
      url.pathname === '/sdr-lifecycle-diagnostics-v3.js'
      || url.pathname === '/sdr-receiver-ui.js'
    )) {
      return noStore(response);
    }
    return response;
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') {
      return baseWorker.scheduled(event, env, ctx);
    }
  }
};
