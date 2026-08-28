import baseWorker from './worker-program-v13.js';

function json(data,status=200) {
  return new Response(JSON.stringify(data),{
    status,
    headers:{'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=60'}
  });
}

async function responseJson(response) {
  const type = String(response?.headers?.get('content-type') || '');
  if (!type.includes('application/json')) return null;
  try { return await response.clone().json(); } catch { return null; }
}

export default {
  async fetch(request,env,ctx) {
    const response = await baseWorker.fetch(request,env,ctx);
    const url = new URL(request.url);
    if (url.pathname !== '/api/program-guide') return response;

    const data = await responseJson(response);
    if (data?.source?.id !== 'wrmi-grid' || data.status !== 'broadcast') return response;

    const at = url.searchParams.get('at') ? new Date(url.searchParams.get('at')) : new Date();
    const start = data.start ? new Date(data.start) : null;
    const end = data.end ? new Date(data.end) : null;
    if (Number.isNaN(at.getTime()) || !start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return response;
    if (start <= at && at < end) return response;

    return json({
      station:data.station || 'WRMI',
      frequency:data.frequency,
      at:at.toISOString(),
      status:'unverified',verified:false,
      message:'The official WRMI grid does not publish a program block for this exact minute.',
      sourceUrl:data.sourceUrl,
      sourceLabel:data.sourceLabel,
      source:data.source
    });
  },
  async scheduled(event,env,ctx) {
    if (typeof baseWorker.scheduled==='function') return baseWorker.scheduled(event,env,ctx);
  }
};
