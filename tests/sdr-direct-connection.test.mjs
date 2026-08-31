import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../sdr-direct-connection.js', import.meta.url), 'utf8');

function harness() {
  let tid = 1;
  const timers = new Map();
  const setTimeout = (fn, ms) => { const id=tid++; timers.set(id,{fn,ms,active:true}); return id; };
  const clearTimeout = id => { if (timers.has(id)) timers.get(id).active=false; };
  const run = ms => { for (const t of [...timers.values()]) if (t.active && t.ms===ms) { t.active=false; t.fn(); } };
  let healthClears=0, successes=0, failures=0;
  const store = new Map();
  class WS {
    static CONNECTING=0; static OPEN=1; static CLOSED=3;
    constructor(url){this.url=url;this.readyState=0;this.sent=[];this.onopen=this.onmessage=this.onerror=this.onclose=null;}
    open(){this.readyState=1;this.onopen?.();}
    message(data){this.onmessage?.({data});}
    close(){this.readyState=3;}
    fail(){this.onerror?.();}
  }
  const window = {
    WebSocket:WS,
    setTimeout, clearTimeout,
    localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v))},
    __freqbeaconReceiverHealth:{clear:()=>healthClears++,markSuccess:()=>successes++,markFailure:()=>failures++}
  };
  const context=vm.createContext({window,console,TextDecoder,ArrayBuffer,Uint8Array,Set,Object,String,Number,TypeError,Date});
  vm.runInContext(source,context);
  const C=window.FreqBeaconSdrConnectionManager;
  const sockets=[], attempts=[], opens=[], lives=[], failovers=[], unavailable=[];
  const c=new C({
    websocketFactory:url=>{const s=new WS(url);sockets.push(s);return s;},
    urlForReceiver:r=>`wss://x/api/sdr/ws?receiver=${r.id}`,
    onAttempt:e=>attempts.push(e.receiver.id), onOpen:e=>opens.push(e.receiver.id),
    onUsefulData:e=>lives.push(e.receiver.id), onFailover:e=>failovers.push([e.failed.id,e.next.id]),
    onUnavailable:e=>unavailable.push(e)
  });
  return {C,c,sockets,attempts,opens,lives,failovers,unavailable,run,get healthClears(){return healthClears},get successes(){return successes},get failures(){return failures}};
}

test('direct controller owns property WebSocket lifecycle and is sub-10-second',()=>{
  const h=harness();
  assert.equal(h.C.version,'direct-snd-v1');
  assert.equal(h.C.constants.TOTAL_MS,9500);
  assert.equal(h.C.constants.OPEN_MS,3000);
  assert.equal(h.C.constants.SND_MS,2500);
  assert.equal(h.C.constants.MAX_ATTEMPTS,3);
  h.c.connect([{id:'tipton'}]);
  assert.equal(typeof h.sockets[0].onopen,'function');
  assert.equal(typeof h.sockets[0].onmessage,'function');
});

test('contaminated health is cleared once on direct rollout',()=>{
  const h=harness();
  assert.equal(h.healthClears,1);
});

test('open then useful SND marks receiver live',()=>{
  const h=harness();
  h.c.connect([{id:'tipton'}]);
  h.sockets[0].open();
  const snd=new Uint8Array(12); snd[0]=83;snd[1]=78;snd[2]=68;
  h.sockets[0].message(snd.buffer);
  assert.deepEqual(h.opens,['tipton']);
  assert.deepEqual(h.lives,['tipton']);
  assert.equal(h.successes,1);
});

test('failed receiver follows ranked order',()=>{
  const h=harness();
  h.c.connect([{id:'one',name:'One',location:'A'},{id:'two',name:'Two',location:'B'},{id:'three',name:'Three',location:'C'}]);
  h.sockets[0].fail();
  h.run(75);
  assert.deepEqual(h.attempts,['one','two']);
  assert.deepEqual(h.failovers,[['one','two']]);
});

test('manual receiver failure does not jump elsewhere',()=>{
  const h=harness();
  h.c.connect([{id:'one'},{id:'two'}],{manual:true});
  h.sockets[0].fail();
  assert.equal(h.attempts.length,1);
  assert.equal(h.unavailable.length,1);
});