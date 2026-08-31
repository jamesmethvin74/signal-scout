import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../sdr-connection-manager.js', import.meta.url), 'utf8');

function harness({ startsOpen = false } = {}) {
  let timerId = 1;
  const timers = new Map();
  const setTimeout = (fn, ms) => {
    const id = timerId++;
    timers.set(id, { fn, ms, active:true });
    return id;
  };
  const clearTimeout = (id) => {
    const timer = timers.get(id);
    if (timer) timer.active = false;
  };
  const runDelay = (ms) => {
    for (const timer of [...timers.values()]) {
      if (timer.active && timer.ms === ms) {
        timer.active = false;
        timer.fn();
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
      this.readyState = startsOpen ? FakeSocket.OPEN : FakeSocket.CONNECTING;
      this.listeners = new Map();
      this.binaryType = '';
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    }
    removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
    dispatch(type, event = {}) {
      for (const fn of [...(this.listeners.get(type) || [])]) fn(event);
    }
    open({ emit = true } = {}) {
      this.readyState = FakeSocket.OPEN;
      if (emit) this.dispatch('open');
    }
    close() { this.readyState = FakeSocket.CLOSED; }
  }

  const sockets = [];
  const opens = [];
  const window = {
    WebSocket:FakeSocket,
    setTimeout,
    clearTimeout,
    __freqbeaconReceiverHealth:{ markFailure:() => {}, markSuccess:() => {} }
  };
  const context = vm.createContext({
    window, console, TextDecoder, ArrayBuffer, Uint8Array,
    Array, Set, Object, String, Number, TypeError, Date
  });
  vm.runInContext(source, context, { filename:'sdr-connection-manager.js' });
  const Manager = window.FreqBeaconSdrConnectionManager;
  const manager = new Manager({
    websocketFactory:url => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    urlForReceiver:receiver => `wss://freqbeacon.example/api/sdr/ws?receiver=${receiver.id}`,
    onOpen:event => opens.push(event.receiver.id)
  });
  return { manager, sockets, opens, runDelay, Manager };
}

test('already-open wrapped socket is reconciled even if open event was missed', () => {
  const h = harness({ startsOpen:true });
  h.manager.connect([{ id:'km4rt.ddns.net:8073', name:'KM4RT', location:'Tipton County, Tennessee' }]);
  assert.deepEqual(h.opens, ['km4rt.ddns.net:8073']);
  assert.equal(h.manager.activeSocket.readyState, h.Manager.constants ? 1 : 1);
});

test('socket that becomes OPEN without emitting open is discovered by 50 ms reconciliation', () => {
  const h = harness();
  h.manager.connect([{ id:'tipton', name:'KM4RT', location:'Tipton County, Tennessee' }]);
  assert.deepEqual(h.opens, []);
  h.sockets[0].open({ emit:false });
  h.runDelay(50);
  assert.deepEqual(h.opens, ['tipton']);
});

test('normal open event and reconciliation cannot call onOpen twice', () => {
  const h = harness();
  h.manager.connect([{ id:'tipton', name:'KM4RT', location:'Tipton County, Tennessee' }]);
  h.sockets[0].open({ emit:true });
  h.runDelay(50);
  assert.deepEqual(h.opens, ['tipton']);
});

test('manager exposes v7 open-race recovery contract', () => {
  const h = harness();
  assert.equal(h.Manager.version, 'fast-path-v7-open-reconcile');
  assert.equal(h.Manager.constants.OPEN_RECONCILE_MS, 50);
  assert.equal(h.Manager.constants.TOTAL_CONNECT_BUDGET_MS, 9500);
});