import baseWorker from './worker-sdr-health-final.js';

const JSON_FAST_MARKER = 'receiver-json-fast-v1';

function patchReceiverRuntime(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;

  return response.text().then((source) => {
    const oldCode = "    return Promise.resolve(new Response(JSON.stringify({ receivers, source:livePool.receivers.length>=4?'receiver-runtime-live-cache':'receiver-runtime-seed', generatedAt:new Date().toISOString() }), { status:receivers.length?200:503, headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, max-age=0, no-store','x-freqbeacon-sdr-directory':VERSION} }));";
    const newCode = `    const payload = { receivers, source:livePool.receivers.length>=4?'receiver-runtime-live-cache':'receiver-runtime-seed', generatedAt:new Date().toISOString() };
    const status = receivers.length ? 200 : 503;
    const makeRuntimeResponse = () => {
      const runtimeResponse = new Response(null, { status, headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, max-age=0, no-store','x-freqbeacon-sdr-directory':VERSION,'x-freqbeacon-receiver-json':'${JSON_FAST_MARKER}'} });
      Object.defineProperty(runtimeResponse, 'json', { configurable:true, value:() => Promise.resolve(payload) });
      Object.defineProperty(runtimeResponse, 'clone', { configurable:true, value:makeRuntimeResponse });
      return runtimeResponse;
    };
    return Promise.resolve(makeRuntimeResponse());`;

    const patched = source.replace(oldCode, newCode);
    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/javascript; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-receiver-json', patched === source ? 'patch-miss' : JSON_FAST_MARKER);
    return new Response(patched, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  });
}

function patchRootHtml(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;

  return response.text().then((html) => {
    html = html.replace(/sdr-receiver-runtime-v3\.js\?v=\d+/g, 'sdr-receiver-runtime-v3.js?v=2');
    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-receiver-json', JSON_FAST_MARKER);
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await baseWorker.fetch(request, env, ctx);

    if (request.method === 'GET' && url.pathname === '/sdr-receiver-runtime-v3.js') {
      return patchReceiverRuntime(response);
    }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return patchRootHtml(response);
    }
    return response;
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') {
      return baseWorker.scheduled(event, env, ctx);
    }
  }
};
