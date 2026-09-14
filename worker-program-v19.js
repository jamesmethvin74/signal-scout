import baseWorker from './worker-program-v18.js';

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0'
    }
  });
}

function selectedExploreReceiverId(request) {
  const cookie = String(request.headers.get('cookie') || '');
  const match = cookie.match(/(?:^|;\s*)fb_explore_receiver=([^;]+)/);
  if (!match) return '';
  try { return decodeURIComponent(match[1]).slice(0, 180); } catch { return ''; }
}

async function liveFailureResponse(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env?.RECEIVER_HEALTH_DB) return json({ error: 'Receiver health database unavailable' }, 503);

  const receiverId = selectedExploreReceiverId(request);
  if (!receiverId) return json({ error: 'No Explore receiver is selected' }, 409);

  try {
    // A real Zero SND/W/F failure is stronger evidence than an old background
    // success. Remove the receiver from the green trusted feed immediately. The
    // normal health proof cycle can promote it again after it proves usable.
    const result = await env.RECEIVER_HEALTH_DB.prepare(`
      UPDATE receivers SET
        trusted=0,
        consecutive_failures=CASE
          WHEN consecutive_failures < 8 THEN consecutive_failures + 1
          ELSE consecutive_failures
        END,
        snd_success=0,
        wf_success=0,
        health_score=MAX(0, health_score - 25)
      WHERE id=?
    `).bind(receiverId).run();

    return json({
      ok: true,
      receiverId,
      temporarilyHidden: true,
      changed: Number(result?.meta?.changes || 0)
    });
  } catch (error) {
    console.warn('FREQBEACON live receiver failure persistence failed', error?.message || error);
    return json({ error: 'Could not update receiver health' }, 503);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/explore/live-failure') {
      return liveFailureResponse(request, env);
    }
    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') {
      return baseWorker.scheduled(event, env, ctx);
    }
  }
};
