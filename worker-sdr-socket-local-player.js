import baseWorker from './worker-sdr-mainthread-relief.js';

const MARKER = 'sdr-socket-local-player-v1';

function textResponse(response, source, contentType, headerName, headerValue) {
  const headers = new Headers(response.headers);
  headers.set('content-type', contentType);
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set(headerName, headerValue);
  return new Response(source, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function patchPlayer(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;

  const source = await response.text();
  let patched = source;

  const oldSendBlock = `  function sendSocket(message) {
    if (sdr.socket?.readyState === WebSocket.OPEN) sdr.socket.send(message);
  }

  function sendTuning() {
    if (!Number.isFinite(sdr.frequency)) return;
    const mode = PASSBANDS[sdr.mode] ? sdr.mode : 'am';
    const [lowCut, highCut] = PASSBANDS[mode];
    sendSocket(\`SET mod=\${mode} low_cut=\${lowCut} high_cut=\${highCut} freq=\${sdr.frequency.toFixed(3)}\`);
  }

  function configureSdr() {
    if (sdr.configured) return;
    sdr.configured = true;
    sendSocket('SET ident_user=Signal Scout');
    sendTuning();
    sendSocket('SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50');
    sendSocket('SET compression=0');
    sendSocket('SET squelch=0 max=0');
    sendSocket('SET genattn=0');
    sendSocket('SET gen=0 mix=-1');
    sendSocket('SET de_emp=0');
  }`;

  const newSendBlock = `  function sendSocket(message, targetSocket = sdr.socket) {
    if (targetSocket?.readyState !== 1) return false;
    try {
      targetSocket.send(message);
      return true;
    } catch {
      return false;
    }
  }

  function sendTuning(targetSocket = sdr.socket) {
    if (!Number.isFinite(sdr.frequency)) return;
    const mode = PASSBANDS[sdr.mode] ? sdr.mode : 'am';
    const [lowCut, highCut] = PASSBANDS[mode];
    sendSocket(\`SET mod=\${mode} low_cut=\${lowCut} high_cut=\${highCut} freq=\${sdr.frequency.toFixed(3)}\`, targetSocket);
  }

  function configureSdr(targetSocket = sdr.socket) {
    if (!targetSocket || sdr.configuredSocket === targetSocket) return;
    sdr.configuredSocket = targetSocket;
    sdr.configured = true;
    sendSocket('SET ident_user=FREQBEACON', targetSocket);
    sendTuning(targetSocket);
    sendSocket('SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50', targetSocket);
    sendSocket('SET compression=0', targetSocket);
    sendSocket('SET squelch=0 max=0', targetSocket);
    sendSocket('SET genattn=0', targetSocket);
    sendSocket('SET gen=0 mix=-1', targetSocket);
    sendSocket('SET de_emp=0', targetSocket);
  }`;

  patched = patched.replace(oldSendBlock, newSendBlock);
  patched = patched.replace(
    '  function parseKiwiMessage(bytes) {\n    if (bytes.byteLength < 4) return;',
    '  function parseKiwiMessage(bytes, sourceSocket = sdr.socket) {\n    if (sourceSocket && sourceSocket !== sdr.socket) return;\n    if (bytes.byteLength < 4) return;'
  );
  patched = patched.replace('        configureSdr();', '        configureSdr(sourceSocket);');
  patched = patched.replace(
    '        sendSocket(`SET AR OK in=${arInputRate} out=${arOutputRate}`);',
    '        sendSocket(`SET AR OK in=${arInputRate} out=${arOutputRate}`, sourceSocket);'
  );
  patched = patched.replace(
    "        sendSocket(`SET AR OK in=${Number(audioRate)} out=${Math.round(sdr.audioContext.sampleRate)}`);",
    "        sendSocket(`SET AR OK in=${Number(audioRate)} out=${Math.round(sdr.audioContext.sampleRate)}`, sourceSocket);"
  );
  patched = patched.replace(
    "    if ((flags & 0x10) !== 0) {\n      sendSocket('SET compression=0');\n      return;\n    }",
    "    if ((flags & 0x10) !== 0) {\n      sendSocket('SET compression=0', sourceSocket);\n      return;\n    }"
  );
  patched = patched.replace(
    "    socket.onopen = () => {\n      sendSocket('SET auth t=kiwi p=#');\n      sdr.keepaliveTimer = window.setInterval(() => sendSocket('SET keepalive'), 5000);\n    };",
    "    socket.onopen = () => {\n      sendSocket('SET auth t=kiwi p=#', socket);\n      sdr.keepaliveTimer = window.setInterval(() => {\n        if (sdr.socket === socket) sendSocket('SET keepalive', socket);\n      }, 5000);\n    };"
  );
  patched = patched.replace(
    "      if (event.data instanceof ArrayBuffer) parseKiwiMessage(new Uint8Array(event.data));\n      else if (event.data instanceof Blob) event.data.arrayBuffer().then((buffer) => parseKiwiMessage(new Uint8Array(buffer))).catch(() => {});\n      else if (typeof event.data === 'string') parseKiwiMessage(new TextEncoder().encode(event.data));",
    "      if (event.data instanceof ArrayBuffer) parseKiwiMessage(new Uint8Array(event.data), socket);\n      else if (event.data instanceof Blob) event.data.arrayBuffer().then((buffer) => parseKiwiMessage(new Uint8Array(buffer), socket)).catch(() => {});\n      else if (typeof event.data === 'string') parseKiwiMessage(new TextEncoder().encode(event.data), socket);"
  );
  patched = patched.replace(
    '    sdr.configured = false;\n    sdr.gotAudio = false;',
    '    sdr.configured = false;\n    sdr.configuredSocket = null;\n    sdr.gotAudio = false;'
  );

  const applied = patched !== source
    && patched.includes('function sendSocket(message, targetSocket = sdr.socket)')
    && patched.includes('configureSdr(sourceSocket)')
    && patched.includes('out=${arOutputRate}`, sourceSocket)')
    && patched.includes("sendSocket('SET auth t=kiwi p=#', socket)")
    && patched.includes('parseKiwiMessage(new Uint8Array(event.data), socket)');

  return textResponse(
    response,
    patched,
    'application/javascript; charset=utf-8',
    'x-freqbeacon-sdr-socket-local',
    applied ? MARKER : 'player-patch-miss'
  );
}

async function patchRoot(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;
  const source = await response.text();
  const html = source.replace(/sdr-player\.js\?v=\d+/g, 'sdr-player.js?v=14');
  return textResponse(
    response,
    html,
    'text/html; charset=utf-8',
    'x-freqbeacon-sdr-socket-local',
    MARKER
  );
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await baseWorker.fetch(request, env, ctx);

    if (request.method === 'GET' && url.pathname === '/sdr-player.js') return patchPlayer(response);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return patchRoot(response);
    return response;
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(event, env, ctx);
  }
};
