import baseWorker from './worker-sdr-mainthread-relief.js';

const MARKER = 'sdr-direct-native-handshake-v1';

function jsResponse(response, source, applied) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/javascript; charset=utf-8');
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set('x-freqbeacon-sdr-handshake', applied ? MARKER : 'handshake-patch-miss');
  return new Response(source, { status: response.status, statusText: response.statusText, headers });
}

async function patchPlayer(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!/javascript|text\/plain/.test(contentType)) return response;
  const source = await response.text();

  const oldConfigure = `  function configureSdr() {
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

  const newConfigure = `  function configureSdr() {
    const socket = sdr.socket;
    if (!socket || socket.readyState !== 1 || !Number.isFinite(sdr.frequency)) return false;
    const mode = PASSBANDS[sdr.mode] ? sdr.mode : 'am';
    const [lowCut, highCut] = PASSBANDS[mode];
    const arInputRate = Math.max(1, Math.round(Number(sdr.sampleRate) || 12000));
    const arOutputRate = Math.max(1, Math.round(Number(sdr.audioContext?.sampleRate) || 48000));
    const commands = [
      'SET ident_user=FREQBEACON',
      \`SET mod=\${mode} low_cut=\${lowCut} high_cut=\${highCut} freq=\${sdr.frequency.toFixed(3)}\`,
      'SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50',
      'SET compression=0',
      'SET squelch=0 max=0',
      'SET genattn=0',
      'SET gen=0 mix=-1',
      'SET de_emp=0',
      \`SET AR OK in=\${arInputRate} out=\${arOutputRate}\`
    ];
    try {
      commands.forEach((command) => socket.send(command));
      sdr.configured = true;
      return true;
    } catch {
      sdr.configured = false;
      return false;
    }
  }`;

  const patched = source.replace(oldConfigure, newConfigure);
  return jsResponse(response, patched, patched !== source && patched.includes("'SET ident_user=FREQBEACON'") && patched.includes('socket.readyState !== 1'));
}

async function patchRoot(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;
  const html = (await response.text()).replace(/sdr-player\.js\?v=\d+/g, 'sdr-player.js?v=13');
  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('cache-control', 'no-store, max-age=0');
  headers.set('x-freqbeacon-sdr-handshake', MARKER);
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
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
