import baseWorker from './worker-program-v2.js';

const WBCQ_BASE = 'https://wbcq.com/schedule/index.php?fn=sked&freq=';
const DAY = { Su:0, Mo:1, Tu:2, We:3, Th:4, Fr:5, Sa:6, Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60'
    }
  });
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&rsquo;|&#8217;/gi, '’')
    .replace(/&ldquo;|&#8220;/gi, '“')
    .replace(/&rdquo;|&#8221;/gi, '”')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function parseWbcqTextRows(html) {
  const textRows = String(html || '')
    .replace(/<\/tr\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .split(/\r?\n/)
    .map(decodeHtml)
    .filter(Boolean);

  const rows = [];
  const rowRe = /^(\d{4,5})\s+(Su|Mo|Tu|We|Th|Fr|Sa)\s+(\d{4})\s+(\d{4})\s+UTC\s+(?:Su|Mo|Tu|We|Th|Fr|Sa)\s+\d{1,2}:\d{2}(?:AM|PM)\s+\d{1,2}:\d{2}(?:AM|PM)\s+EST\s+(.+)$/i;

  for (const line of textRows) {
    const match = line.match(rowRe);
    if (!match) continue;
    const frequency = Number(match[1]);
    const day = DAY[match[2]];
    const start = match[3];
    const end = match[4];
    const title = decodeHtml(match[5]);
    if (!Number.isFinite(frequency) || day == null || !title) continue;
    rows.push({ frequency, day, start, end, title });
  }
  return rows;
}

function buildOccurrences(rows, at, frequency) {
  const dayStart = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const occurrences = [];
  for (const row of rows.filter((item) => Math.abs(item.frequency - frequency) < 0.6)) {
    const startMin = Number(row.start.slice(0,2)) * 60 + Number(row.start.slice(2));
    let endMin = Number(row.end.slice(0,2)) * 60 + Number(row.end.slice(2));
    if (row.end === '0000') endMin = 1440;
    if (endMin <= startMin) endMin += 1440;
    for (let delta = -7; delta <= 7; delta += 1) {
      const date = new Date(dayStart + delta * 86400000);
      if (date.getUTCDay() !== row.day) continue;
      const startDate = new Date(date.getTime() + startMin * 60000);
      const endDate = new Date(date.getTime() + endMin * 60000);
      occurrences.push({ title: row.title, startDate, endDate, duration: endDate - startDate });
    }
  }
  return occurrences;
}

function formatWindow(start, end, timeZone) {
  try {
    const time = new Intl.DateTimeFormat('en-US', { timeZone, hour:'numeric', minute:'2-digit', hour12:true });
    const zone = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName:'short' })
      .formatToParts(start).find((part) => part.type === 'timeZoneName')?.value || '';
    return `${time.format(start)}–${time.format(end)}${zone ? ` ${zone}` : ''}`;
  } catch {
    return `${start.toISOString().slice(11,16)}–${end.toISOString().slice(11,16)} UTC`;
  }
}

async function resolveWbcq(request) {
  const url = new URL(request.url);
  const station = String(url.searchParams.get('station') || '').trim().toUpperCase();
  if (!station.includes('WBCQ')) return null;

  const frequency = Number(url.searchParams.get('frequency'));
  const at = url.searchParams.get('at') ? new Date(url.searchParams.get('at')) : new Date();
  let displayTimeZone = url.searchParams.get('tz') || 'UTC';
  if (!Number.isFinite(frequency) || Number.isNaN(at.getTime())) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone:displayTimeZone }).format(at); }
  catch { displayTimeZone = 'UTC'; }

  const sourceUrl = `${WBCQ_BASE}${encodeURIComponent(Math.round(frequency))}`;
  let response;
  try {
    response = await fetch(sourceUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'FreqBeacon/1.0 program identification'
      },
      cf: { cacheTtl: 120, cacheEverything: true }
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const rows = parseWbcqTextRows(await response.text());
  if (!rows.length) return null;

  const now = at.getTime();
  const occurrences = buildOccurrences(rows, at, frequency);
  const active = occurrences
    .filter((item) => item.startDate.getTime() <= now && now < item.endDate.getTime())
    .sort((a,b) => a.duration - b.duration || b.startDate - a.startDate);
  const next = occurrences
    .filter((item) => item.startDate.getTime() > now)
    .sort((a,b) => a.startDate - b.startDate || a.duration - b.duration)[0] || null;

  if (!active.length) {
    return json({
      station:'WBCQ', frequency, at:at.toISOString(), status:'unverified', verified:false,
      message:'WBCQ publishes a frequency-specific guide, but no named show is scheduled for this exact minute.',
      next: next ? {
        program:next.title,
        window:formatWindow(next.startDate, next.endDate, displayTimeZone),
        start:next.startDate.toISOString()
      } : null,
      sourceUrl,
      sourceLabel:'WBCQ official program guide'
    });
  }

  // WBCQ sometimes publishes a short specific show inside a longer block. Prefer
  // the shortest active listing rather than treating that intentional nesting as
  // a conflict.
  const selected = active[0];
  const sameSpecificity = active.filter((item) => item.duration === selected.duration);
  const distinctTitles = [...new Set(sameSpecificity.map((item) => item.title))];
  if (distinctTitles.length > 1) {
    return json({
      station:'WBCQ', frequency, at:at.toISOString(), status:'ambiguous', verified:false,
      candidates:distinctTitles,
      message:'WBCQ publishes overlapping program titles for this exact time, so FreqBeacon will not guess.',
      sourceUrl,
      sourceLabel:'WBCQ official program guide'
    });
  }

  return json({
    station:'WBCQ', frequency, at:at.toISOString(), status:'verified', verified:true,
    program:selected.title,
    window:formatWindow(selected.startDate, selected.endDate, displayTimeZone),
    start:selected.startDate.toISOString(),
    end:selected.endDate.toISOString(),
    next: next ? {
      program:next.title,
      window:formatWindow(next.startDate, next.endDate, displayTimeZone),
      start:next.startDate.toISOString()
    } : null,
    sourceUrl,
    sourceLabel:'WBCQ official program guide'
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/program-guide') {
      const wbcq = await resolveWbcq(request);
      if (wbcq) return wbcq;
    }
    return baseWorker.fetch(request, env, ctx);
  }
};
