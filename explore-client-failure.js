const RECEIVER_ID_RE = /^[A-Za-z0-9._:[\\]-]{1,180}$/;
const REPORT_BODY_LIMIT = 1024;

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0'
    }
  });
}

export function selectedExploreReceiverId(request) {
  const cookie = String(request.headers.get('cookie') || '');
  const match = cookie.match(/(?:^|;\\s*)fb_explore_receiver=([^;]+)/);
  if (!match) return '';
  try {
    const receiverId = decodeURIComponent(match[1]);
    return RECEIVER_ID_RE.test(receiverId) ? receiverId : '';
  } catch {
    return '';
  }
}

export async function handleExploreClientFailureReport(request) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > REPORT_BODY_LIMIT) {
    return json({ error: 'Failure report too large' }, 413);
  }

  const receiverId = selectedExploreReceiverId(request);
  if (!receiverId) return json({ error: 'No valid Explore receiver is selected' }, 409);

  let report = {};
  try {
    const raw = await request.text();
    if (raw.length > REPORT_BODY_LIMIT) return json({ error: 'Failure report too large' }, 413);
    if (raw.trim()) report = JSON.parse(raw);
  } catch {
    return json({ error: 'Invalid failure report' }, 400);
  }

  const title = String(report?.title || '').trim().slice(0, 96);
  const detail = String(report?.detail || '').trim().slice(0, 240);

  return json({
    ok: true,
    receiverId,
    reportAccepted: true,
    authoritativeHealthChanged: false,
    evidence: 'client-advisory',
    title,
    detail,
    policy: 'Receiver trust changes require server-side SND + paired W/F verification.'
  }, 202);
}
