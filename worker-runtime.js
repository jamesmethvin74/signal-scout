import sdrWorker from './worker-v2.js';
import programWorker from './worker-program-v15.js';

// FREQBEACON production Worker.
//
// Static HTML/JS/CSS/assets are intentionally NOT rewritten here. Cloudflare
// serves those files directly from the asset binding. The Worker owns only
// server responsibilities: APIs, ReceiverBook-backed SDR discovery, the proven
// KiwiSDR WebSocket proxy, and scheduled program-source refreshes.
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

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
