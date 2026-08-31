(() => {
  if (window.__freqbeaconDirectSndV1) return;
  window.__freqbeaconDirectSndV1 = true;

  const HEALTH_RESET_KEY = 'freqbeacon:directSndHealthReset:v1';
  const TOTAL_MS = 9500;
  const OPEN_MS = 3000;
  const SND_MS = 2500;
  const FAILOVER_MS = 75;
  const MAX_ATTEMPTS = 3;
  const decoder = new TextDecoder();

  // The previous manager bugs created false local cooldown evidence for healthy
  // receivers (notably KM4RT Tipton). Clear that evidence once when the direct
  // SND path first loads, then resume normal success/failure tracking.
  try {
    if (window.localStorage?.getItem(HEALTH_RESET_KEY) !== '1') {
      window.__freqbeaconReceiverHealth?.clear?.();
      window.localStorage?.setItem(HEALTH_RESET_KEY, '1');
    }
  } catch {}

  function inspect(data) {
    try {
      let bytes = null;
      if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
      else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (bytes) {
        if (bytes.length < 3) return { useful:false, failure:null };
        const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
        if (tag === 'SND') return { useful:bytes.length >= 10, failure:null };
        if (tag === 'MSG') {
          const text = decoder.decode(bytes.subarray(4));
          if (/(?:^|\s)too_busy=1(?:\s|$)/.test(text)) return { useful:false, failure:'busy' };
          if (/(?:^|\s)down=1(?:\s|$)/.test(text)) return { useful:false, failure:'offline' };
        }
      }
      if (typeof data === 'string') {
        if (data.startsWith('SND')) return { useful:true, failure:null };
        if (/too_busy=1/.test(data)) return { useful:false, failure:'busy' };
        if (/down=1/.test(data)) return { useful:false, failure:'offline' };
      }
    } catch {}
    return { useful:false, failure:null };
  }

  function compact(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\b(?:kiwisdr|sdr|receiver|0\s*[-–]\s*30\s*mhz|v2)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function signature(receiver) {
    const combined = `${receiver?.name || ''} ${receiver?.location || ''}`.toUpperCase();
    const call = combined.match(/\b[A-Z]{1,2}\d[A-Z]{1,4}\b/)?.[0];
    return call ? `call:${call}` : `site:${compact(receiver?.name)}|${compact(receiver?.location)}`;
  }

  class DirectSndConnection {
    constructor({ websocketFactory=(url)=>new window.WebSocket(url), urlForReceiver,
      onAttempt=()=>{}, onOpen=()=>{}, onMessage=()=>{}, onUsefulData=()=>{},
      onFailover=()=>{}, onUnavailable=()=>{}, onDisconnected=()=>{} }={}) {
      if (typeof urlForReceiver !== 'function') throw new TypeError('urlForReceiver is required');
      this.websocketFactory = websocketFactory;
      this.urlForReceiver = urlForReceiver;
      this.onAttempt = onAttempt;
      this.onOpen = onOpen;
      this.onMessage = onMessage;
      this.onUsefulData = onUsefulData;
      this.onFailover = onFailover;
      this.onUnavailable = onUnavailable;
      this.onDisconnected = onDisconnected;
      this.generation = 0;
      this.socket = null;
      this.candidates = [];
      this.currentIndex = -1;
      this.attemptCount = 0;
      this.attemptedIds = new Set();
      this.attemptedSignatures = new Set();
      this.manual = false;
      this.manualStop = false;
      this.gotUseful = false;
      this.startedAt = 0;
      this.openTimer = null;
      this.sndTimer = null;
      this.totalTimer = null;
      this.failoverTimer = null;
    }

    get activeSocket() { return this.socket; }
    get activeReceiver() { return this.candidates[this.currentIndex] || null; }
    get isLive() { return Boolean(this.socket && this.gotUseful); }
    elapsed() { return this.startedAt ? Date.now() - this.startedAt : 0; }
    remaining() { return Math.max(0, TOTAL_MS - this.elapsed()); }

    clearAttemptTimers() {
      window.clearTimeout(this.openTimer);
      window.clearTimeout(this.sndTimer);
      window.clearTimeout(this.failoverTimer);
      this.openTimer = this.sndTimer = this.failoverTimer = null;
    }

    clearAllTimers() {
      this.clearAttemptTimers();
      window.clearTimeout(this.totalTimer);
      this.totalTimer = null;
    }

    closeSocket(reason='FreqBeacon direct disconnect') {
      this.clearAttemptTimers();
      const socket = this.socket;
      this.socket = null;
      if (!socket) return;
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      try { socket.close(1000, reason); } catch {}
    }

    stop(reason='Stopped') {
      this.manualStop = true;
      this.generation += 1;
      this.clearAllTimers();
      this.closeSocket('FreqBeacon stop');
      this.gotUseful = false;
      this.onDisconnected({ reason, manual:true, receiver:this.activeReceiver });
    }

    cancel(reason='Cancelled') {
      this.manualStop = false;
      this.generation += 1;
      this.clearAllTimers();
      this.closeSocket('FreqBeacon cancel');
      this.gotUseful = false;
      this.onDisconnected({ reason, manual:false, receiver:this.activeReceiver });
    }

    connect(candidates, { startIndex=0, manual=false }={}) {
      const usable = Array.isArray(candidates) ? candidates.filter(r => r?.id) : [];
      this.generation += 1;
      this.clearAllTimers();
      this.closeSocket('FreqBeacon new direct sequence');
      this.candidates = usable;
      this.currentIndex = usable[startIndex] ? startIndex : 0;
      this.attemptCount = 0;
      this.attemptedIds.clear();
      this.attemptedSignatures.clear();
      this.manual = Boolean(manual);
      this.manualStop = false;
      this.gotUseful = false;
      this.startedAt = Date.now();
      const generation = this.generation;

      if (!usable.length) {
        this.onUnavailable({ reason:'no-candidates', attempts:0, receiver:null, manual:this.manual });
        return generation;
      }

      this.totalTimer = window.setTimeout(() => {
        if (generation !== this.generation || this.manualStop || this.gotUseful) return;
        this.finishUnavailable('total-budget', 'No receiver produced audio inside 9.5 seconds.', generation);
      }, TOTAL_MS);
      this.openIndex(this.currentIndex, generation);
      return generation;
    }

    openIndex(index, generation=this.generation) {
      if (generation !== this.generation || this.manualStop) return;
      if (this.remaining() < 250) { this.finishUnavailable('total-budget', '', generation); return; }
      if (!this.manual && this.attemptCount >= MAX_ATTEMPTS) { this.finishUnavailable('attempt-cap', '', generation); return; }
      if (this.manual && this.attemptCount >= 1) { this.finishUnavailable('manual-receiver-failed', '', generation); return; }

      const receiver = this.candidates[index];
      if (!receiver) { this.finishUnavailable('no-receiver', '', generation); return; }
      this.closeSocket('FreqBeacon direct failover');
      this.currentIndex = index;
      this.attemptCount += 1;
      this.attemptedIds.add(receiver.id);
      this.attemptedSignatures.add(signature(receiver));
      this.gotUseful = false;

      let socket;
      try {
        socket = this.websocketFactory(this.urlForReceiver(receiver, index));
        socket.binaryType = 'arraybuffer';
      } catch (error) {
        this.fail('constructor', error?.message || 'WebSocket constructor failed', generation);
        return;
      }
      this.socket = socket;
      this.onAttempt({ receiver, index, attempt:this.attemptCount, generation, manual:this.manual, upstreamId:receiver.id });

      socket.onopen = () => {
        if (generation !== this.generation || socket !== this.socket || this.manualStop) return;
        window.clearTimeout(this.openTimer);
        this.openTimer = null;
        this.onOpen({ socket, receiver, index, attempt:this.attemptCount, generation, upstreamId:receiver.id });
        const wait = Math.min(SND_MS, Math.max(250, this.remaining()));
        this.sndTimer = window.setTimeout(() => {
          if (generation === this.generation && socket === this.socket && !this.gotUseful) {
            this.fail('snd-timeout', 'Socket opened but no useful SND audio arrived', generation);
          }
        }, wait);
      };

      socket.onmessage = (event) => {
        if (generation !== this.generation || socket !== this.socket || this.manualStop) return;
        const result = inspect(event.data);
        if (result.failure) { this.fail(result.failure, `Receiver reported ${result.failure}`, generation); return; }
        if (result.useful && !this.gotUseful) {
          this.gotUseful = true;
          window.clearTimeout(this.sndTimer);
          window.clearTimeout(this.totalTimer);
          this.sndTimer = this.totalTimer = null;
          window.__freqbeaconReceiverHealth?.markSuccess?.(receiver.id);
          this.onUsefulData({ socket, receiver, index, attempt:this.attemptCount, generation, elapsedMs:this.elapsed(), upstreamId:receiver.id });
        }
        this.onMessage({ event, socket, receiver, index, generation });
      };

      socket.onerror = () => {
        if (generation === this.generation && socket === this.socket && !this.gotUseful) {
          this.fail('socket-error', 'WebSocket error', generation);
        }
      };

      socket.onclose = (event) => {
        if (generation !== this.generation || socket !== this.socket || this.manualStop) return;
        if (!this.gotUseful) {
          this.fail('closed', event?.reason || `WebSocket closed (${event?.code || 0})`, generation);
        } else {
          this.clearAllTimers();
          this.closeSocket('FreqBeacon remote close');
          this.gotUseful = false;
          this.onDisconnected({ reason:'remote-close', manual:this.manual, receiver, code:event?.code || 0, detail:event?.reason || '' });
        }
      };

      const wait = Math.min(OPEN_MS, Math.max(250, this.remaining()));
      this.openTimer = window.setTimeout(() => {
        if (generation !== this.generation || socket !== this.socket || this.gotUseful) return;
        if (socket.readyState === window.WebSocket.OPEN) {
          const handler = socket.onopen;
          socket.onopen = null;
          try { handler?.(); } finally { socket.onopen = handler; }
        } else {
          this.fail('connect-timeout', 'WebSocket did not open', generation);
        }
      }, wait);
    }

    fail(reason, detail='', generation=this.generation) {
      if (generation !== this.generation || this.manualStop || this.gotUseful) return;
      const failed = this.activeReceiver;
      window.__freqbeaconReceiverHealth?.markFailure?.(failed?.id, reason, detail);
      this.closeSocket('FreqBeacon direct failure');

      if (this.manual || this.attemptCount >= MAX_ATTEMPTS || this.remaining() < 300) {
        this.finishUnavailable(reason, detail, generation);
        return;
      }
      const next = this.nextIndex();
      if (next == null) { this.finishUnavailable('exhausted', detail, generation); return; }
      const nextReceiver = this.candidates[next];
      this.onFailover({ failed, next:nextReceiver, reason, detail, attempt:this.attemptCount + 1, generation, remainingMs:this.remaining() });
      this.failoverTimer = window.setTimeout(() => {
        if (generation === this.generation && !this.manualStop) this.openIndex(next, generation);
      }, Math.min(FAILOVER_MS, this.remaining()));
    }

    nextIndex() {
      for (let offset = 1; offset <= this.candidates.length; offset += 1) {
        const index = (this.currentIndex + offset) % this.candidates.length;
        const receiver = this.candidates[index];
        if (!receiver || this.attemptedIds.has(receiver.id) || this.attemptedSignatures.has(signature(receiver))) continue;
        return index;
      }
      return null;
    }

    finishUnavailable(reason, detail='', generation=this.generation) {
      if (generation !== this.generation) return;
      const receiver = this.activeReceiver;
      this.clearAllTimers();
      this.closeSocket('FreqBeacon unavailable');
      this.gotUseful = false;
      this.onUnavailable({ reason, detail, attempts:this.attemptCount, receiver, generation, manual:this.manual, elapsedMs:this.elapsed() });
    }
  }

  DirectSndConnection.version = 'direct-snd-v1';
  DirectSndConnection.constants = Object.freeze({ TOTAL_MS, OPEN_MS, SND_MS, FAILOVER_MS, MAX_ATTEMPTS });
  DirectSndConnection.inspectKiwiMessage = inspect;
  DirectSndConnection.receiverSignature = signature;

  window.FreqBeaconSdrConnectionManager = DirectSndConnection;
})();
