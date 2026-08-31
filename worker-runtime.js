import sdrWorker from './worker-v2.js';
import { probeSdrTransport } from './sdr-transport-probe-worker.js';
import programWorker from './worker-program-v15.js';

// FREQBEACON production Worker.
// Static HTML/JS/CSS/assets are served directly. The Worker owns only APIs,
// SDR WebSocket transport, and scheduled program-source refreshes.
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/sdr/probe') {
      return probeSdrTransport(request);
    }

    if (url.pathname.startsWith('/api/sdr/')) {
      return sdrWorker.fetch(request, env, ctx);
    }

    if (url.pathname === '/api/program-guide'
      || url.pathname.startsWith('/api/program-guide/')
      || url.pathname === '/api/ham-activity') {
      return programWorker.fetch(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    if (typeof programWorker.scheduled === 'function') {
      return programWorker.scheduled(event, env, ctx);
    }
  }
};
