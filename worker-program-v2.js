import baseWorker from './worker.js';

const WRMI_TIME_ZONE = 'America/New_York';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=120'
    }
  });
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = {};
  for (const part of parts) values[part.type] = part.value;
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    day: dayMap[values.weekday],
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

function formatWindow(start, end, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    const zone = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short'
    }).formatToParts(start).find((part) => part.type === 'timeZoneName')?.value || '';
    return `${formatter.format(start)}–${formatter.format(end)}${zone ? ` ${zone}` : ''}`;
  } catch {
    return `${start.toISOString().slice(11, 16)}–${end.toISOString().slice(11, 16)} UTC`;
  }
}

function easternHourBoundaryUtc(at, targetHour) {
  const eastern = new Intl.DateTimeFormat('en-US', {
    timeZone: WRMI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(at);
  const p = {};
  for (const part of eastern) p[part.type] = part.value;
  const desiredWall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), targetHour, 0);
  let guess = desiredWall;
  for (let i = 0; i < 3; i += 1) {
    const seenParts = new Intl.DateTimeFormat('en-US', {
      timeZone: WRMI_TIME_ZONE,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(guess));
    const seen = {};
    for (const part of seenParts) seen[part.type] = part.value;
    const seenWall = Date.UTC(Number(seen.year), Number(seen.month) - 1, Number(seen.day), Number(seen.hour), Number(seen.minute));
    guess += desiredWall - seenWall;
  }
  return new Date(guess);
}

function halTurnerOverride(request) {
  const url = new URL(request.url);
  const station = String(url.searchParams.get('station') || '').trim().toUpperCase();
  const frequency = Number(url.searchParams.get('frequency'));
  const atRaw = url.searchParams.get('at');
  const at = atRaw ? new Date(atRaw) : new Date();
  const displayTimeZone = url.searchParams.get('tz') || 'UTC';

  if (!station.includes('WRMI') && !station.includes('RADIO MIAMI INTERNATIONAL')) return null;
  if (![5950, 9455, 7570].some((value) => Math.abs(value - frequency) < 0.6)) return null;
  if (!Number.isFinite(frequency) || Number.isNaN(at.getTime())) return null;

  let displayTz = displayTimeZone;
  try { new Intl.DateTimeFormat('en-US', { timeZone: displayTz }).format(at); }
  catch { displayTz = 'UTC'; }

  const local = zonedParts(at, WRMI_TIME_ZONE);
  const minuteOfDay = local.hour * 60 + local.minute;
  if (local.day < 1 || local.day > 5 || minuteOfDay < 21 * 60 || minuteOfDay >= 22 * 60) return null;

  const start = easternHourBoundaryUtc(at, 21);
  const end = easternHourBoundaryUtc(at, 22);
  return json({
    station: 'WRMI',
    frequency,
    at: at.toISOString(),
    status: 'verified',
    verified: true,
    program: 'The Hal Turner Radio Show',
    window: formatWindow(start, end, displayTz),
    start: start.toISOString(),
    end: end.toISOString(),
    next: null,
    sourceUrl: 'https://www.wrmi.net/index.php/programming/',
    sourceLabel: 'WRMI official programming page (verified Aug 27, 2026)'
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/program-guide') {
      const override = halTurnerOverride(request);
      if (override) return override;
    }
    return baseWorker.fetch(request, env, ctx);
  }
};
