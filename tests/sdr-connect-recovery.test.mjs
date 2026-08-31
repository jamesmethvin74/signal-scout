import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const managerSource = fs.readFileSync(new URL('../sdr-connection-manager.js', import.meta.url), 'utf8');
const runtimeSource = fs.readFileSync(new URL('../sdr-receiver-runtime-v3.js', import.meta.url), 'utf8');

function storage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem:key => map.has(key) ? map.get(key) : null,
    setItem:(key,value) => map.set(key, String(value))
  };
}

function loadRuntimeWithLivePool(receivers) {
  const localStorage = storage({
    'freqbeacon:sdrLivePool:v3': JSON.stringify({ updatedAt:Date.now(), receivers })
  });
  const document = { getElementById:() => null };
  const window = {
    localStorage,
    location:{ origin:'https://freqbeacon.example', href:'https://freqbeacon.example/' },
    __freqbeaconReceiverHealth:{ state:() => ({ cooling:false, recentSuccess:false, failures:0 }) },
    setTimeout:() => 0,
    clearTimeout:() => {}
  };
  const context = vm.createContext({
    window, document, console, URL, AbortController,
    fetch:async () => { throw new Error('offline'); },
    Date, JSON, Math, Number, Object, Array, Set, String, Boolean, Promise
  });
  vm.runInContext(runtimeSource, context, { filename:'sdr-receiver-runtime-v3.js' });
  return window.__freqbeaconReceiverRuntime;
}

function managerHarness() {
  let timerId = 1;
  const timers = new Map();
  const setTimeout = (fn, ms) => {
    const id = timerId++;
    timers.set(id, { fn, ms, active:true });
    return id;
  };
  const clearTimeout = id => {
    const timer = timers.get(id);
    if (timer) timer.active = false;
  };
  const runDelay = ms => {
    let changed = true;
    while (changed) {
      changed = false;
      for (const timer of timers.values()) {
        if (timer.active && timer.ms === ms) {
          timer.active = false;
          timer.fn();
          changed = true;
        }
      }
    }
  };

  class FakeSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url) {
      this.url = url;
      this.readyState = FakeSocket.CONNECTING;
      this.onopen = this.onmessage = this.onerror = this.onclose = null;
    }
    close() { this.readyState = FakeSocket.CLOSED; }
    remoteClose(code=1006, reason='dead receiver') {
      this.readyState = FakeSocket.CLOSED;
      this.onclose?.({ code, reason });
    }
  }

  const sockets = [];
  const attempts = [];
  const window = {
    WebSocket:FakeSocket,
    setTimeout,
    clearTimeout,
    __freqbeaconReceiverHealth:{ markFailure:() => {}, markSuccess:() => {} }
  };
  const context = vm.createContext({
    window, console, TextDecoder, ArrayBuffer, Uint8Array,
    Array, Set, Object, String, Number, TypeError
  });
  vm.runInContext(managerSource, context, { filename:'sdr-connection-manager.js' });
  const Manager = window.FreqBeaconSdrConnectionManager;
  let manager;
  manager = new Manager({
    websocketFactory:url => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    urlForReceiver:receiver => `wss://freqbeacon.example/api/sdr/ws?receiver=${receiver.id}`,
    onAttempt:event => attempts.push({
      id:event.receiver.id,
      hasActiveSocket:Boolean(manager.activeSocket)
    })
  });
  return { manager, sockets, attempts, runDelay, Manager };
}

test('ranked live catalog always includes a deployment-bundled recovery receiver', () => {
  const runtime = loadRuntimeWithLivePool([
    {id:'live-a.example:8073',name:'Live A',location:'Conway',lat:35.09,lon:-92.44,minKHz:10,maxKHz:30000},
    {id:'live-b.example:8073',name:'Live B',location:'Little Rock',lat:34.75,lon:-92.29,minKHz:10,maxKHz:30000},
    {id:'live-c.example:8073',name:'Live C',location:'Russellville',lat:35.28,lon:-93.13,minKHz:10,maxKHz:30000},
    {id:'live-d.example:8073',name:'Live D',location:'Hot Springs',lat:34.50,lon:-93.05,minKHz:10,maxKHz:30000}
  ]);
  const result = runtime.recommend({ frequency:9455, userLat:35.0887, userLon:-92.4421, txLat:35.7, txLon:139.7, ham:false });
  assert.equal(result.receivers[0].bundledSeed, false);
  assert.ok(result.receivers.some(receiver => receiver.bundledSeed), 'no bundled recovery receiver was retained');
  assert.ok(result.receivers.some(receiver => receiver.role === 'RELIABLE FALLBACK'), 'bundled fallback role missing');
});

test('CONNECTING callback runs only after the active socket exists', () => {
  const h = managerHarness();
  h.manager.connect([{id:'live-a'}]);
  assert.equal(h.attempts.length, 1);
  assert.equal(h.attempts[0].hasActiveSocket, true);
  assert.equal(h.manager.activeSocket, h.sockets[0]);
});

test('first live receiver failure jumps directly to bundled fallback', () => {
  const h = managerHarness();
  h.manager.connect([
    {id:'live-a', bundledSeed:false},
    {id:'live-b', bundledSeed:false},
    {id:'seed-safe', bundledSeed:true},
    {id:'live-c', bundledSeed:false}
  ]);
  h.sockets[0].remoteClose();
  h.runDelay(100);
  assert.equal(h.attempts.length, 2);
  assert.equal(h.attempts[1].id, 'seed-safe');
});

test('connection timeouts are bounded for fast recovery', () => {
  const h = managerHarness();
  assert.equal(h.Manager.constants.CONNECT_TIMEOUT_MS, 3500);
  assert.equal(h.Manager.constants.FIRST_SND_TIMEOUT_MS, 4000);
  assert.equal(h.Manager.constants.MAX_AUTO_ATTEMPTS, 5);
});