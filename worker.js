import baseWorker from './worker-v2.js';
import { programGuideResponse } from './program-guide-worker.js';

const SDR_RUNTIME_ASSETS = new Set(['/sdr-rf-v2.js', '/sdr-health.js']);
let startupArtDataUriCache = null;

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

async function startupArtDataUri(request, env) {
  if (startupArtDataUriCache) return startupArtDataUriCache;
  try {
    const assetUrl = new URL('/freqbeacon-startup.webp', request.url);
    const assetResponse = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: 'GET' }));
    if (!assetResponse.ok) return '/freqbeacon-startup.webp?v=2';

    const bytes = new Uint8Array(await assetResponse.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    startupArtDataUriCache = `data:image/webp;base64,${btoa(binary)}`;
    return startupArtDataUriCache;
  } catch {
    return '/freqbeacon-startup.webp?v=2';
  }
}

function applyFreqBeaconBrand(html, startupSrc) {
  let branded = html
    .replaceAll('Signal Scout', 'FreqBeacon')
    .replace(
      'FreqBeacon helps radio listeners find shortwave, medium-wave, and amateur radio signals and bands they may be able to hear right now.',
      'FreqBeacon helps radio listeners discover shortwave, medium-wave, longwave, and amateur radio signals, then explore them with live remote SDR spectrum and audio.'
    )
    .replace('<title>FreqBeacon — What can I hear?</title>', '<title>FREQBEACON — Explore the airwaves.</title>')
    .replace('<h1>FreqBeacon</h1>', '<h1>FREQBEACON</h1>')
    .replace('<p>What can I hear?</p>', '<p>Explore the airwaves.</p>')
    .replace('freqbeacon-brand.css?v=1', 'freqbeacon-brand.css?v=3')
    .replace('freqbeacon-brand.css?v=2', 'freqbeacon-brand.css?v=3')
    .replace('freqbeacon-brand.js?v=1', 'freqbeacon-brand.js?v=5')
    .replace('freqbeacon-brand.js?v=3', 'freqbeacon-brand.js?v=5')
    .replace('freqbeacon-brand.js?v=4', 'freqbeacon-brand.js?v=5');

  if (!branded.includes('freqbeacon-brand.css')) {
    branded = branded.replace(
      '<link rel="stylesheet" href="arctic-slate-controls.css?v=1" />',
      '<link rel="stylesheet" href="arctic-slate-controls.css?v=1" />\n  <link rel="stylesheet" href="freqbeacon-brand.css?v=3" />'
    );
  }

  if (!branded.includes('freqbeacon-logo.svg')) {
    branded = branded.replace(
      '<link rel="manifest" href="manifest.json" />',
      '<link rel="manifest" href="manifest.json" />\n  <link rel="icon" type="image/svg+xml" href="freqbeacon-logo.svg" />'
    );
  }

  if (!branded.includes('class="freqbeacon-splash__art"')) {
    branded = branded.replace(
      '<div class="freqbeacon-splash" aria-hidden="true">',
      `<div class="freqbeacon-splash" aria-hidden="true" style="position:fixed;inset:0;z-index:99999;display:block;overflow:hidden;background:#07111f;opacity:1;visibility:visible">\n    <img class="freqbeacon-splash__art" src="${startupSrc}" alt="" aria-hidden="true" decoding="sync" style="position:absolute;inset:0;z-index:1;width:100%;height:100%;display:block;object-fit:contain;object-position:center;background:#07111f" />`
    );
  }

  if (!branded.includes('freqbeacon-brand.js')) {
    branded = branded.replace(
      '<script src="stations.js"></script>',
      '<script src="freqbeacon-brand.js?v=5"></script>\n  <script src="stations.js"></script>'
    );
  }

  return branded;
}

function applyProgramGuideRuntime(html) {
  if (html.includes('program-guide.js')) return html;
  return html.replace(
    '</body>',
    '  <script src="program-guide.js?v=1"></script>\n</body>'
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

    if ((url.pathname === '/' || url.pathname === '/index.html') && contentType.includes('text/html')) {
      let html = await response.text();
      html = html
        .replace('sdr-rf-v2.js?v=5', 'sdr-rf-v2.js?v=6')
        .replace('sdr-health.js?v=2', 'sdr-health.js?v=3')
        .replace('sdr-tuning.js?v=1', 'sdr-tuning-v3.js?v=1')
        .replace('sdr-live-reliability.js?v=1', 'sdr-live-reliability-v2.js?v=1');
      const startupSrc = await startupArtDataUri(request, env);
      html = applyFreqBeaconBrand(html, startupSrc);
      html = applyProgramGuideRuntime(html);
      const headers = noStoreHeaders(response);
      headers.set('content-type', 'text/html; charset=utf-8');
      headers.set('x-signal-scout-sdr-runtime', 'origin-host-fix-v1');
      headers.set('x-freqbeacon-brand', 'v4');
      headers.set('x-freqbeacon-program-guide', 'v1');
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
// Deployment marker: bust cached branding runtime so approved startup artwork loads.
// Deployment marker: inject approved startup artwork directly into Worker-served HTML.
// Deployment marker: inline approved startup artwork so Android PWA first paint cannot miss it.
