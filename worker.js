import baseWorker from './worker-v2.js';
import { programGuideResponse } from './program-guide-worker.js';

const SDR_RUNTIME_ASSETS = new Set(['/sdr-rf-v2.js', '/sdr-health.js', '/sdr-early-trace.js', '/sdr-live-path-trace.js', '/sdr-live-reliability-v2.js']);

function noStoreHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store, max-age=0');
  return headers;
}

function patchSdrOriginChecks(source) {
  return source.replaceAll(
    'url.origin !== window.location.origin',
    'url.host !== window.location.host'
  );
}

function patchRfSpectrumPersistence(source) {
  if (!source.includes('function smoothSpectrumDb') || source.includes('function persistentSpectrumDb')) return source;

  let patched = source.replace(
    '    displayMaxDb: -55,\n',
    '    displayMaxDb: -55,\n    spectrumHistory: [],\n    spectrumHistoryMeta: \'\',\n'
  );

  patched = patched.replace(
    '  function smoothSpectrumDb(dbValues) {',
    `  function persistentSpectrumDb(dbValues) {
    const meta = dbValues.length + '|' + state.zoom + '|' + (Number.isFinite(state.centerKHz) ? state.centerKHz.toFixed(3) : '');
    if (state.spectrumHistoryMeta !== meta) {
      state.spectrumHistoryMeta = meta;
      state.spectrumHistory = [];
    }

    state.spectrumHistory.push(Float32Array.from(dbValues));
    if (state.spectrumHistory.length > 4) state.spectrumHistory.shift();

    if (state.spectrumHistory.length < 2) {
      const useful = dbValues
        .filter((value) => Number.isFinite(value) && value > -200 && value < 5)
        .sort((a, b) => a - b);
      const anchorDb = percentile(useful, 0.18) ?? -120;
      return dbValues.map((value) => Math.min(value, anchorDb + 2.4));
    }

    const filtered = new Array(dbValues.length);
    const samples = new Array(state.spectrumHistory.length);
    for (let i = 0; i < dbValues.length; i += 1) {
      for (let frame = 0; frame < state.spectrumHistory.length; frame += 1) {
        samples[frame] = state.spectrumHistory[frame][i];
      }
      samples.sort((a, b) => a - b);
      filtered[i] = samples[Math.max(0, samples.length - 2)];
    }
    return filtered;
  }

  function smoothSpectrumDb(dbValues) {`
  );

  patched = patched.replace(
    '    const spectrumDb = smoothSpectrumDb(db);\n',
    '    const spectrumDb = persistentSpectrumDb(smoothSpectrumDb(db));\n'
  );

  patched = patched.replace(
    '    state.requestedCompression = false;\n    if (ensureCanvas()) drawStage(reason);',
    '    state.requestedCompression = false;\n    state.spectrumHistory = [];\n    state.spectrumHistoryMeta = \'\';\n    if (ensureCanvas()) drawStage(reason);'
  );

  return patched;
}

function patchRfCarrierSignal(source) {
  if (!source.includes('function renderRfFrame(rawBins)') || source.includes('freqbeacon:rf-carrier')) return source;

  let patched = source.replace(
    '  function renderRfFrame(rawBins) {',
    `  function publishCarrierUnavailable(reason) {
    const mode = currentMode();
    if (mode !== 'am' && mode !== 'sam') return;
    if (!Number.isFinite(state.targetKHz)) return;
    const detail = {
      version: 'carrier-v1',
      receiverId: state.receiverId || '',
      targetKHz: state.targetKHz,
      prominenceDb: null,
      peakOffsetKHz: null,
      carrierPresent: false,
      stable: true,
      unavailable: true,
      reason: String(reason || 'RF waterfall unavailable'),
      at: Date.now()
    };
    window.__freqbeaconRfCarrier = detail;
    window.dispatchEvent(new CustomEvent('freqbeacon:rf-carrier', { detail }));
  }

  function publishCarrierSignal(dbValues) {
    const mode = currentMode();
    if ((mode !== 'am' && mode !== 'sam') || !dbValues?.length || !Number.isFinite(state.targetKHz)) return;
    const span = state.spanKHz || (state.fullBandwidthKHz / (2 ** state.zoom));
    const center = state.centerKHz ?? state.targetKHz;
    if (!Number.isFinite(span) || span <= 0 || !Number.isFinite(center)) return;

    const startKHz = center - span / 2;
    const binKHz = span / Math.max(1, dbValues.length - 1);
    if (!Number.isFinite(binKHz) || binKHz <= 0) return;
    const targetIndex = clamp(Math.round(((state.targetKHz - startKHz) / span) * (dbValues.length - 1)), 0, dbValues.length - 1);
    const carrierRadiusBins = Math.max(2, Math.round(0.35 / binKHz));
    const guardBins = Math.max(carrierRadiusBins + 2, Math.round(0.9 / binKHz));
    const noiseRadiusBins = Math.max(guardBins + 8, Math.round(4.0 / binKHz));

    let peakDb = -Infinity;
    let peakIndex = targetIndex;
    const carrierStart = Math.max(0, targetIndex - carrierRadiusBins);
    const carrierStop = Math.min(dbValues.length - 1, targetIndex + carrierRadiusBins);
    for (let i = carrierStart; i <= carrierStop; i += 1) {
      if (Number.isFinite(dbValues[i]) && dbValues[i] > peakDb) {
        peakDb = dbValues[i];
        peakIndex = i;
      }
    }

    const noise = [];
    const noiseStart = Math.max(0, targetIndex - noiseRadiusBins);
    const noiseStop = Math.min(dbValues.length - 1, targetIndex + noiseRadiusBins);
    for (let i = noiseStart; i <= noiseStop; i += 1) {
      if (Math.abs(i - targetIndex) <= guardBins) continue;
      if (Number.isFinite(dbValues[i])) noise.push(dbValues[i]);
    }
    if (noise.length < 16) {
      for (let i = 0; i < dbValues.length; i += 1) {
        if (Math.abs(i - targetIndex) <= guardBins) continue;
        if (Number.isFinite(dbValues[i])) noise.push(dbValues[i]);
      }
    }
    noise.sort((a, b) => a - b);
    const floorDb = percentile(noise, 0.50) ?? -120;
    const prominenceDb = Number.isFinite(peakDb) ? peakDb - floorDb : 0;
    const peakOffsetKHz = (peakIndex - targetIndex) * binKHz;
    const framePresent = prominenceDb >= 4.5 && Math.abs(peakOffsetKHz) <= 0.35;

    const key = (state.receiverId || '') + '|' + state.targetKHz.toFixed(3) + '|' + span.toFixed(3) + '|' + mode;
    if (state.carrierHistoryKey !== key) {
      state.carrierHistoryKey = key;
      state.carrierHistory = [];
    }
    state.carrierHistory.push({ prominenceDb, peakOffsetKHz, present: framePresent });
    if (state.carrierHistory.length > 8) state.carrierHistory.shift();

    const stable = state.carrierHistory.length >= 6;
    const presentVotes = state.carrierHistory.filter((sample) => sample.present).length;
    const prominenceSamples = state.carrierHistory.map((sample) => sample.prominenceDb).sort((a, b) => a - b);
    const stableProminenceDb = percentile(prominenceSamples, 0.50) ?? prominenceDb;
    const carrierPresent = stable
      ? presentVotes >= Math.ceil(state.carrierHistory.length * 0.60)
      : null;
    const detail = {
      version: 'carrier-v1',
      receiverId: state.receiverId || '',
      targetKHz: state.targetKHz,
      prominenceDb: Math.round(stableProminenceDb * 10) / 10,
      peakOffsetKHz: Math.round(peakOffsetKHz * 1000) / 1000,
      carrierPresent,
      stable,
      unavailable: false,
      sampleCount: state.carrierHistory.length,
      at: Date.now()
    };
    window.__freqbeaconRfCarrier = detail;
    window.dispatchEvent(new CustomEvent('freqbeacon:rf-carrier', { detail }));
  }

  function renderRfFrame(rawBins) {`
  );

  patched = patched.replace(
    '    const spectrumDb = persistentSpectrumDb(smoothSpectrumDb(db));\n',
    '    const spectrumDb = persistentSpectrumDb(smoothSpectrumDb(db));\n    publishCarrierSignal(spectrumDb);\n'
  );

  patched = patched.replace(
    '    if (playerAudioIsLive()) {\n      const prefix = error ? \'Actual receiver audio is live. \' : \'Actual receiver audio is live · \';',
    '    if (error && !state.hasFrame) publishCarrierUnavailable(detail || title);\n    if (playerAudioIsLive()) {\n      const prefix = error ? \'Actual receiver audio is live. \' : \'Actual receiver audio is live · \';'
  );

  patched = patched.replace(
    '    state.spectrumHistory = [];\n    state.spectrumHistoryMeta = \'\';\n    if (ensureCanvas()) drawStage(reason);',
    '    state.spectrumHistory = [];\n    state.spectrumHistoryMeta = \'\';\n    state.carrierHistory = [];\n    state.carrierHistoryKey = \'\';\n    if (ensureCanvas()) drawStage(reason);'
  );

  return patched;
}

function applyFreqBeaconBrand(html) {
  let branded = html
    .replaceAll('Signal Scout', 'FreqBeacon')
    .replace(
      'FreqBeacon helps radio listeners find shortwave, medium-wave, and amateur radio signals and bands they may be able to hear right now.',
      'FreqBeacon helps radio listeners discover shortwave, medium-wave, longwave, and amateur radio signals, then explore them with live remote SDR spectrum and audio.'
    )
    .replace('<title>FreqBeacon — What can I hear?</title>', '<title>FREQBEACON — Explore the airwaves.</title>')
    .replace('<h1>FreqBeacon</h1>', '<h1>FREQBEACON</h1>')
    .replace('<p>What can I hear?</p>', '<p>Explore the airwaves.</p>')
    .replace(/freqbeacon-brand\.css\?v=\d+/g, 'freqbeacon-brand.css?v=5')
    .replace(/freqbeacon-brand\.js\?v=\d+/g, 'freqbeacon-brand.js?v=13')
    .replace(/href="\/?(?:manifest\.json|freqbeacon\.webmanifest|manifest\.webmanifest)(?:\?v=\d+)?"/g, 'href="/manifest.webmanifest?v=1"');

  if (!branded.includes('freqbeacon-brand.css')) {
    branded = branded.replace(
      '<link rel="stylesheet" href="arctic-slate-controls.css?v=1" />',
      '<link rel="stylesheet" href="arctic-slate-controls.css?v=1" />\n  <link rel="stylesheet" href="freqbeacon-brand.css?v=5" />'
    );
  }

  if (!branded.includes('freqbeacon-startup-v3.avif')) {
    branded = branded.replace(
      '<link rel="manifest" href="/manifest.webmanifest?v=1" />',
      '<link rel="manifest" href="/manifest.webmanifest?v=1" />\n  <link rel="preload" href="freqbeacon-startup-v3.avif" as="image" type="image/avif" fetchpriority="high" />'
    );
  }

  if (!branded.includes('class="freqbeacon-splash__art"')) {
    branded = branded.replace(
      '<div class="freqbeacon-splash" aria-hidden="true">',
      '<div class="freqbeacon-splash" aria-hidden="true">\n    <img class="freqbeacon-splash__art" src="freqbeacon-startup-v3.avif" alt="" aria-hidden="true" fetchpriority="high" loading="eager" decoding="sync" />'
    );
  } else {
    branded = branded.replace(/src="freqbeacon-startup-v2\.webp"/g, 'src="freqbeacon-startup-v3.avif"');
  }

  if (!branded.includes('freqbeacon-brand.js')) {
    branded = branded.replace(
      '<script src="stations.js"></script>',
      '<script src="freqbeacon-brand.js?v=13"></script>\n  <script src="stations.js"></script>'
    );
  }

  return branded;
}

function applySdrTraceRuntime(html, url) {
  if (url.searchParams.get('sdrTrace') !== '1' || html.includes('sdr-live-path-trace.js?v=1')) return html;
  return html.replace(
    '<script src="freqbeacon-brand.js?v=13"></script>',
    '<script src="sdr-early-trace.js?v=4"></script>\n  <script src="sdr-live-path-trace.js?v=1"></script>\n  <script src="freqbeacon-brand.js?v=13"></script>'
  );
}

function applyProgramGuideRuntime(html) {
  if (html.includes('program-guide.js')) return html;
  return html.replace(
    '</body>',
    '  <script src="program-guide.js?v=3"></script>\n</body>'
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/program-guide') return programGuideResponse(request);

    const response = await baseWorker.fetch(request, env, ctx);
    if (request.method !== 'GET') return response;

    const contentType = String(response.headers.get('content-type') || '');

    if (SDR_RUNTIME_ASSETS.has(url.pathname) && /javascript|text\/plain/.test(contentType)) {
      const source = await response.text();
      let patched = patchSdrOriginChecks(source);
      if (url.pathname === '/sdr-rf-v2.js') {
        patched = patchRfSpectrumPersistence(patched);
        patched = patchRfCarrierSignal(patched);
      }
      if (url.pathname === '/sdr-early-trace.js') {
        patched = patched.replace("version: 'early-stream-timing-v1'", "version: 'early-stream-timing-v2'");
      }
      const headers = noStoreHeaders(response);
      headers.set('content-type', 'application/javascript; charset=utf-8');
      headers.set('x-signal-scout-sdr-runtime', 'origin-host-fix-v1');
      headers.set('x-freqbeacon-brand', 'v1');
      if (url.pathname === '/sdr-rf-v2.js') headers.set('x-freqbeacon-rf-profile', 'waterfall-persistence+carrier-v1');
      if (url.pathname === '/sdr-early-trace.js') headers.set('x-freqbeacon-sdr-trace', 'early-stream-timing-v2');
      if (url.pathname === '/sdr-live-path-trace.js') headers.set('x-freqbeacon-sdr-live-path-trace', 'v1');
      return new Response(patched, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    if ((url.pathname === '/' || url.pathname === '/index.html') && contentType.includes('text/html')) {
      let html = await response.text();
      html = html
        .replace(/sdr-rf-v2\.js\?v=\d+/, 'sdr-rf-v2.js?v=8')
        .replace('sdr-health.js?v=2', 'sdr-health.js?v=3')
        .replace('sdr-tuning.js?v=1', 'sdr-tuning-v3.js?v=2')
        .replace('sdr-live-reliability.js?v=1', 'sdr-live-reliability-v2.js?v=2');
      html = applyFreqBeaconBrand(html);
      html = applySdrTraceRuntime(html, url);
      html = applyProgramGuideRuntime(html);
      const headers = noStoreHeaders(response);
      headers.set('content-type', 'text/html; charset=utf-8');
      headers.set('x-signal-scout-sdr-runtime', 'origin-host-fix-v1');
      headers.set('x-freqbeacon-brand', 'v13');
      headers.set('x-freqbeacon-program-guide', 'v3');
      headers.set('x-freqbeacon-sdr-reliability-order', 'server-ranking-carrier-aware-v1');
      if (url.searchParams.get('sdrTrace') === '1') headers.set('x-freqbeacon-sdr-trace', 'live-path-v1');
      return new Response(html, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    return response;
  }
};

// Deployment marker: route the SDR runtime assets through the Worker so the origin fix is actually served.
// Deployment marker: publish interactive spectrum drag/tap tuning controls.
// Deployment marker: publish moving active-frequency cursor without re-centering the RF view on every tune.
// Deployment marker: fix recursive tuning-cursor MutationObserver freeze.
// Deployment marker: keep amateur SDR choices geographically relevant and fail over when W/F is unavailable.
// Deployment marker: launch FREQBEACON branding — Explore the airwaves.
// Deployment marker: add verified ON NOW / UP NEXT program identification.
// Deployment marker: preload startup art and hold splash only after the artwork has painted.
// Deployment marker: publish mode-aware 100 Hz SSB fine-tuning controls.
// Deployment marker: keep RF spectrum baseline tight in crowded bands and force the new renderer revision.
// Deployment marker: publish clean transparent launch icons and corrected startup artwork.
// Deployment marker: require repeat waterfall-bin energy before drawing tall RF spectrum peaks.
// Deployment marker: publish approved FREQBEACON launcher and startup artwork.
// Deployment marker: make FREQBEACON installable and harden moving-device location acquisition.
// Deployment marker: shorten startup, add PNG PWA fallbacks, and remove service-worker request interception.
// Deployment marker: lazy-load program-guide network work so Chrome reaches network idle and installability can settle.
// Deployment marker: converge every PWA manifest and service-worker path on one canonical identity.
// Deployment marker: trace real SDR sockets by host so WSS and HTTPS schemes do not hide them.
// Deployment marker: restore the known-good server-ranked Listen Live control plane and remove client-side receiver automation.
// Deployment marker: publish WBCQ official-schedule authority and keep card Receiver Options on server ranking.
// Deployment marker: require live center-frequency carrier evidence before accepting an automatic HF listening receiver.
