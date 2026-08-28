import baseWorker from './worker-program-v12.js';

function injectCoverage(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;
  return response.text().then((html)=>{
    if (!html.includes('program-guide-coverage-v2.js')) {
      html = html.replace('</body>','  <script src="program-guide-coverage-v2.js?v=1"></script>\n</body>');
    }
    const headers = new Headers(response.headers);
    headers.set('content-type','text/html; charset=utf-8');
    headers.set('cache-control','no-store, max-age=0');
    headers.set('x-freqbeacon-program-coverage','v2');
    return new Response(html,{status:response.status,statusText:response.statusText,headers});
  });
}

export default {
  async fetch(request,env,ctx) {
    const response = await baseWorker.fetch(request,env,ctx);
    const url = new URL(request.url);
    if (request.method==='GET' && (url.pathname==='/' || url.pathname==='/index.html')) return injectCoverage(response);
    return response;
  },
  async scheduled(event,env,ctx) {
    if (typeof baseWorker.scheduled==='function') return baseWorker.scheduled(event,env,ctx);
  }
};
