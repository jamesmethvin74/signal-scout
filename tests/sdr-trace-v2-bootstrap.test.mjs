import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bootstrap = readFileSync(new URL('../sdr-trace-v2.html', import.meta.url), 'utf8');
const socketFix = readFileSync(new URL('../sdr-trace-socket-fix-v2.js', import.meta.url), 'utf8');

assert.match(bootstrap, /traceBootstrap=v2/);
assert.match(bootstrap, /sdr-early-trace\.js\?traceBootstrap=20260907c/);
assert.match(bootstrap, /sdr-trace-socket-fix-v2\.js\?traceBootstrap=20260907c/);
assert.doesNotMatch(bootstrap, /sdrTrace=1/);
assert.match(socketFix, /early-stream-timing-v2/);
assert.match(socketFix, /url\.host !== window\.location\.host/);
assert.match(socketFix, /\/api\/sdr\/ws/);
assert.match(socketFix, /window\.WebSocket = SocketTraceWebSocket/);

console.log('standalone SDR trace v2 bootstrap guard passed');
