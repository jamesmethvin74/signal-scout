import baseWorker from './worker-program-v20.js';

const RECOMMENDATION_PATH = '/api/explore/recommendation';

function finiteCoordinate(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function recommendationRequest(request) {
  const url = new URL(request.url);
  if (url.pathname !== RECOMMENDATION_PATH || (request.method !== 'GET' && request.method !== 'HEAD')) return request;
  if (url.searchParams.has('lat') && url.searchParams.has('lon')) return request;

  const lat = finiteCoordinate(request.cf?.latitude, -90, 90);
  const lon = finiteCoordinate(request.cf?.longitude, -180, 180);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return request;

  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  return new Request(url.toString(), request);
}

export default {
  async fetch(request, env, ctx) {
    return baseWorker.fetch(recommendationRequest(request), env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(event, env, ctx);
    return undefined;
  }
};
