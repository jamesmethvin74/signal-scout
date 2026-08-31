(() => {
  if (window.FreqBeaconSdrConnectionManager) return;

  // Keep the proven pre-cleanup handshake budget. A Cloudflare -> public Kiwi
  // WebSocket can legitimately take several seconds to reach OPEN on mobile.
  // Errors/close still fail immediately; the timeout is only the silent ceiling.
  const CONNECT_TIMEOUT_MS = 9000;
  const FIRST_SND_TIMEOUT_MS = 5000;
  const FAILOVER_DELAY_MS = 100;
  const MAX_AUTO_ATTEMPTS = 5;
  const decoder = new TextDecoder();

  function inspectKiwiMessage(data) {
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

  function compactLabel(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\b(?:kiwisdr|sdr|receiver|0\s*[-–]\s*30\s*mhz|v2)\b/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function receiverSignature(receiver) {
    const combined = `${receiver?.name || ''} ${receiver?.location || ''}`.toUpperCase();
    const call = combined.match(/\b[A-Z]{1,2}\d[A-Z]{1,4}\b/)?.[0];
    if (call) return `call:${call}`;
    const name = compactLabel(receiver?.name);
    const location = compactLabel(receiver?.location);
    return `site:${name}|${location}`;
  }

  class FreqBeaconSdrConnectionManager {
    constructor({
      websocketFactory = (url) => new window.WebSocket(url),
      urlForReceiver,
      onAttempt = () => {},
      onOpen = () => {},
      onMessage = () => {},
      onUsefulData = () => {},
      onFailover = () => {},
      onUnavailable = () => {},
      onDisconnected = () => {}
    } = {}) {
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
      this.socketHandlers = null;
      this.candidates = [];
      this.currentIndex = -1;
      this.attempted = new Set();
      this.attemptedSignatures = new Set();
      this.attemptCount = 0;
      this.manual = false;
      this.manualStop = false;
      this.gotUsefulData = false;
      this.failedAttempt = false;
      this.connectTimer = null;
      this.dataTimer = null;
      this.failoverTimer = null;
    }

    get activeReceiver() {
      return this.candidates[this.currentIndex] || null;
    }

    get activeSocket() {
      return this.socket;
    }

    get isLive() {
      return Boolean(this.socket && this.gotUsefulData);
    }

    clearTimers() {
      window.clearTimeout(this.connectTimer);
      window.clearTimeout(this.dataTimer);
      window.clearTimeout(this.failoverTimer);
      this.connectTimer = this.dataTimer = this.failoverTimer = null;
    }

    bindSocket(socket, handlers) {
      this.socketHandlers = handlers;
      if (typeof socket.addEventListener === 'function') {
        for (const [type, handler] of Object.entries(handlers)) socket.addEventListener(type, handler);
        return;
      }
      socket.onopen = handlers.open;
      socket.onmessage = handlers.message;
      socket.onerror = handlers.error;
      socket.onclose = handlers.close;
    }

    unbindSocket(socket) {
      const handlers = this.socketHandlers;
      this.socketHandlers = null;
      if (!socket || !handlers) return;
      if (typeof socket.removeEventListener === 'function') {
        for (const [type, handler] of Object.entries(handlers)) socket.removeEventListener(type, handler);
        return;
      }
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
    }

    closeSocket(reason = 'FreqBeacon disconnect') {
      this.clearTimers();
      const socket = this.socket;
      this.socket = null;
      if (!socket) return;
      this.unbindSocket(socket);
      try { socket.close(1000, reason); } catch {}
    }

    stop(reason = 'Stopped') {
      this.manualStop = true;
      this.generation += 1;
      this.closeSocket('FreqBeacon stop');
      this.gotUsefulData = false;
      this.failedAttempt = false;
      this.onDisconnected({ reason, manual:true, receiver:this.activeReceiver });
    }

    cancel(reason = 'Cancelled') {
      this.manualStop = false;
      this.generation += 1;
      this.closeSocket('FreqBeacon cancel');
      this.gotUsefulData = false;
      this.failedAttempt = false;
      this.onDisconnected({ reason, manual:false, receiver:this.activeReceiver });
    }

    connect(candidates, { startIndex = 0, manual = false } = {}) {
      const usable = Array.isArray(candidates) ? candidates.filter((receiver) => receiver?.id) : [];
      this.generation += 1;
      this.closeSocket('FreqBeacon new connection');
      this.candidates = usable;
      this.currentIndex = usable[startIndex] ? startIndex : 0;
      this.attempted.clear();
      this.attemptedSignatures.clear();
      this.attemptCount = 0;
      this.manual = Boolean(manual);
      this.manualStop = false;
      this.gotUsefulData = false;
      this.failedAttempt = false;
      const generation = this.generation;

      if (!usable.length) {
        this.onUnavailable({ reason:'no-candidates', attempts:0, receiver:null });
        return generation;
      }
      this.tryIndex(this.currentIndex, generation);
      return generation;
    }

    tryIndex(index, generation = this.generation) {
      if (generation !== this.generation || this.manualStop) return;
      const receiver = this.candidates[index];
      if (!receiver) {
        this.finishUnavailable('no-candidate', generation);
        return;
      }

      if (this.manual && this.attemptCount >= 1) {
        this.finishUnavailable('manual-receiver-failed', generation);
        return;
      }
      if (!this.manual && this.attemptCount >= MAX_AUTO_ATTEMPTS) {
        this.finishUnavailable('failover-cap', generation);
        return;
      }

      this.closeSocket('FreqBeacon failover');
      this.currentIndex = index;
      this.attempted.add(receiver.id);
      this.attemptedSignatures.add(receiverSignature(receiver));
      this.attemptCount += 1;
      this.gotUsefulData = false;
      this.failedAttempt = false;

      let socket;
      try {
        socket = this.websocketFactory(this.urlForReceiver(receiver, index));
        socket.binaryType = 'arraybuffer';
      } catch (error) {
        this.failAttempt('constructor', error?.message || 'WebSocket constructor failed', generation);
        return;
      }
      this.socket = socket;

      // Announce only after the socket exists so CONNECTING always has a real
      // cancellable connection behind it.
      this.onAttempt({ receiver, index, attempt:this.attemptCount, generation, manual:this.manual });

      const handlers = {
        open: () => {
          if (!this.isCurrent(socket, generation)) return;
          window.clearTimeout(this.connectTimer);
          this.connectTimer = null;
          this.onOpen({ socket, receiver, index, attempt:this.attemptCount, generation });
          this.dataTimer = window.setTimeout(() => {
            if (!this.isCurrent(socket, generation) || this.gotUsefulData) return;
            this.failAttempt('timeout', 'WebSocket opened but no useful SND data arrived', generation);
          }, FIRST_SND_TIMEOUT_MS);
        },
        message: (event) => {
          if (!this.isCurrent(socket, generation)) return;
          const inspection = inspectKiwiMessage(event.data);
          if (inspection.failure) {
            this.failAttempt(inspection.failure, `Receiver reported ${inspection.failure}`, generation);
            return;
          }
          if (inspection.useful && !this.gotUsefulData) {
            this.gotUsefulData = true;
            window.clearTimeout(this.dataTimer);
            this.dataTimer = null;
            window.__freqbeaconReceiverHealth?.markSuccess?.(receiver.id);
            this.onUsefulData({ socket, receiver, index, attempt:this.attemptCount, generation });
          }
          this.onMessage({ event, socket, receiver, index, generation });
        },
        error: () => {
          if (!this.isCurrent(socket, generation) || this.gotUsefulData) return;
          this.failAttempt('error', 'WebSocket error', generation);
        },
        close: (event) => {
          if (!this.isCurrent(socket, generation)) return;
          if (!this.gotUsefulData) {
            this.failAttempt('closed', event?.reason || `WebSocket closed (${event?.code || 0})`, generation);
            return;
          }
          this.recoverLiveClose(event, receiver, generation);
        }
      };
      this.bindSocket(socket, handlers);

      this.connectTimer = window.setTimeout(() => {
        if (!this.isCurrent(socket, generation) || socket.readyState !== window.WebSocket.CONNECTING) return;
        this.failAttempt('timeout', 'WebSocket connection timed out', generation);
      }, CONNECT_TIMEOUT_MS);
    }

    isCurrent(socket, generation) {
      return generation === this.generation && socket === this.socket && !this.manualStop;
    }

    candidateUntried(receiver) {
      return Boolean(receiver
        && !this.attempted.has(receiver.id)
        && !this.attemptedSignatures.has(receiverSignature(receiver)));
    }

    failAttempt(reason, detail, generation = this.generation) {
      if (generation !== this.generation || this.manualStop || this.failedAttempt || this.gotUsefulData) return;
      this.failedAttempt = true;
      const receiver = this.activeReceiver;
      window.__freqbeaconReceiverHealth?.markFailure?.(receiver?.id, reason, detail);
      this.closeSocket('FreqBeacon failed attempt');

      if (this.manual) {
        this.finishUnavailable(reason, generation, detail);
        return;
      }

      const next = this.nextCandidateIndex();
      if (next == null || this.attemptCount >= MAX_AUTO_ATTEMPTS) {
        this.finishUnavailable(next == null ? 'exhausted' : 'failover-cap', generation, detail);
        return;
      }

      const failed = receiver;
      const nextReceiver = this.candidates[next];
      this.onFailover({ failed, next:nextReceiver, reason, detail, attempt:this.attemptCount + 1, generation });
      this.failoverTimer = window.setTimeout(() => {
        if (generation !== this.generation || this.manualStop) return;
        this.tryIndex(next, generation);
      }, FAILOVER_DELAY_MS);
    }

    recoverLiveClose(event, receiver, generation = this.generation) {
      if (generation !== this.generation || this.manualStop) return;
      const detail = event?.reason || `WebSocket closed (${event?.code || 0})`;
      window.__freqbeaconReceiverHealth?.markFailure?.(receiver?.id, 'remote-close', detail);
      this.closeSocket('FreqBeacon remote close');
      this.gotUsefulData = false;
      this.failedAttempt = false;

      if (this.manual) {
        this.onDisconnected({ reason:'remote-close', manual:true, receiver, code:event?.code || 0, detail:event?.reason || '' });
        return;
      }

      const next = this.nextCandidateIndex();
      if (next == null || this.attemptCount >= MAX_AUTO_ATTEMPTS) {
        this.onDisconnected({ reason:'remote-close', manual:false, receiver, code:event?.code || 0, detail:event?.reason || '' });
        this.finishUnavailable(next == null ? 'exhausted-after-live' : 'failover-cap-after-live', generation, detail);
        return;
      }

      const nextReceiver = this.candidates[next];
      this.onFailover({ failed:receiver, next:nextReceiver, reason:'remote-close', detail, attempt:this.attemptCount + 1, generation });
      this.failoverTimer = window.setTimeout(() => {
        if (generation !== this.generation || this.manualStop) return;
        this.tryIndex(next, generation);
      }, FAILOVER_DELAY_MS);
    }

    nextCandidateIndex() {
      // After the first automatic failure, prefer one deployment-bundled
      // receiver that is a genuinely different physical site. Worker-v2 can
      // resolve these without a fresh ReceiverBook lookup.
      if (!this.manual && this.attemptCount === 1) {
        const seedIndex = this.candidates.findIndex((receiver) => receiver?.bundledSeed && this.candidateUntried(receiver));
        if (seedIndex >= 0) return seedIndex;
      }

      for (let offset = 1; offset <= this.candidates.length; offset += 1) {
        const index = (this.currentIndex + offset) % this.candidates.length;
        const receiver = this.candidates[index];
        if (this.candidateUntried(receiver)) return index;
      }
      return null;
    }

    finishUnavailable(reason, generation = this.generation, detail = '') {
      if (generation !== this.generation) return;
      const receiver = this.activeReceiver;
      this.closeSocket('FreqBeacon unavailable');
      this.gotUsefulData = false;
      this.onUnavailable({ reason, detail, attempts:this.attemptCount, receiver, generation, manual:this.manual });
    }
  }

  FreqBeaconSdrConnectionManager.constants = Object.freeze({
    CONNECT_TIMEOUT_MS,
    FIRST_SND_TIMEOUT_MS,
    FAILOVER_DELAY_MS,
    MAX_AUTO_ATTEMPTS
  });
  FreqBeaconSdrConnectionManager.inspectKiwiMessage = inspectKiwiMessage;
  FreqBeaconSdrConnectionManager.receiverSignature = receiverSignature;
  window.FreqBeaconSdrConnectionManager = FreqBeaconSdrConnectionManager;
})();