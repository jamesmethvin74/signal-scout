import appWorker from './worker-program-v21.js';

const OFCOM_MF_URL = 'https://www.ofcom.org.uk/siteassets/resources/documents/spectrum/tv-transmitter-guidance/tech-parameters/txparamsmf.csv?v=423471';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/__ofcom-mf-snapshot') {
      const upstream = await fetch(OFCOM_MF_URL, {
        redirect: 'follow',
        headers: {
          'user-agent': 'FREQBEACON snapshot capture/1.0 (+https://freqbeacon.methvindigitalworks.com)',
          'accept': 'text/csv,text/plain;q=0.9,*/*;q=0.5'
        }
      });
      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'cache-control': 'no-store',
          'x-freqbeacon-ofcom-upstream-status': String(upstream.status),
          'x-freqbeacon-ofcom-upstream-type': upstream.headers.get('content-type') || ''
        }
      });
    }
    return appWorker.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    if (typeof appWorker.scheduled === 'function') return appWorker.scheduled(controller, env, ctx);
  }
};
