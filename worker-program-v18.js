import baseWorker from './worker-program-v17.js';
import { ReceiverHealthStore } from './receiver-health-store.js';
import {
  handleExploreApi,
  handleExploreZeroRequest,
  runExploreHealthCycle,
  selectedExploreReceiverId
} from './receiver-health.js';

export { ReceiverHealthStore };

function injectExploreNav(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;
  return response.text().then((source) => {
    let html = source;
    if (!html.includes('href="/explore"')) {
      html = html.replace(
        '<a class="zero-app-action" href="/lookup.html">LOOKUP</a>',
        '<a class="zero-app-action" href="/explore">EXPLORE</a>\n        <a class="zero-app-action" href="/lookup.html">LOOKUP</a>'
      );
    }
    const headers = new Headers(response.headers);
    headers.set('content-type', 'text/html; charset=utf-8');
    headers.set('cache-control', 'no-store, max-age=0');
    headers.set('x-freqbeacon-primary-nav', 'radio-explore-lookup-v1');
    return new Response(html, { status: response.status, statusText: response.statusText, headers });
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/explore/')) {
      return handleExploreApi(request, env);
    }

    if (url.pathname.startsWith('/api/zero/') && selectedExploreReceiverId(request)) {
      const exploreResponse = await handleExploreZeroRequest(request, env);
      if (exploreResponse) return exploreResponse;
    }

    if (request.method === 'GET' && (url.pathname === '/explore' || url.pathname === '/explore/')) {
      const exploreUrl = new URL('/explore.html', request.url);
      return env.ASSETS.fetch(new Request(exploreUrl.toString(), { method: 'GET', headers: request.headers }));
    }

    const response = await baseWorker.fetch(request, env, ctx);
    if (request.method === 'GET' && (url.pathname === '/zero' || url.pathname === '/zero/')) {
      return injectExploreNav(response);
    }
    return response;
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') {
      await baseWorker.scheduled(event, env, ctx);
    }
    try {
      const result = await runExploreHealthCycle(env);
      console.log('FREQBEACON explore health cycle', JSON.stringify({
        discovered: result.discovered,
        tested: result.tested
      }));
    } catch (error) {
      // Explore health is additive background work. It must never interrupt
      // FREQBEACON's existing scheduled program/schedule refresh duties.
      console.warn('FREQBEACON explore health cycle failed', error?.message || error);
    }
  }
};
