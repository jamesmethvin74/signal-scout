(() => {
  const KEY = 'freqbeacon:sdr-forensics:v4';
  const MAX = 900;
  const startedAt = performance.now();
  const nativeFetch = window.fetch.bind(window);
  const nativeJson = Response.prototype.json;
  const NativeWebSocket = window.WebSocket;
  const inflight = new Map();
  let fetchSeq = 0;

  function clean(value) {
    if (value == null) return value;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    try { return JSON.parse(JSON.stringify(value)); } catch { return String(value); }
  }

  function read() {
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch { return []; }
  }

  function trace(event, detail = {}) {
    const entry = {
      t: new Date().toISOString(),
      p: Math.round(performance.now()),
      event,
      readyState: document.readyState,
      visibility: document.visibilityState,
      detail: clean(detail)
    };
    try {
      const entries = read();
      entries.push(entry);
      localStorage.setItem(KEY, JSON.stringify(entries.slice(-MAX)));
    } catch {}
    try { console.info('[FREQBEACON FORENSICS V4]', event, detail); } catch {}
    return entry;
  }

  window.__freqbeaconForensics = trace;
  window.__freqbeaconForensicsKey = KEY;
  trace('v4-loaded', { href: location.href, userAgent: navigator.userAgent, standalone: matchMedia('(display-mode: standalone)').matches });

  function describe(el) {
    if (!el) return null;
    return {
      tag: el.tagName || '', id: el.id || '', className: String(el.className || ''),
      type: el.getAttribute?.('type') || '', href: el.getAttribute?.('href') || '',
      text: el.textContent?.trim().replace(/\s+/g, ' ').slice(0, 180) || ''
    };
  }

  function cardFrequency(card) {
    const freqEl = card?.querySelector('.frequency');
    if (!freqEl) return null;
    const unit = freqEl.querySelector('span')?.textContent?.trim().toLowerCase() || '';
    const clone = freqEl.cloneNode(true); clone.querySelector('span')?.remove();
    const n = Number(clone.textContent.replace(/,/g, '').trim());
    if (!Number.isFinite(n)) return null;
    return unit.includes('mhz') ? n * 1000 : n;
  }

  function chooserState() {
    const chooser = document.querySelector('.sdr-chooser');
    const choices = chooser ? [...chooser.querySelectorAll('.sdr-choice')] : [];
    return { exists: !!chooser, hidden: chooser ? !!chooser.hidden : null, count: choices.length,
      names: choices.slice(0, 8).map(x => x.querySelector('.sdr-choice-name')?.textContent?.trim() || '') };
  }

  function playerState() {
    const panel = document.getElementById('sdrPlayer');
    return {
      exists: !!panel, hidden: panel ? !!panel.hidden : null,
      status: panel?.querySelector('[data-sdr-status]')?.textContent?.trim() || '',
      station: panel?.querySelector('[data-sdr-station]')?.textContent?.trim() || '',
      frequency: panel?.querySelector('[data-sdr-frequency]')?.textContent?.trim() || '',
      receiver: panel?.querySelector('[data-sdr-receiver-button-name]')?.textContent?.trim() || '',
      message: panel?.querySelector('[data-sdr-message]')?.textContent?.trim() || ''
    };
  }

  function pageSnapshot(label) {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource') || [];
    const longest = [...resources].sort((a,b) => b.duration - a.duration).slice(0, 12).map(r => ({
      name: String(r.name).replace(location.origin, ''), type: r.initiatorType, duration: Math.round(r.duration),
      responseEnd: Math.round(r.responseEnd || 0), transferSize: Number(r.transferSize || 0)
    }));
    const incompleteImages = [...document.images].filter(img => !img.complete).slice(0, 12).map(img => img.currentSrc || img.src || '');
    const unloadedStyles = [...document.querySelectorAll('link[rel="stylesheet"]')].filter(link => {
      try { return !link.sheet; } catch { return true; }
    }).slice(0, 12).map(link => link.href);
    trace('page-snapshot', {
      label,
      elapsed: Math.round(performance.now() - startedAt),
      readyState: document.readyState,
      nav: nav ? {
        responseEnd: Math.round(nav.responseEnd || 0), domContentLoaded: Math.round(nav.domContentLoadedEventEnd || 0),
        loadEventStart: Math.round(nav.loadEventStart || 0), loadEventEnd: Math.round(nav.loadEventEnd || 0),
        duration: Math.round(nav.duration || 0), transferSize: Number(nav.transferSize || 0)
      } : null,
      inflightFetches: [...inflight.values()].map(x => ({ url: x.url, ms: Math.round(performance.now() - x.started) })).slice(0, 20),
      incompleteImages, unloadedStyles, longest,
      chooser: chooserState(), player: playerState(),
      healthFetchRestored: window.__freqbeaconHealthFetchRestored === true,
      receiverRuntime: window.__freqbeaconReceiverRuntime?.version || ''
    });
  }

  window.addEventListener('error', e => trace('window-error', { message: e.message, filename: e.filename, lineno: e.lineno, colno: e.colno }));
  window.addEventListener('unhandledrejection', e => trace('unhandled-rejection', { name: e.reason?.name || '', message: e.reason?.message || String(e.reason) }));
  window.addEventListener('beforeunload', () => trace('beforeunload'));
  window.addEventListener('pagehide', e => trace('pagehide', { persisted: e.persisted }));
  window.addEventListener('pageshow', e => trace('pageshow', { persisted: e.persisted }));
  document.addEventListener('visibilitychange', () => trace('visibilitychange', { state: document.visibilityState }));
  document.addEventListener('DOMContentLoaded', () => { trace('dom-content-loaded'); pageSnapshot('DOMContentLoaded'); });
  window.addEventListener('load', () => { trace('window-load'); pageSnapshot('load'); });

  const nativePush = history.pushState.bind(history), nativeReplace = history.replaceState.bind(history);
  history.pushState = (...args) => { trace('history-push', { url: args[2] || '' }); return nativePush(...args); };
  history.replaceState = (...args) => { trace('history-replace', { url: args[2] || '' }); return nativeReplace(...args); };

  window.addEventListener('click', event => {
    const target = event.target?.closest?.('.card-receiver-options,.listen-live-button,#lookupReceiverButton,[data-sdr-receiver-button],[data-sdr-choice-index],[data-sdr-toggle]');
    if (!target) return;
    const card = target.closest?.('.signal-card,.lookup-result');
    trace('click-capture-early', { trusted: event.isTrusted, defaultPrevented: event.defaultPrevented, target: describe(target), cardFrequency: cardFrequency(card), chooser: chooserState(), player: playerState() });
    queueMicrotask(() => trace('click-after-microtask', { target: describe(target), defaultPrevented: event.defaultPrevented, chooser: chooserState(), player: playerState() }));
    setTimeout(() => trace('click-after-50ms', { target: describe(target), defaultPrevented: event.defaultPrevented, chooser: chooserState(), player: playerState() }), 50);
  }, true);

  try {
    const nativeClick = HTMLElement.prototype.click;
    HTMLElement.prototype.click = function(...args) {
      if (this.matches?.('.card-receiver-options,.listen-live-button,#lookupReceiverButton,[data-sdr-receiver-button],[data-sdr-choice-index],[data-sdr-toggle]')) {
        trace('programmatic-click', { target: describe(this), chooser: chooserState(), player: playerState() });
      }
      return nativeClick.apply(this, args);
    };
  } catch (error) { trace('click-wrapper-failed', { message: error.message }); }

  window.fetch = function(input, init) {
    let url = '';
    try { url = new URL(typeof input === 'string' ? input : input?.url || String(input), location.href).toString(); } catch { url = String(input || ''); }
    const id = ++fetchSeq, started = performance.now();
    inflight.set(id, { id, url, started });
    if (url.includes('/api/sdr/') || url.includes('/api/program-guide')) trace('fetch-start', { id, url: url.replace(location.origin,''), aborted: !!init?.signal?.aborted });
    return nativeFetch(input, init).then(response => {
      inflight.delete(id);
      if (url.includes('/api/sdr/') || performance.now() - started > 750) trace('fetch-response', {
        id, url: url.replace(location.origin,''), status: response.status, ms: Math.round(performance.now()-started),
        directory: response.headers.get('x-freqbeacon-sdr-directory') || '', live: response.headers.get('x-freqbeacon-sdr-live-refresh') || ''
      });
      return response;
    }, error => {
      inflight.delete(id); trace('fetch-error', { id, url: url.replace(location.origin,''), ms: Math.round(performance.now()-started), name: error?.name || '', message: error?.message || String(error) });
      throw error;
    });
  };

  Response.prototype.json = function(...args) {
    const directory = this.headers?.get?.('x-freqbeacon-sdr-directory') || '';
    const live = this.headers?.get?.('x-freqbeacon-sdr-live-refresh') || '';
    const relevant = !!directory || !!live;
    const t = performance.now();
    if (relevant) trace('response-json-start', { directory, live, bodyUsed: this.bodyUsed });
    const promise = nativeJson.apply(this, args);
    if (!relevant) return promise;
    return promise.then(value => {
      trace('response-json-end', { directory, live, ms: Math.round(performance.now()-t), receiverCount: Array.isArray(value?.receivers) ? value.receivers.length : 0, source: value?.source || '' });
      return value;
    }, error => {
      trace('response-json-error', { directory, live, ms: Math.round(performance.now()-t), name: error?.name || '', message: error?.message || String(error) });
      throw error;
    });
  };

  function TracedWebSocket(url, protocols) {
    let parsed = null; try { parsed = new URL(String(url), location.href); } catch {}
    const relevant = parsed?.origin === location.origin && parsed?.pathname === '/api/sdr/ws';
    const t = performance.now();
    if (relevant) trace('ws-create', { receiver: parsed.searchParams.get('receiver') || '', stream: parsed.searchParams.get('stream') || '', url: parsed.pathname + parsed.search });
    const socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
    if (!relevant) return socket;
    let first = false, firstSnd = false;
    socket.addEventListener('open', () => trace('ws-open', { ms: Math.round(performance.now()-t), readyState: socket.readyState }));
    socket.addEventListener('error', () => trace('ws-error', { ms: Math.round(performance.now()-t), readyState: socket.readyState }));
    socket.addEventListener('close', e => trace('ws-close', { ms: Math.round(performance.now()-t), code: e.code, reason: e.reason || '', clean: e.wasClean }));
    socket.addEventListener('message', e => {
      let tag = '', size = 0;
      if (e.data instanceof ArrayBuffer) { const b = new Uint8Array(e.data); size = b.byteLength; if (b.length >= 3) tag = String.fromCharCode(b[0],b[1],b[2]); }
      else if (e.data instanceof Blob) { tag = 'BLOB'; size = e.data.size; }
      else if (typeof e.data === 'string') { tag = e.data.slice(0,3); size = e.data.length; }
      if (!first) { first = true; trace('ws-first-message', { tag, size, ms: Math.round(performance.now()-t) }); }
      if (!firstSnd && tag === 'SND') { firstSnd = true; trace('ws-first-snd', { size, ms: Math.round(performance.now()-t) }); }
    });
    return socket;
  }
  TracedWebSocket.prototype = NativeWebSocket.prototype;
  try { Object.defineProperties(TracedWebSocket, { CONNECTING:{value:NativeWebSocket.CONNECTING}, OPEN:{value:NativeWebSocket.OPEN}, CLOSING:{value:NativeWebSocket.CLOSING}, CLOSED:{value:NativeWebSocket.CLOSED} }); window.WebSocket = TracedWebSocket; }
  catch (error) { trace('ws-wrapper-failed', { message: error.message }); }

  try {
    const NativeAC = window.AudioContext || window.webkitAudioContext;
    if (NativeAC) {
      function TracedAudioContext(...args) {
        trace('audio-context-create', { args: args.length });
        const ctx = new NativeAC(...args);
        const resume = ctx.resume?.bind(ctx), close = ctx.close?.bind(ctx);
        if (resume) ctx.resume = async (...a) => { const t=performance.now(); trace('audio-resume-start',{state:ctx.state}); try { const v=await resume(...a); trace('audio-resume-end',{state:ctx.state,ms:Math.round(performance.now()-t)}); return v; } catch(e){trace('audio-resume-error',{message:e.message});throw e;} };
        if (close) ctx.close = async (...a) => { trace('audio-close-start',{state:ctx.state}); const v=await close(...a); trace('audio-close-end',{state:ctx.state}); return v; };
        trace('audio-context-created', { state: ctx.state, sampleRate: ctx.sampleRate });
        return ctx;
      }
      TracedAudioContext.prototype = NativeAC.prototype;
      window.AudioContext = TracedAudioContext;
      if (window.webkitAudioContext === NativeAC) window.webkitAudioContext = TracedAudioContext;
    }
  } catch (error) { trace('audio-wrapper-failed', { message: error.message }); }

  try {
    const observer = new PerformanceObserver(list => {
      for (const r of list.getEntries()) {
        if (r.duration >= 750 || String(r.name).includes('/api/sdr/')) trace('resource-complete', {
          name: String(r.name).replace(location.origin,''), type: r.initiatorType, duration: Math.round(r.duration), responseEnd: Math.round(r.responseEnd||0), transferSize: Number(r.transferSize||0)
        });
      }
    });
    observer.observe({ type: 'resource', buffered: true });
  } catch (error) { trace('resource-observer-failed', { message: error.message }); }

  function watchDom() {
    const panel = document.getElementById('sdrPlayer'), chooser = document.querySelector('.sdr-chooser');
    let lastPlayer = '', lastChooser = '';
    const sample = () => {
      const ps = playerState(), cs = chooserState();
      const p = JSON.stringify(ps), c = JSON.stringify(cs);
      if (p !== lastPlayer) { lastPlayer = p; trace('player-state', ps); }
      if (c !== lastChooser) { lastChooser = c; trace('chooser-state', cs); }
    };
    if (panel) new MutationObserver(sample).observe(panel,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','class']});
    if (chooser) new MutationObserver(sample).observe(chooser,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','class']});
    sample();

    if (!document.querySelector('[data-sdr-v4-report]')) {
      const a=document.createElement('a'); a.href='/sdr-forensics-v4.html?v=1'; a.dataset.sdrV4Report='1'; a.textContent='View SDR forensic report';
      a.style.cssText='position:fixed;top:8px;right:8px;z-index:2147483647;padding:9px 11px;border:1px solid #55c9f3;border-radius:9px;background:#0c3550;color:white;font:800 12px system-ui;text-decoration:none';
      document.body.appendChild(a);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchDom, {once:true}); else watchDom();

  [1000,3000,6000,10000,15000,25000].forEach(ms => setTimeout(() => pageSnapshot(`${ms}ms`), ms));
})();
