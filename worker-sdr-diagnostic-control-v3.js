import baseWorker from './worker-direct-inmemory-ranking.js';

const DIAG_SCRIPT = 'sdr-lifecycle-diagnostics-v2.js?v=3';
const CONTROL_MARKER = 'freqbeacon-sdr-diagnostic-control-v3';

function diagnosticBootstrap() {
  return `<script src="${DIAG_SCRIPT}"></script>
  <script>
    (() => {
      if (window.__freqbeaconSdrDiagnosticControlV3) return;
      window.__freqbeaconSdrDiagnosticControlV3 = true;

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

      async function copyReport(button) {
        const payload = JSON.stringify(reportPayload(), null, 2);
        let copied = false;
        try {
          await navigator.clipboard.writeText(payload);
          copied = true;
        } catch {}
        if (!copied) {
          try {
            const textarea = document.createElement('textarea');
            textarea.value = payload;
            textarea.style.cssText = 'position:fixed;left:-9999px;top:0';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            copied = document.execCommand('copy');
            textarea.remove();
          } catch {}
        }
        button.textContent = copied ? 'Copied SDR diagnostic' : 'Copy failed — tap again';
        setTimeout(() => { button.textContent = 'Copy SDR diagnostic'; }, 1400);
      }

      function attach() {
        const panel = document.getElementById('sdrPlayer');
        const message = panel?.querySelector('[data-sdr-message]');
        if (!panel || !message) return false;

        let box = panel.querySelector('[data-sdr-diagnostic-control-v3]');
        if (!box) {
          if (!document.getElementById('freqbeacon-sdr-diagnostic-control-v3-style')) {
            const style = document.createElement('style');
            style.id = 'freqbeacon-sdr-diagnostic-control-v3-style';
            style.textContent = '[data-sdr-diagnostic-control-v3]{margin-top:10px;padding:10px;border:1px solid rgba(95,208,255,.42);border-radius:9px;background:rgba(5,18,31,.86)}[data-sdr-diagnostic-control-v3] button{display:block;width:100%;min-height:42px;border:1px solid rgba(95,208,255,.72);border-radius:7px;background:rgba(95,208,255,.14);color:#e2f8ff;font:850 12px/1 system-ui,-apple-system,sans-serif}[data-sdr-diagnostic-control-v3-status]{margin-bottom:8px;color:#9eb7c8;font:10px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}';
            document.head.appendChild(style);
          }
          box = document.createElement('div');
          box.dataset.sdrDiagnosticControlV3 = '1';
          box.innerHTML = '<div data-sdr-diagnostic-control-v3-status>Diagnostic control loaded · recorder checking…</div><button type="button">Copy SDR diagnostic</button>';
          message.insertAdjacentElement('afterend', box);
          box.querySelector('button').addEventListener('click', (event) => copyReport(event.currentTarget));
        }

        const status = box.querySelector('[data-sdr-diagnostic-control-v3-status]');
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
      const timer = setInterval(() => {
        attach();
      }, 500);
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
    html = html.replace(/sdr-receiver-ui\.js\?v=\d+/g, 'sdr-receiver-ui.js?v=4');

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
