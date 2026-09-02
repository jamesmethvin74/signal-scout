import baseWorker from './worker-sdr-mainthread-relief.js';

const MARKER = 'sdr-packet-cadence-v1';
const AUDIO_CLEANUP_MARKER = 'sdr-audio-node-cleanup-v1';

function bootstrap() {
  return `<script>
(() => {
  if (window.__freqbeaconSdrPacketCadence?.version) return;

  const VERSION = '${MARKER}';
  const pageStarted = performance.now();
  const sessions = [];
  const socketStates = new WeakMap();
  let negotiatedAudioRate = 12000;

  const elapsed = () => Math.round(performance.now() - pageStarted);

  function bytesFrom(data) {
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return null;
  }

  function parseMeta(detail) {
    try {
      const url = new URL(String(detail?.url || ''), location.href);
      return {
        receiver: detail?.receiverId || url.searchParams.get('receiver') || '',
        stream: url.searchParams.get('stream') || '',
        timestamp: url.searchParams.get('ts') || ''
      };
    } catch {
      return { receiver: detail?.receiverId || '', stream: 'SND', timestamp: '' };
    }
  }

  function modularDelta(current, previous) {
    return (current - previous) >>> 0;
  }

  function chooseEndian(state, currentBE, currentLE) {
    if (state.sequenceEndian) return state.sequenceEndian;
    if (state.previousBE == null || state.previousLE == null) return null;
    const deltaBE = modularDelta(currentBE, state.previousBE);
    const deltaLE = modularDelta(currentLE, state.previousLE);
    const bePlausible = deltaBE >= 1 && deltaBE <= 4096;
    const lePlausible = deltaLE >= 1 && deltaLE <= 4096;
    if (bePlausible && !lePlausible) return 'big';
    if (lePlausible && !bePlausible) return 'little';
    // Kiwi network fields are normally big-endian. When both interpretations
    // happen to look plausible, prefer network byte order and expose that choice.
    return 'big';
  }

  function addLargeGap(output, gapMs, afterSequence, atElapsedMs) {
    if (gapMs < 100) return;
    output.largestGaps.push({
      gapMs: Math.round(gapMs),
      afterSequence,
      atElapsedMs
    });
    output.largestGaps.sort((a, b) => b.gapMs - a.gapMs);
    if (output.largestGaps.length > 12) output.largestGaps.length = 12;
  }

  function attach(detail) {
    const socket = detail?.socket;
    if (!socket || socketStates.has(socket)) return;
    const meta = parseMeta(detail);
    if (meta.stream && meta.stream !== 'SND') return;

    const output = {
      receiver: meta.receiver,
      timestamp: meta.timestamp,
      attachedMs: elapsed(),
      firstSndMs: null,
      lastSndMs: null,
      frames: 0,
      pcmFrames: 0,
      compressedFrames: 0,
      bytes: 0,
      sequenceEndian: 'detecting',
      firstSequence: null,
      lastSequence: null,
      missingSequenceFrames: 0,
      duplicateSequenceFrames: 0,
      outOfOrderSequenceFrames: 0,
      maxArrivalGapMs: 0,
      averageArrivalGapMs: null,
      gapsOver70Ms: 0,
      gapsOver100Ms: 0,
      gapsOver250Ms: 0,
      gapsOver500Ms: 0,
      gapsOver1000Ms: 0,
      expectedFrameMs: null,
      audioMaterialMs: 0,
      wallSpanMs: 0,
      realtimeCoverageRatio: null,
      estimatedAudioDeficitMs: 0,
      largestGaps: []
    };
    sessions.push(output);
    if (sessions.length > 8) sessions.splice(0, sessions.length - 8);

    const state = {
      output,
      firstArrival: null,
      lastArrival: null,
      gapTotal: 0,
      gapCount: 0,
      sequenceEndian: null,
      firstBE: null,
      firstLE: null,
      previousBE: null,
      previousLE: null,
      previousSequence: null
    };
    socketStates.set(socket, state);

    socket.addEventListener('message', async (event) => {
      let data = event.data;
      if (data instanceof Blob) {
        try { data = await data.arrayBuffer(); } catch { return; }
      }
      const bytes = bytesFrom(data);
      if (!bytes || bytes.byteLength < 10) return;
      if (String.fromCharCode(bytes[0], bytes[1], bytes[2]) !== 'SND') return;

      const now = performance.now();
      const nowElapsed = elapsed();
      const flags = bytes[3] || 0;
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const sequenceBE = view.getUint32(4, false);
      const sequenceLE = view.getUint32(4, true);

      output.frames += 1;
      output.bytes += bytes.byteLength;
      output.lastSndMs = nowElapsed;
      if (output.firstSndMs == null) output.firstSndMs = nowElapsed;

      if (state.firstArrival == null) {
        state.firstArrival = now;
        state.firstBE = sequenceBE;
        state.firstLE = sequenceLE;
      } else if (state.lastArrival != null) {
        const gapMs = now - state.lastArrival;
        state.gapTotal += gapMs;
        state.gapCount += 1;
        output.maxArrivalGapMs = Math.max(output.maxArrivalGapMs, gapMs);
        if (gapMs >= 70) output.gapsOver70Ms += 1;
        if (gapMs >= 100) output.gapsOver100Ms += 1;
        if (gapMs >= 250) output.gapsOver250Ms += 1;
        if (gapMs >= 500) output.gapsOver500Ms += 1;
        if (gapMs >= 1000) output.gapsOver1000Ms += 1;
        addLargeGap(output, gapMs, output.lastSequence, nowElapsed);
      }
      state.lastArrival = now;

      if (!state.sequenceEndian && state.previousBE != null) {
        state.sequenceEndian = chooseEndian(state, sequenceBE, sequenceLE);
        output.sequenceEndian = state.sequenceEndian;
        output.firstSequence = state.sequenceEndian === 'little' ? state.firstLE : state.firstBE;
        state.previousSequence = state.sequenceEndian === 'little' ? state.previousLE : state.previousBE;
      }

      if (state.sequenceEndian) {
        const sequence = state.sequenceEndian === 'little' ? sequenceLE : sequenceBE;
        if (state.previousSequence != null) {
          const delta = modularDelta(sequence, state.previousSequence);
          if (delta === 0) {
            output.duplicateSequenceFrames += 1;
          } else if (delta > 1 && delta < 0x80000000) {
            output.missingSequenceFrames += delta - 1;
          } else if (delta >= 0x80000000) {
            output.outOfOrderSequenceFrames += 1;
          }
        }
        output.lastSequence = sequence;
        state.previousSequence = sequence;
      }

      state.previousBE = sequenceBE;
      state.previousLE = sequenceLE;

      if ((flags & 0x10) !== 0) {
        output.compressedFrames += 1;
      } else {
        output.pcmFrames += 1;
        const payloadBytes = Math.max(0, bytes.byteLength - 10);
        const samples = Math.floor(payloadBytes / 2);
        const rate = Number(negotiatedAudioRate) > 1000 ? Number(negotiatedAudioRate) : 12000;
        if (samples > 0) {
          const frameMs = samples / rate * 1000;
          output.expectedFrameMs = Number(frameMs.toFixed(2));
          output.audioMaterialMs += frameMs;
        }
      }

      output.averageArrivalGapMs = state.gapCount
        ? Number((state.gapTotal / state.gapCount).toFixed(2))
        : null;
      output.wallSpanMs = state.firstArrival == null ? 0 : Math.max(0, now - state.firstArrival);
      output.realtimeCoverageRatio = output.wallSpanMs > 0
        ? Number((output.audioMaterialMs / output.wallSpanMs).toFixed(3))
        : null;
      output.estimatedAudioDeficitMs = Math.max(0, Math.round(output.wallSpanMs - output.audioMaterialMs));
      output.audioMaterialMs = Number(output.audioMaterialMs.toFixed(2));
      output.maxArrivalGapMs = Number(output.maxArrivalGapMs.toFixed(2));
    });
  }

  window.addEventListener('freqbeacon:snd-created', (event) => attach(event.detail));
  window.addEventListener('freqbeacon:snd-audio-rate', (event) => {
    const value = Number(event.detail?.value);
    if (Number.isFinite(value) && value > 1000) negotiatedAudioRate = value;
  });

  const api = window.__freqbeaconSdrLifecycleV3;
  if (api?.getReport && !api.__packetCadenceWrapped) {
    const baseGetReport = api.getReport.bind(api);
    api.getReport = () => ({
      ...baseGetReport(),
      packetCadence: {
        version: VERSION,
        negotiatedAudioRate,
        sessions: sessions.map((session) => ({ ...session }))
      }
    });
    api.__packetCadenceWrapped = true;
  }

  window.__freqbeaconSdrPacketCadence = {
    version: VERSION,
    sessions
  };
})();
</script>`;
}

async function patchRoot(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;
  let html = await response.text();
  if (!html.includes(MARKER)) html = html.replace('</body>', `${bootstrap()}\n</body>`);
  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set('x-freqbeacon-sdr-packet-cadence', MARKER);
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function patchPlayerAudioCleanup(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;
  let source = await response.text();

  const oldEnded = "    source.addEventListener('ended', () => sdr.scheduledSources?.delete(source), { once: true });\n    source.connect(sdr.analyser);";
  const newEnded = "    source.addEventListener('ended', () => {\n      try { source.disconnect(); } catch {}\n      sdr.scheduledSources?.delete(source);\n    }, { once: true });\n    source.connect(sdr.analyser);";
  source = source.replace(oldEnded, newEnded);

  const oldQueuedCleanup = "        try { scheduledSource.stop(); } catch {}\n      }\n      sdr.scheduledSources.clear();";
  const newQueuedCleanup = "        try { scheduledSource.stop(); } catch {}\n        try { scheduledSource.disconnect(); } catch {}\n      }\n      sdr.scheduledSources.clear();";
  source = source.replace(oldQueuedCleanup, newQueuedCleanup);

  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/javascript; charset=utf-8');
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set('x-freqbeacon-sdr-audio-cleanup',
    source.includes('try { source.disconnect(); } catch {}')
    && source.includes('try { scheduledSource.disconnect(); } catch {}')
      ? AUDIO_CLEANUP_MARKER
      : 'audio-cleanup-patch-miss');
  return new Response(source, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await baseWorker.fetch(request, env, ctx);
    if (request.method === 'GET' && url.pathname === '/sdr-player.js') {
      return patchPlayerAudioCleanup(response);
    }
    if (
      request.method === 'GET'
      && (url.pathname === '/' || url.pathname === '/index.html')
      && url.searchParams.get('sdraudio') === '2'
    ) {
      return patchRoot(response);
    }
    return response;
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(event, env, ctx);
  }
};