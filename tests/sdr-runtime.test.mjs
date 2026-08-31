import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

const managerSource = fs.readFileSync(new URL('../sdr-connection-manager.js', import.meta.url), 'utf8');
const runtimeSource = fs.readFileSync(new URL('../sdr-receiver-runtime-v3.js', import.meta.url), 'utf8');
const healthSource = fs.readFileSync(new URL('../sdr-health.js', import.meta.url), 'utf8');

function storage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key)
  };
}

function loadHealth() {
  const localStorage = storage();
  const window = { localStorage };
  const context = vm.createContext({ window, console, Date, JSON, Math, Number, Object, Array, String });
  vm.runInContext(healthSource, context, { filename:'sdr-health.js' });
  return { api:window.__freqbeaconReceiverHealth, localStorage };
}

function loadRuntime({ pool = null, healthState = () => ({}), fetchImpl = async () => { throw new Error('offline'); }, hamView = false } = {}) {
  const initial = {};
  if (pool) initial['freqbeacon:sdrLivePool:v3'] = JSON.stringify(pool);
  const localStorage = storage(initial);
  const document = {
    getElementById(id) {
      if (id === 'signalGrid') return { dataset:{ hamView:hamView ? 'true' : 'false' } };
      return null;
    }
  };
  const window = {
    localStorage,
    location:{ origin:'https://freqbeacon.example', href:'https://freqbeacon.example/' },
    __freqbeaconReceiverHealth:{ state:healthState },
    setTimeout:() => 0,
    clearTimeout:() => {}
  };
  const context = vm.createContext({
    window, document, console, URL, AbortController,
    fetch:fetchImpl, Date, JSON, Math, Number, Object, Array, String, Boolean, Promise
  });
  vm.runInContext(runtimeSource, context, { filename:'sdr-receiver-runtime-v3.js' });
  return { api:window.__freqbeaconReceiverRuntime, localStorage, window };
}

function makeManagerHarness() {
  let nextTimer = 1;
  const timers = new Map();
  const setTimeout = (fn, ms) => {
    const id = nextTimer++;
    timers.set(id, { fn, ms, active:true });
    return id;
  };
  const clearTimeout = (id) => {
    const item = timers.get(id);
    if (item) item.active = false;
  };
  const runDelay = (ms) => {
    let ran = true;
    let guard = 0;
    while (ran && guard++ < 20) {
      ran = false;
      for (const item of timers.values()) {
        if (item.active && item.ms === ms) {
          item.active = false;
          item.fn();
          ran = true;
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
      this.binaryType = '';
      this.sent = [];
      this.onopen = this.onmessage = this.onerror = this.onclose = null;
    }
    send(value) { this.sent.push(value); }
    close() { this.readyState = FakeSocket.CLOSED; }
    open() { this.readyState = FakeSocket.OPEN; this.onopen?.(); }
    message(data) { this.onmessage?.({ data }); }
    remoteClose(code=1006, reason='remote') {
      this.readyState = FakeSocket.CLOSED;
      this.onclose?.({ code, reason });
    }
  }

  const sockets = [];
  const health = { success:[], failure:[] };
  const window = {
    WebSocket:FakeSocket,
    setTimeout,
    clearTimeout,
    __freqbeaconReceiverHealth:{
      markSuccess:id => health.success.push(id),
      markFailure:(id,reason,detail) => health.failure.push({id,reason,detail})
    }
  };
  const context = vm.createContext({
    window, console, TextDecoder, ArrayBuffer, Uint8Array, Array, Set, Object, String, Number, TypeError
  });
  vm.runInContext(managerSource, context, { filename:'sdr-connection-manager.js' });
  const Manager = window.FreqBeaconSdrConnectionManager;
  const events = { attempts:[], failovers:[], unavailable:[], disconnected:[], useful:[] };
  const manager = new Manager({
    websocketFactory:url => { const socket = new FakeSocket(url); sockets.push(socket); return socket; },
    urlForReceiver:r => `wss://example/api/sdr/ws?receiver=${encodeURIComponent(r.id)}`,
    onAttempt:e => events.attempts.push(e),
    onFailover:e => events.failovers.push(e),
    onUnavailable:e => events.unavailable.push(e),
    onDisconnected:e => events.disconnected.push(e),
    onUsefulData:e => events.useful.push(e)
  });
  return { manager, sockets, events, health, runDelay, FakeSocket, Manager };
}

function sndFrame() {
  const bytes = new Uint8Array(12);
  bytes[0]=83; bytes[1]=78; bytes[2]=68;
  return bytes.buffer;
}

test('health cooldowns failures and resets on success', () => {
  const { api } = loadHealth();
  api.markFailure('a','timeout','slow');
  let state = api.state('a');
  assert.equal(state.cooling, true);
  assert.equal(state.failures, 1);
  assert.equal(state.lastFailureReason, 'timeout');
  api.markFailure('a','timeout','slow again');
  assert.equal(api.state('a').failures, 2);
  api.markSuccess('a');
  state = api.state('a');
  assert.equal(state.cooling, false);
  assert.equal(state.failures, 0);
  assert.equal(state.recentSuccess, true);
});

test('seed catalog ranks synchronously with no network', () => {
  const { api } = loadRuntime();
  const start = performance.now();
  const result = api.recommend({ frequency:9955, userLat:35.0887, userLon:-92.4421, txLat:25.7, txLon:-80.2, ham:false });
  const elapsed = performance.now() - start;
  assert.equal(result.source, 'receiver-runtime-seed');
  assert.ok(result.receivers.length >= 4);
  assert.ok(elapsed < 100, `single synchronous ranking took ${elapsed.toFixed(2)}ms`);
});

test('cached catalog uses stale-while-refresh and expires to seed', () => {
  const receivers = [
    {id:'a.example:8073',name:'Alpha',location:'Arkansas',lat:35,lon:-92,minKHz:10,maxKHz:30000},
    {id:'b.example:8073',name:'Bravo',location:'Arkansas',lat:35.1,lon:-92,minKHz:10,maxKHz:30000},
    {id:'c.example:8073',name:'Charlie',location:'Arkansas',lat:35.2,lon:-92,minKHz:10,maxKHz:30000},
    {id:'d.example:8073',name:'Delta',location:'Arkansas',lat:35.3,lon:-92,minKHz:10,maxKHz:30000}
  ];
  const stale = loadRuntime({ pool:{ updatedAt:Date.now()-2*86400000, receivers } }).api.recommend({frequency:7000,userLat:35,userLon:-92});
  assert.equal(stale.source, 'receiver-runtime-stale-cache');
  const expired = loadRuntime({ pool:{ updatedAt:Date.now()-8*86400000, receivers } }).api.recommend({frequency:7000,userLat:35,userLon:-92});
  assert.equal(expired.source, 'receiver-runtime-seed');
  assert.match(expired.warning, /older than seven days/i);
});

test('duplicate physical receiver aliases prefer hostname over raw IP', () => {
  const { api } = loadRuntime();
  const deduped = api.dedupeReceivers([
    {id:'64.22.14.214:8073',name:'KM4RT 0-30 MHz SDR',location:'Tipton County, Tennessee',lat:35.56,lon:-89.65,minKHz:10,maxKHz:30000,liveEvidence:true},
    {id:'km4rt.ddns.net:8073',name:'KM4RT 0-30 MHz SDR',location:'Tipton County, Tennessee',lat:35.56,lon:-89.65,minKHz:10,maxKHz:30000,liveEvidence:true}
  ]);
  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].id, 'km4rt.ddns.net:8073');
});

test('cooling receiver is excluded when healthy alternatives exist', () => {
  const { api } = loadRuntime({ healthState:id => ({ cooling:id==='km4rt.ddns.net:8073', recentSuccess:false, failures:id==='km4rt.ddns.net:8073'?2:0 }) });
  const result = api.recommend({ frequency:9955, userLat:35.0887, userLon:-92.4421, ham:false });
  assert.equal(result.receivers.some(r => r.id==='km4rt.ddns.net:8073'), false);
});

test('recent success wins otherwise equivalent ranking', () => {
  const receivers = [
    {id:'a.example:8073',name:'Alpha Site',location:'Conway A',lat:35.0887,lon:-92.4421,minKHz:10,maxKHz:30000},
    {id:'b.example:8073',name:'Bravo Site',location:'Conway B',lat:35.0887,lon:-92.4421,minKHz:10,maxKHz:30000},
    {id:'c.example:8073',name:'Charlie Site',location:'Conway C',lat:35.3,lon:-92.4,minKHz:10,maxKHz:30000},
    {id:'d.example:8073',name:'Delta Site',location:'Conway D',lat:35.4,lon:-92.4,minKHz:10,maxKHz:30000}
  ];
  const { api } = loadRuntime({
    pool:{updatedAt:Date.now(),receivers},
    healthState:id => ({ cooling:false, recentSuccess:id==='b.example:8073', failures:0 })
  });
  const result = api.recommend({frequency:9955,userLat:35.0887,userLon:-92.4421,ham:false});
  assert.equal(result.receivers[0].id, 'b.example:8073');
  assert.equal(result.receivers[0].connectionHealth, 'recent-success');
});

test('MW locality and HF path roles remain distinct', () => {
  const { api } = loadRuntime();
  const mw = api.recommend({frequency:1000,userLat:35.0887,userLon:-92.4421,ham:false});
  assert.equal(mw.receivers[0].role, 'NEAR YOU');
  assert.ok(mw.receivers[0].distanceMiles < 600);
  const hf = api.recommend({frequency:9955,userLat:35.0887,userLon:-92.4421,txLat:40.4,txLon:-3.7,ham:false});
  assert.ok(hf.receivers.some(r => r.role==='STATION CHECK'));
  assert.ok(hf.receivers.some(r => r.role==='PROPAGATION ALT'));
});

test('ham geography stays local even when nearby receivers are cooling', () => {
  const cooling = new Set(['22661.proxy.kiwisdr.com:8073','km4rt.ddns.net:8073','21118.proxy.kiwisdr.com:8073','22204.proxy.kiwisdr.com:8073']);
  const { api } = loadRuntime({ healthState:id => ({ cooling:cooling.has(id), recentSuccess:false, failures:cooling.has(id)?2:0 }), hamView:true });
  const result = api.recommend({frequency:7200,userLat:35.0887,userLon:-92.4421,ham:true});
  assert.equal(result.receivers[0].role, 'NEAR YOU');
  assert.ok(result.receivers[0].distanceMiles < 900, `ham pick was ${result.receivers[0].distanceMiles} mi away`);
});

test('ReceiverBook failure never blocks local recommendation', async () => {
  const { api } = loadRuntime({ fetchImpl:async () => { throw new Error('ReceiverBook down'); } });
  const before = api.recommend({frequency:9955,userLat:35,userLon:-92});
  const refreshed = await api.refresh({frequency:9955,userLat:35,userLon:-92},{force:true});
  const after = api.recommend({frequency:9955,userLat:35,userLon:-92});
  assert.equal(refreshed, false);
  assert.ok(before.receivers.length);
  assert.ok(after.receivers.length);
});

test('ranking stays comfortably below interaction budget', () => {
  const { api } = loadRuntime();
  const start = performance.now();
  for (let i=0;i<250;i++) api.recommend({frequency:9955,userLat:35.0887,userLon:-92.4421,txLat:25.7,txLon:-80.2,ham:false});
  const elapsed = performance.now()-start;
  assert.ok(elapsed < 500, `250 rankings took ${elapsed.toFixed(1)}ms`);
});

test('connection manager immediately attempts first candidate and fails over', () => {
  const h = makeManagerHarness();
  const candidates=[{id:'a'},{id:'b'},{id:'c'}];
  h.manager.connect(candidates);
  assert.equal(h.sockets.length,1);
  h.sockets[0].remoteClose();
  h.runDelay(100);
  assert.equal(h.sockets.length,2);
  assert.equal(h.events.failovers.length,1);
  assert.equal(h.events.attempts[1].receiver.id,'b');
});

test('manual receiver failure does not auto-jump', () => {
  const h=makeManagerHarness();
  h.manager.connect([{id:'a'},{id:'b'}],{startIndex:1,manual:true});
  assert.equal(h.sockets[0].url.includes('b'),true);
  h.sockets[0].remoteClose();
  h.runDelay(100);
  assert.equal(h.sockets.length,1);
  assert.equal(h.events.unavailable.length,1);
  assert.equal(h.events.unavailable[0].manual,true);
});

test('automatic failover is capped at five attempts', () => {
  const h=makeManagerHarness();
  h.manager.connect(Array.from({length:7},(_,i)=>({id:`r${i}`})));
  for(let i=0;i<5;i++){
    h.sockets[i].remoteClose();
    h.runDelay(100);
  }
  assert.equal(h.sockets.length,5);
  assert.equal(h.events.unavailable.length,1);
});

test('stale connection callbacks cannot corrupt a new sequence', () => {
  const h=makeManagerHarness();
  h.manager.connect([{id:'old-a'},{id:'old-b'}]);
  const staleClose=h.sockets[0].onclose;
  h.manager.connect([{id:'new-a'},{id:'new-b'}]);
  assert.equal(h.sockets.length,2);
  staleClose?.({code:1006,reason:'late old close'});
  h.runDelay(100);
  assert.equal(h.sockets.length,2);
  assert.equal(h.events.attempts.at(-1).receiver.id,'new-a');
});

test('stop cancels in-flight failover', () => {
  const h=makeManagerHarness();
  h.manager.connect([{id:'a'},{id:'b'}]);
  const staleClose=h.sockets[0].onclose;
  h.manager.stop('user-stop');
  staleClose?.({code:1006,reason:'late close'});
  h.runDelay(100);
  assert.equal(h.sockets.length,1);
});

test('live remote close automatically advances to next ranked receiver', () => {
  const h=makeManagerHarness();
  h.manager.connect([{id:'a'},{id:'b'}]);
  h.sockets[0].open();
  h.sockets[0].message(sndFrame());
  assert.equal(h.events.useful.length,1);
  h.sockets[0].remoteClose(1006,'gone');
  h.runDelay(100);
  assert.equal(h.sockets.length,2);
  assert.equal(h.events.failovers.at(-1).reason,'remote-close');
  assert.equal(h.health.failure.at(-1).reason,'remote-close');
});

test('Kiwi message classifier distinguishes SND, busy, and offline', () => {
  const h=makeManagerHarness();
  assert.equal(h.Manager.inspectKiwiMessage(sndFrame()).useful,true);
  assert.equal(h.Manager.inspectKiwiMessage('MSG too_busy=1').failure,'busy');
  assert.equal(h.Manager.inspectKiwiMessage('MSG down=1').failure,'offline');
});