function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0'
    }
  });
}

function normalizeStation(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export async function programGuideResponse(request) {
  const url = new URL(request.url);
  const station = normalizeStation(url.searchParams.get('station'));
  const frequency = Number(url.searchParams.get('frequency'));
  const atRaw = url.searchParams.get('at');
  const displayTimeZone = url.searchParams.get('tz') || 'UTC';
  const at = atRaw ? new Date(atRaw) : new Date();

  if (!station || !Number.isFinite(frequency) || frequency < 100 || frequency > 30000 || Number.isNaN(at.getTime())) {
    return json({ status:'error', message:'Invalid program-guide request.' }, 400);
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone:displayTimeZone }).format(at);
  } catch {
    return json({ status:'error', message:'Invalid time zone.' }, 400);
  }

  return json({
    station,
    frequency,
    at: at.toISOString(),
    status: 'unsupported',
    verified: false,
    message: 'Exact program enrichment is temporarily unavailable while FREQBEACON verifies source reuse permissions.'
  });
}
