import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../sdr-connection-manager.js', import.meta.url), 'utf8');

function harness() {
  class FakeSocket {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url) { this.url = url; this.readyState = 0; this.listeners = new Map(); }
    addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(fn); }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    emit(type, event = {}) { for (const fn of this.listeners.get(type) || []) fn(event); }
    close() { this.readyState = 3; }
  }
  const timers = [];
  const window = {
    WebSocket:FakeSocket,
    setTimeout:(fn, ms) => { timers.push({ fn, ms, active:true }); return timers.length; },
    clearTimeout:id => { if (timers[id - 1]) timers[id - 1].active = false; },
    __freqbeaconReceiverHealth:{ markFailure() {}, markSuccess() {} }
  };
  const context = vm.createContext({ window, TextDecoder, ArrayBuffer, Uint8Array, Set, Object, String, Number, TypeError, Date, console });
  vm.runInContext(source, context);
  const Manager = window.FreqBeaconSdrConnectionManager;
  const attempts = [];
  const sockets = [];
  const manager = new Manager({
    websocketFactory:url => { const s = new FakeSocket(url); sockets.push(s); return s; },
    urlForReceiver:r => `wss://freqbeacon.test/api/sdr/ws?receiver=${r.id}`,
    onAttempt:e => attempts.push({ id:e.receiver.id, upstreamId:e.upstreamId })
  });
  const run = ms => { for (const t of timers) if (t.active && t.ms === ms) { t.active = false; t.fn(); } };
  return { Manager, manager, attempts, sockets, run };
}

test('automatic listening is bounded under ten seconds', () => {
  const { Manager } = harness();
  assert.equal(Manager.version, 'fast-path-v6-ranked-failover');
  assert.equal(Manager.constants.TOTAL_CONNECT_BUDGET_MS, 9500);
  assert.equal(Manager.constants.CONNECT_TIMEOUT_MS, 4000);
  assert.equal(Manager.constants.FIRST_SND_TIMEOUT_MS, 2500);
  assert.equal(Manager.constants.MAX_AUTO_ATTEMPTS, 3);
});

test('Tipton keeps display id but uses raw transport endpoint', () => {
  const h = harness();
  h.manager.connect([{ id:'km4rt.ddns.net:8073', name:'KM4RT', location:'Tipton County, Tennessee' }]);
  assert.deepEqual(h.attempts[0], { id:'km4rt.ddns.net:8073', upstreamId:'64.22.14.214:8073' });
  assert.match(h.sockets[0].url, /64\.22\.14\.214:8073/);
});

test('failover follows ranked order instead of jumping to an arbitrary bundled seed', () => {
  const h = harness();
  h.manager.connect([
    { id:'rank-1', name:'One', location:'A', bundledSeed:true },
    { id:'rank-2', name:'Two', location:'B', bundledSeed:false },
    { id:'rank-3', name:'Three', location:'C', bundledSeed:true }
  ]);
  h.sockets[0].emit('close', { code:1006, reason:'failed' });
  h.run(75);
  assert.equal(h.attempts[1].id, 'rank-2');
});
