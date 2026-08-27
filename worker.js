import baseWorker from './worker-v2.js';

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

function applyFreqBeaconBrand(html) {
  let branded = html
    .replaceAll('Signal Scout', 'FreqBeacon')
    .replace(
      'FreqBeacon helps radio listeners find shortwave, medium-wave, and amateur radio signals and bands they may be able to hear right now.',
      'FreqBeacon helps radio listeners discover shortwave, medium-wave, longwave, and amateur radio signals, then explore them with live remote SDR spectrum and audio.'
    )
    .replace('<title>FreqBeacon — What can I hear?</title>', '<title>FREQBEACON — Explore the airwaves.</title>')
    .replace('<h1>FreqBeacon</h1>', '<h1>FREQBEACON</h1>')
    .replace('<p>What can I hear?</p>', '<p>Explore the airwaves.</p>');

  if (!branded.includes('freqbeacon-brand.css')) {
    branded = branded.replace(
      '<link rel="stylesheet" href="arctic-slate-controls.css?v=1" />',
      '<link rel="stylesheet" href="arctic-slate-controls.css?v=1" />\n  <link rel="stylesheet" href="freqbeacon-brand.css?v=1" />'
    );
  }

  if (!branded.includes('freqbeacon-logo.svg')) {
    branded = branded.replace(
      '<link rel="manifest" href="manifest.json" />',
      '<link rel="manifest" href="manifest.json" />\n  <link rel="icon" type="image/svg+xml" href="freqbeacon-logo.svg" />'
    );
  }

  if (!branded.includes('freqbeacon-brand.js')) {
    branded = branded.replace(
      '<script src="stations.js"></script>',
      '<script src="freqbeacon-brand.js?v=1"></script>\n  <script src="stations.js"></script>'
    );
  }

  return branded;
}

export default {
  async fetch(request, env, ctx) {
    const response = await baseWorker.fetch(request, env, ctx);
    if (request.method !== 'GET') return response;

    const url = new URL(request.url);
    const contentType = String(response.headers.get('content-type') || '');

    // Serve corrected SDR runtime code directly. WebSocket URLs use ws:/wss:
    // while the page uses http:/https:, so comparing URL.origin rejects a
    // same-host SDR socket even though it belongs to FreqBeacon. Compare the
    // host + endpoint path instead and keep the original WebSocket URL intact.
    if (SDR_RUNTIME_ASSETS.has(url.pathname) && /javascript|text\/plain/.test(contentType)) {
      const source = await response.text();
      const patched = patchSdrOriginChecks(source);
      const headers = noStoreHeaders(response);
      headers.set('content-type', 'application/javascript; charset=utf-8');
      headers.set('x-signal-scout-sdr-runtime', 'origin-host-fix-v1');
      headers.set('x-freqbeacon-brand', 'v1');
      return new Response(patched, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
    }

    // Force browsers to request corrected runtime assets and the FreqBeacon
    // brand layer instead of reusing superseded cached copies.
    if ((url.pathname === '/' || url.pathname === '/index.html') && contentType.includes('text/html')) {
      let html = await response.text();
      html = html
        .replace('sdr-rf-v2.js?v=5', 'sdr-rf-v2.js?v=6')
        .replace('sdr-health.js?v=2', 'sdr-health.js?v=3')
        .replace('sdr-tuning.js?v=1', 'sdr-tuning-v3.js?v=1')
        .replace('sdr-live-reliability.js?v=1', 'sdr-live-reliability-v2.js?v=1');
      html = applyFreqBeaconBrand(html);
      const headers = noStoreHeaders(response);
      headers.set('content-type', 'text/html; charset=utf-8');
      headers.set('x-signal-scout-sdr-runtime', 'origin-host-fix-v1');
      headers.set('x-freqbeacon-brand', 'v1');
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
