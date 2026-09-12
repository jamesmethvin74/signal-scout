// FREQBEACON Zero bench-only transport router.
// Keeps /zero pinned to its frozen receiver while sending only the qualification bench to /api/zero-bench.

const nativeFetch = window.fetch.bind(window);
const NativeWebSocket = window.WebSocket;

function rewriteBenchUrl(value) {
  return String(value)
    .replace('/api/zero/bootstrap', '/api/zero-bench/bootstrap')
    .replace('/api/zero/ws', '/api/zero-bench/ws');
}

window.fetch = function benchFetch(input, init) {
  if (typeof input === 'string') {
    return nativeFetch(rewriteBenchUrl(input), init);
  }

  if (input instanceof Request) {
    const rewritten = rewriteBenchUrl(input.url);
    if (rewritten !== input.url) {
      return nativeFetch(new Request(rewritten, input), init);
    }
  }

  return nativeFetch(input, init);
};

function BenchWebSocket(url, protocols) {
  const rewritten = rewriteBenchUrl(url);
  if (protocols === undefined) return new NativeWebSocket(rewritten);
  return new NativeWebSocket(rewritten, protocols);
}

BenchWebSocket.prototype = NativeWebSocket.prototype;
Object.setPrototypeOf(BenchWebSocket, NativeWebSocket);
window.WebSocket = BenchWebSocket;

await import('/freqbeacon-zero-bench.js?v=1');
