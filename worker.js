import baseWorker from './worker-v2.js';

const SDR_ORIGIN_BRIDGE = `
<script>
(() => {
  if (window.__signalScoutWebSocketOriginBridgeInstalled) return;
  const PreviousWebSocket = window.WebSocket;
  if (!PreviousWebSocket) return;

  function normalizeSignalScoutSocketUrl(rawUrl) {
    try {
      const url = new URL(String(rawUrl), window.location.href);
      if (url.host !== window.location.host || url.pathname !== '/api/sdr/ws') return rawUrl;
      if (url.protocol === 'wss:') url.protocol = 'https:';
      else if (url.protocol === 'ws:') url.protocol = 'http:';
      return url.toString();
    } catch {
      return rawUrl;
    }
  }

  function SignalScoutOriginSafeWebSocket(url, protocols) {
    const normalizedUrl = normalizeSignalScoutSocketUrl(url);
    return protocols === undefined
      ? new PreviousWebSocket(normalizedUrl)
      : new PreviousWebSocket(normalizedUrl, protocols);
  }

  SignalScoutOriginSafeWebSocket.prototype = PreviousWebSocket.prototype;
  Object.defineProperties(SignalScoutOriginSafeWebSocket, {
    CONNECTING: { value: PreviousWebSocket.CONNECTING ?? 0 },
    OPEN: { value: PreviousWebSocket.OPEN ?? 1 },
    CLOSING: { value: PreviousWebSocket.CLOSING ?? 2 },
    CLOSED: { value: PreviousWebSocket.CLOSED ?? 3 }
  });

  window.WebSocket = SignalScoutOriginSafeWebSocket;
  window.__signalScoutWebSocketOriginBridgeInstalled = true;
})();
</script>`;

class SignalScoutHtmlInjector {
  element(element) {
    element.append(SDR_ORIGIN_BRIDGE, { html: true });
  }
}

export default {
  async fetch(request, env, ctx) {
    const response = await baseWorker.fetch(request, env, ctx);
    if (request.method !== 'GET') return response;

    const url = new URL(request.url);
    if (url.pathname !== '/' && url.pathname !== '/index.html') return response;
    if (!String(response.headers.get('content-type') || '').includes('text/html')) return response;

    const transformed = new HTMLRewriter()
      .on('body', new SignalScoutHtmlInjector())
      .transform(response);

    const headers = new Headers(transformed.headers);
    headers.set('cache-control', 'no-store, max-age=0');
    return new Response(transformed.body, {
      status: transformed.status,
      statusText: transformed.statusText,
      headers
    });
  }
};
