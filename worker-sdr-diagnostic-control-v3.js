import baseWorker from './worker-direct-inmemory-ranking.js';

const DIAG_SCRIPT = 'sdr-lifecycle-diagnostics-v2.js?v=4';
const CONTROL_MARKER = 'freqbeacon-sdr-diagnostic-control-v4';

function diagnosticBootstrap() {
  return `<script src="${DIAG_SCRIPT}"></script>
  <script>
    (() => {
      if (window.__freqbeaconSdrDiagnosticControlV4) return;
      window.__freqbeaconSdrDiagnosticControlV4 = true;

      const marker = '${CONTROL_MARKER}';

      function reportPayload() {
        try {
          if (window.__freqbeaconSdrLifecycleV2?.getReport) {
            return window.__freqbeaconSdrLifecycleV2.getReport();
          }
        } catch {}
        return {
          version: marker,
          capturedAt: new Date().toISOString(),
          error: 'Lifecycle recorder did not load.',
          loadedScripts: [...document.scripts].map((script) => script.src).filter(Boolean),
          player: {
            exists: Boolean(document.getElementById('sdrPlayer')),
            status: document.querySelector('#sdrPlayer [data-sdr-status]')?.textContent?.trim() || '',
            receiver: document.querySelector('#sdrPlayer [data-sdr-receiver-button-name]')?.textContent?.trim() || '',
            message: document.querySelector('#sdrPlayer [data-sdr-message]')?.textContent?.trim() || ''
          }
        };
      }

      function suppressLegacyControls(panel) {
        panel?.querySelectorAll('[data-sdr-lifecycle-v2],[data-sdr-lifecycle-box],[data-sdr-diagnostic-control-v3]').forEach((node) => node.remove());
      }

      function toggleReport(box) {
        const textarea = box.querySelector('[data-sdr-diagnostic-report-v4]');
        const button = box.querySelector('[data-sdr-diagnostic-show-v4]');
        const hint = box.querySelector('[data-sdr-diagnostic-hint-v4]');
        if (!textarea || !button) return;

        if (!textarea.hidden) {
          textarea.hidden = true;
          if (hint) hint.hidden = true;
          button.textContent = 'Show SDR diagnostic';
          return;
        }

        textarea.value = JSON.stringify(reportPayload(), null, 2);
        textarea.hidden = false;
        if (hint) hint.hidden = false;
        button.textContent = 'Hide SDR diagnostic';
        textarea.focus();
        try { textarea.setSelectionRange(0, textarea.value.length); } catch {}
        textarea.scrollTop = 0;
      }

      function attach() {
        const panel = document.getElementById('sdrPlayer');
        const message = panel?.querySelector('[data-sdr-message]');
        if (!panel || !message) return false;

        suppressLegacyControls(panel);

        let box = panel.querySelector('[data-sdr-diagnostic-control-v4]');
        if (!box) {
          if (!document.getElementById('freqbeacon-sdr-diagnostic-control-v4-style')) {
            const style = document.createElement('style');
            style.id = 'freqbeacon-sdr-diagnostic-control-v4-style';
            style.textContent = '[data-sdr-lifecycle-v2],[data-sdr-lifecycle-box],[data-sdr-diagnostic-control-v3]{display:none!important}[data-sdr-diagnostic-control-v4]{margin-top:10px;padding:10px;border:1px solid rgba(95,208,255,.42);border-radius:9px;background:rgba(5,18,31,.86)}[data-sdr-diagnostic-control-v4] button{display:block;width:100%;min-height:42px;border:1px solid rgba(95,208,255,.72);border-radius:7px;background:rgba(95,208,255,.14);color:#e2f8ff;font:850 12px/1 system-ui,-apple-system,sans-serif}[data-sdr-diagnostic-status-v4]{margin-bottom:8px;color:#9eb7c8;font:10px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}[data-sdr-diagnostic-report-v4]{box-sizing:border-box;width:100%;height:260px;margin-top:10px;padding:10px;border:1px solid rgba(95,208,255,.38);border-radius:7px;background:#06111d;color:#d8f5ff;font:10px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre;overflow:auto;resize:vertical}[data-sdr-diagnostic-hint-v4]{margin-top:7px;color:#9eb7c8;font:10px/1.4 system-ui,-apple-system,sans-serif}';
            document.head.appendChild(style);
          }

          box = document.createElement('div');
          box.dataset.sdrDiagnosticControlV4 = '1';
          box.innerHTML = '<div data-sdr-diagnostic-status-v4>Diagnostic control loaded · recorder checking…</div><button type="button" data-sdr-diagnostic-show-v4>Show SDR diagnostic</button><textarea readonly hidden spellcheck="false" data-sdr-diagnostic-report-v4 aria-label="SDR diagnostic report"></textarea><div hidden data-sdr-diagnostic-hint-v4>The full report is selected. Long-press the text and choose Copy if Android does not show Copy automatically.</div>';
          message.insertAdjacentElement('afterend', box);
          box.querySelector('[data-sdr-diagnostic-show-v4]').addEventListener('click', () => toggleReport(box));
        }

        const status = box.querySelector('[data-sdr-diagnostic-status-v4]');
        if (status) {
          let summary = 'Diagnostic control loaded';
          try {
            summary = window.__freqbeaconSdrLifecycleV2?.getReport?.().summary || summary;
          } catch {}
          status.textContent = summary;
        }
        box.hidden = false;
        return true;
      }

      attach();
      const timer = setInterval(attach, 250);
      window.addEventListener('pagehide', () => clearInterval(timer), { once:true });
      window.addEventListener('freqbeacon:snd-created', attach);
      window.addEventListener('freqbeacon:snd-ready', attach);
      window.addEventListener('freqbeacon:snd-audio', attach);
      window.addEventListener('click', () => setTimeout(attach, 0), true);
    })();
  </script>`;
}

function patchRoot(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;

  return response.text().then((html) => {
    html = html.replace(/sdr-receiver-ui\.js\?v=\d+/g, 'sdr-receiver-ui.js?v=5');

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
    ? new Response(response.body, { status:response.status, statusText:response.statusText, headers })
    : new Response(null, { status:response.status, statusText:response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await baseWorker.fetch(request, env, ctx);

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return patchRoot(response);
    }
    if (request.method === 'GET' && (url.pathname === '/sdr-lifecycle-diagnostics-v2.js' || url.pathname === '/sdr-receiver-ui.js')) {
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
