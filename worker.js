import baseWorker from './worker-v2.js';
import { programGuideResponse } from './program-guide-worker.js';

const SDR_RUNTIME_ASSETS = new Set(['/sdr-rf-v2.js', '/sdr-health.js']);

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
    .replace(/freqbeacon-brand\.js\?v=\d+/g, 'freqbeacon-brand.js?v=12')
    .replace(/href="manifest\.json(?:\?v=\d+)?"/g, 'href="manifest.json?v=6"');

  if (!branded.includes('freqbeacon-brand.css')) {
    branded = branded.replace(
      '<link rel="stylesheet" href="arctic-slate-controls.css?v=1" />',
      '<link rel="stylesheet" href="arctic-slate-controls.css?v=1" />\n  <link rel="stylesheet" href="freqbeacon-brand.css?v=5" />'
    );
  }

  if (!branded.includes('freqbeacon-startup-v3.avif')) {
    branded = branded.replace(
      '<link rel="manifest" href="manifest.json?v=6" />',
      '<link rel="manifest" href="manifest.json?v=6" />\n  <link rel="preload" href="freqbeacon-startup-v3.avif" as="image" type="image/avif" fetchpriority="high" />'
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
      '<script src="freqbeacon-brand.js?v=12"></script>\n  <script src="stations.js"></script>'
    );
  }

  return branded;
}

function applyProgramGuideRuntime(html) {
  if (html.includes('program-guide.js')) return html;
  return html.replace(
    '</body>',
    '  <script src="program-guide.js?v=2"></script>\n</body>'
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
      if (url.pathname === '/sdr-rf-v2.js') patched = patchRfSpectrumPersistence(patched);
      const headers = noStoreHeaders(response);
      headers.set('content-type', 'application/javascript; charset=utf-8');
      headers.set('x-signal-scout-sdr-runtime', 'origin-host-fix-v1');
      headers.set('x-freqbeacon-brand', 'v1');
      if (url.pathname === '/sdr-rf-v2.js') headers.set('x-freqbeacon-rf-profile', 'waterfall-persistence-v1');
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
        .replace('sdr-live-reliability.js?v=1', 'sdr-live-reliability-v2.js?v=1');
      html = applyFreqBeaconBrand(html);
      html = applyProgramGuideRuntime(html);
      const headers = noStoreHeaders(response);
      headers.set('content-type', 'text/html; charset=utf-8');
      headers.set('x-signal-scout-sdr-runtime', 'origin-host-fix-v1');
      headers.set('x-freqbeacon-brand', 'v12');
      headers.set('x-freqbeacon-program-guide', 'v2');
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
