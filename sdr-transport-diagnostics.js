(() => {
  if (window.__freqbeaconSdrTransportDiagnosticsV1) return;
  window.__freqbeaconSdrTransportDiagnosticsV1 = true;

  let sequence = 0;
  let lastStatus = '';
  let lastReport = null;

  function currentStatus() {
    return String(document.querySelector('[data-sdr-status]')?.textContent || '').trim().toLowerCase();
  }

  async function probe(receiverId) {
    const startedAt = performance.now();
    try {
      const response = await fetch(`/api/sdr/probe?receiver=${encodeURIComponent(receiverId)}`, {
        headers:{ Accept:'application/json' },
        cache:'no-store'
      });
      const payload = await response.json();
      return {
        receiverId,
        ok:Boolean(payload?.ok),
        resolvedHost:payload?.resolvedHost || '',
        elapsedMs:Number(payload?.elapsedMs ?? Math.round(performance.now() - startedAt)),
        stage:payload?.stage || '',
        status:Number(payload?.status || response.status || 0),
        error:payload?.error || ''
      };
    } catch (error) {
      return {
        receiverId,
        ok:false,
        resolvedHost:'',
        elapsedMs:Math.round(performance.now() - startedAt),
        stage:'client-probe',
        status:0,
        error:error?.message || String(error)
      };
    }
  }

  function label(result) {
    const id = String(result.receiverId || 'receiver');
    const name = /km4rt|64\.22\.14\.214/i.test(id) ? 'Tipton' : id.replace(/:\d+$/, '');
    if (result.ok) return `${name} upstream WS OK ${Math.round(result.elapsedMs)} ms`;
    const detail = result.error ? ` · ${result.error}` : (result.status ? ` · HTTP ${result.status}` : '');
    return `${name} upstream WS FAIL ${Math.round(result.elapsedMs)} ms${detail}`;
  }

  async function run() {
    const token = ++sequence;
    const state = window.__freqbeaconSdrPlayer?.getState?.() || {};
    const ids = ['km4rt.ddns.net:8073'];
    if (state.receiverId && !ids.includes(state.receiverId)) ids.push(state.receiverId);

    const message = document.querySelector('[data-sdr-message]');
    if (!message) return;
    const base = message.textContent || 'No ranked receiver answered.';
    message.textContent = `${base} Checking Cloudflare → Kiwi transport…`;

    const results = await Promise.all(ids.slice(0, 2).map(probe));
    if (token !== sequence || currentStatus() !== 'unavailable') return;

    lastReport = {
      at:new Date().toISOString(),
      frequency:state.frequency ?? null,
      currentReceiverId:state.receiverId || '',
      results
    };
    message.textContent = `${base} Transport: ${results.map(label).join(' · ')}`;
  }

  function inspectStatus() {
    const status = currentStatus();
    if (status === lastStatus) return;
    lastStatus = status;
    if (status === 'unavailable') run();
    else sequence += 1;
  }

  const observer = new MutationObserver(inspectStatus);
  observer.observe(document.documentElement, { childList:true, subtree:true, characterData:true });
  inspectStatus();

  window.__freqbeaconSdrTransportDiagnostics = Object.freeze({
    run,
    get lastReport() { return lastReport; }
  });
})();
