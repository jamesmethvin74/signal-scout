import baseWorker from './worker-sdr-directory-fast.js';

const HEALTH_CAPTURE_MARKER = 'freqbeacon-health-fetch-restore-v1';

function patchedJsResponse(response, source, marker) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/javascript; charset=utf-8');
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set('x-freqbeacon-forensics-v4', marker);
  return new Response(source, { status: response.status, statusText: response.statusText, headers });
}

function instrumentSdrPlayer(source) {
  let out = source;
  const hook = (event, detail = '{}') => `window.__freqbeaconForensics?.('${event}', ${detail});`;

  out = out.replace(
    "  function openReceiverChooser() {\n    renderReceiverChooser();",
    `  function openReceiverChooser() {\n    ${hook('player-open-chooser-enter', "{receiverCount:sdr.receivers.length,receiverIndex:sdr.receiverIndex,recommendationFrequency:sdr.recommendationFrequency}")}\n    renderReceiverChooser();`
  );
  out = out.replace(
    "    chooser.hidden = false;\n    const selected = chooser.querySelector('.sdr-choice.is-selected');",
    `    chooser.hidden = false;\n    ${hook('player-chooser-visible', "{hidden:chooser.hidden,choiceCount:chooser.querySelectorAll('.sdr-choice').length,receiverCount:sdr.receivers.length}")}\n    const selected = chooser.querySelector('.sdr-choice.is-selected');`
  );

  out = out.replace(
`    button.addEventListener('click', async () => {
      if (!sdr.panel?.hidden && Number.isFinite(sdr.frequency)) {
        openReceiverChooser();
        return;
      }
      await refreshLookupRecommendations({ force: true });
      openReceiverChooser();
    });`,
`    button.addEventListener('click', async () => {
      ${hook('player-lookup-click-enter', "{panelHidden:sdr.panel?.hidden,currentFrequency:sdr.frequency,lookupFrequency:document.getElementById('lookupFrequency')?.value||''}")}
      if (!sdr.panel?.hidden && Number.isFinite(sdr.frequency)) {
        ${hook('player-lookup-open-existing-player', "{receiverCount:sdr.receivers.length,receiverIndex:sdr.receiverIndex}")}
        openReceiverChooser();
        return;
      }
      const lookupRankOk = await refreshLookupRecommendations({ force: true });
      ${hook('player-lookup-rank-return', "{ok:lookupRankOk,receiverCount:sdr.receivers.length,receiverIndex:sdr.receiverIndex,recommendationFrequency:sdr.recommendationFrequency}")}
      openReceiverChooser();
    });`
  );

  out = out.replace(
    "  async function refreshReceiverRecommendations({ frequency, container = null, force = false } = {}) {\n    if (!Number.isFinite(frequency) || frequency < 10 || frequency > 30000) return false;",
    `  async function refreshReceiverRecommendations({ frequency, container = null, force = false } = {}) {\n    ${hook('player-rank-enter', "{frequency,force,currentRecommendation:sdr.recommendationFrequency,currentReceiverCount:sdr.receivers.length,manualReceiverId:sdr.manualReceiverId||''}")}\n    if (!Number.isFinite(frequency) || frequency < 10 || frequency > 30000) return false;`
  );
  out = out.replace(
    "      const payload = await response.json();\n      if (sequence !== sdr.recommendationSequence) return false;",
    `      const payload = await response.json();\n      ${hook('player-rank-json', "{frequency,status:response.status,receiverCount:Array.isArray(payload?.receivers)?payload.receivers.length:0,source:payload?.source||'',sequence,currentSequence:sdr.recommendationSequence}")}\n      if (sequence !== sdr.recommendationSequence) { ${hook('player-rank-stale-return', "{sequence,currentSequence:sdr.recommendationSequence}")} return false; }`
  );
  out = out.replace(
    "      renderReceiverButton();\n      rewriteLookupLiveNotes();\n      return true;",
    `      renderReceiverButton();\n      rewriteLookupLiveNotes();\n      ${hook('player-rank-applied', "{frequency,receiverCount:sdr.receivers.length,receiverIndex:sdr.receiverIndex,receiverId:sdr.receivers[sdr.receiverIndex]?.id||'',manualReceiverId:sdr.manualReceiverId||''}")}\n      return true;`
  );
  out = out.replace(
    "    } catch (error) {\n      if (sequence !== sdr.recommendationSequence) return false;\n      sdr.receivers = LEGACY_RECEIVERS.map((receiver) => ({ ...receiver }));",
    `    } catch (error) {\n      ${hook('player-rank-error', "{frequency,name:error?.name||'',message:error?.message||String(error),sequence,currentSequence:sdr.recommendationSequence}")}\n      if (sequence !== sdr.recommendationSequence) return false;\n      sdr.receivers = LEGACY_RECEIVERS.map((receiver) => ({ ...receiver }));`
  );

  out = out.replace(
    "  async function startPlayer({ frequency, station, mode = 'am', container = null }) {\n    if (!Number.isFinite(frequency) || frequency < 10 || frequency > 30000) return;",
    `  async function startPlayer({ frequency, station, mode = 'am', container = null }) {\n    ${hook('player-start-enter', "{frequency,station,mode,containerClass:container?.className||''}")}\n    if (!Number.isFinite(frequency) || frequency < 10 || frequency > 30000) return;`
  );
  out = out.replace(
`    // Create/resume Web Audio while still inside the user's click gesture. The
    // directory lookup can then finish without Android/iOS blocking playback.
    try {
      await ensureAudioContext();
    } catch (error) {
      setStatus('Audio blocked', false);
      setMessage(error.message || 'Could not start audio.', true);
      return;
    }

    await refreshReceiverRecommendations({ frequency, container, force: true });
    if (sdr.manualStop || sdr.panel?.hidden || sdr.frequency !== frequency) return;
    updatePlayerReadout();
    connectSdr(sdr.receiverIndex);`,
`    // Create/resume Web Audio while still inside the user's click gesture. The
    // directory lookup can then finish without Android/iOS blocking playback.
    try {
      await ensureAudioContext();
      ${hook('player-audio-ready', "{state:sdr.audioContext?.state||'',sampleRate:sdr.audioContext?.sampleRate||0}")}
    } catch (error) {
      ${hook('player-audio-error', "{name:error?.name||'',message:error?.message||String(error)}")}
      setStatus('Audio blocked', false);
      setMessage(error.message || 'Could not start audio.', true);
      return;
    }

    const startRankOk = await refreshReceiverRecommendations({ frequency, container, force: true });
    ${hook('player-start-rank-return', "{ok:startRankOk,manualStop:sdr.manualStop,panelHidden:sdr.panel?.hidden,currentFrequency:sdr.frequency,requestedFrequency:frequency,receiverCount:sdr.receivers.length,receiverIndex:sdr.receiverIndex}")}
    if (sdr.manualStop || sdr.panel?.hidden || sdr.frequency !== frequency) {
      ${hook('player-start-guard-return', "{manualStop:sdr.manualStop,panelHidden:sdr.panel?.hidden,currentFrequency:sdr.frequency,requestedFrequency:frequency}")}
      return;
    }
    updatePlayerReadout();
    ${hook('player-before-connect', "{receiverIndex:sdr.receiverIndex,receiverId:sdr.receivers[sdr.receiverIndex]?.id||'',receiverCount:sdr.receivers.length}")}
    connectSdr(sdr.receiverIndex);`
  );

  out = out.replace(
    "  async function connectSdr(receiverIndex) {\n    if (!Number.isFinite(sdr.frequency)) return;\n    disconnectSocket();",
    `  async function connectSdr(receiverIndex) {\n    ${hook('player-connect-enter', "{receiverIndex,currentFrequency:sdr.frequency,receiverCount:sdr.receivers.length,manualStop:sdr.manualStop}")}\n    if (!Number.isFinite(sdr.frequency)) { ${hook('player-connect-invalid-frequency', "{currentFrequency:sdr.frequency}")} return; }\n    disconnectSocket();`
  );
  out = out.replace(
`    try {
      await ensureAudioContext();
    } catch (error) {
      setStatus('Audio blocked', false);
      setMessage(error.message || 'Could not start audio.', true);
      return;
    }

    let socket;
    try {
      socket = new WebSocket(websocketUrl(sdr.receiverIndex));
      socket.binaryType = 'arraybuffer';
    } catch {
      failCurrentReceiver('Could not open the receiver stream. Trying the next ranked receiver…');
      return;
    }`,
`    try {
      await ensureAudioContext();
      ${hook('player-connect-audio-ready', "{state:sdr.audioContext?.state||'',receiverIndex:sdr.receiverIndex}")}
    } catch (error) {
      ${hook('player-connect-audio-error', "{name:error?.name||'',message:error?.message||String(error)}")}
      setStatus('Audio blocked', false);
      setMessage(error.message || 'Could not start audio.', true);
      return;
    }

    let socket;
    try {
      const diagnosticWsUrl = websocketUrl(sdr.receiverIndex);
      ${hook('player-websocket-create-attempt', "{receiverIndex:sdr.receiverIndex,receiverId:sdr.receivers[sdr.receiverIndex]?.id||'',url:diagnosticWsUrl}")}
      socket = new WebSocket(diagnosticWsUrl);
      socket.binaryType = 'arraybuffer';
    } catch (error) {
      ${hook('player-ws-constructor-error', "{name:error?.name||'',message:error?.message||String(error)}")}
      failCurrentReceiver('Could not open the receiver stream. Trying the next ranked receiver…');
      return;
    }`
  );

  out = out.replace(
    "    event.preventDefault();\n    event.stopImmediatePropagation();\n    startPlayer({",
    `    event.preventDefault();\n    event.stopImmediatePropagation();\n    ${hook('player-listen-click', "{frequency,station:stationFromContainer(container),mode:modeFromContainer(container),targetTag:link.tagName,targetHref:link.getAttribute('href')||''}")}\n    startPlayer({`
  );

  return out;
}

function patchRootHtml(response, url) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;

  return response.text().then((html) => {
    const diagnosticV4 = url.searchParams.get('sdrtest') === '2';
    if (diagnosticV4 && !html.includes('sdr-forensics-v4.js')) {
      html = html.replace('<head>', '<head>\n  <script src="/sdr-forensics-v4.js?v=1"></script>');
      html = html.replace(/sdr-player\.js\?v=\d+(?:&sdrdiag=\d+)?/g, 'sdr-player.js?v=5&sdrdiag=4');
    }

    if (!html.includes(HEALTH_CAPTURE_MARKER)) {
      html = html.replace(
        /<script\s+src="\/?sdr-health\.js\?v=\d+"><\/script>/i,
        `<script>window.__freqbeaconReceiverFetchBeforeHealth=window.fetch;window.__freqbeaconHealthFetchMarker='${HEALTH_CAPTURE_MARKER}';</script>\n  <script src="/sdr-health.js?v=6"></script>\n  <script>if(window.__freqbeaconReceiverFetchBeforeHealth){window.fetch=window.__freqbeaconReceiverFetchBeforeHealth;}window.__freqbeaconHealthFetchRestored=true;</script>`
      );
    }

    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-health-fetch-path', HEALTH_CAPTURE_MARKER);
    if (diagnosticV4) headers.set('x-freqbeacon-forensics-v4', 'early-trace-player-hooks-v1');
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await baseWorker.fetch(request, env, ctx);
    if (request.method === 'GET' && url.pathname === '/sdr-player.js' && url.searchParams.get('sdrdiag') === '4') {
      const contentType = String(response.headers.get('content-type') || '');
      if (/javascript|text\/plain/.test(contentType)) {
        const source = await response.text();
        return patchedJsResponse(response, instrumentSdrPlayer(source), 'player-checkpoints-v4');
      }
    }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return patchRootHtml(response, url);
    }
    return response;
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') {
      return baseWorker.scheduled(event, env, ctx);
    }
  }
};
