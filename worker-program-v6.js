import baseWorker from './worker-program-v5.js';

const BBC_TIME_ZONE = 'Europe/London';
const BBC_SOURCE = 'https://www.bbc.com/audio/schedules/bbc_world_service';
const BBC_MIRROR_BASE = 'https://bbc.com.im/sounds/schedules/bbc_world_service/';
const EWTN_TIME_ZONE = 'America/New_York';
const EWTN_SOURCE = 'https://www.ewtn.com/radio/schedule';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60'
    }
  });
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&rsquo;|&#8217;/gi, '’')
    .replace(/&ldquo;|&#8220;/gi, '“')
    .replace(/&rdquo;|&#8221;/gi, '”')
    .replace(/&ndash;|&#8211;/gi, '–')
    .replace(/&mdash;|&#8212;/gi, '—')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

function htmlLines(html) {
  return decodeEntities(String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(?:br|\/p|\/div|\/li|\/h1|\/h2|\/h3|\/h4|\/h5|\/section|\/article|\/a)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function zonedParts(date, timeZone) {
  const pieces = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday:'short', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(date);
  const out = {};
  for (const piece of pieces) out[piece.type] = piece.value;
  const dayMap = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  return {
    weekday:dayMap[out.weekday], year:Number(out.year), month:Number(out.month), day:Number(out.day),
    hour:Number(out.hour), minute:Number(out.minute)
  };
}

function zonedTimeToUtc(parts, hour, minute, timeZone, dayOffset = 0) {
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset));
  const year = base.getUTCFullYear();
  const month = base.getUTCMonth() + 1;
  const day = base.getUTCDate();
  const desiredWall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = desiredWall;
  for (let i = 0; i < 4; i += 1) {
    const seen = zonedParts(new Date(guess), timeZone);
    const seenWall = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    guess += desiredWall - seenWall;
  }
  return new Date(guess);
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

function programResponse({ station, frequency, at, title, start, end, next, sourceUrl, sourceLabel, displayTimeZone }) {
  return json({
    station, frequency, at:at.toISOString(), status:'verified', verified:true,
    program:title,
    window:formatWindow(start, end, displayTimeZone),
    start:start.toISOString(), end:end.toISOString(),
    next: next ? {
      program:next.title,
      window:formatWindow(next.start, next.end, displayTimeZone),
      start:next.start.toISOString()
    } : null,
    sourceUrl, sourceLabel
  });
}

function cleanBbcTitle(value) {
  let title = String(value || '')
    .replace(/^LIVE[,.·\s-]*/i, '')
    .replace(/^Not available\s*/i, '')
    .replace(/^Programme Website\s*/i, '')
    .trim();
  title = title.replace(/\s+\d{2}\/\d{2}\/\d{4}\b[\s\S]*$/, '').trim();
  title = title.replace(/\s+Programme Website\b[\s\S]*$/i, '').trim();
  if (/^(?:Early|Morning|Afternoon|Evening|Late|Skip to|World Service Schedule|Schedule variation)$/i.test(title)) return '';
  return title;
}

function parseBbcSchedule(html) {
  const lines = htmlLines(html);
  const entries = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    let match = line.match(/^(\d{1,2}):(\d{2})\s+(.+)$/);
    let hour;
    let minute;
    let title = '';
    if (match) {
      hour = Number(match[1]);
      minute = Number(match[2]);
      title = cleanBbcTitle(match[3]);
    } else {
      match = line.match(/^(\d{1,2}):(\d{2})$/);
      if (!match) continue;
      hour = Number(match[1]);
      minute = Number(match[2]);
      for (let j = i + 1; j < Math.min(lines.length, i + 6); j += 1) {
        if (/^\d{1,2}:\d{2}/.test(lines[j])) break;
        const candidate = cleanBbcTitle(lines[j]);
        if (!candidate || /^Not available$/i.test(candidate)) continue;
        title = candidate;
        break;
      }
    }
    if (hour > 23 || minute > 59 || !title) continue;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(title)) continue;
    entries.push({ minute:hour * 60 + minute, title });
  }

  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.minute}|${entry.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a,b) => a.minute - b.minute);
}

async function fetchBbcSchedule(parts) {
  const y = String(parts.year);
  const m = String(parts.month).padStart(2,'0');
  const d = String(parts.day).padStart(2,'0');
  const urls = [
    `https://www.bbc.co.uk/schedules/p00fzl9p/${y}/${m}/${d}`,
    `${BBC_MIRROR_BASE}${y}-${m}-${d}`
  ];
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers:{ Accept:'text/html,application/xhtml+xml', 'User-Agent':'FreqBeacon/1.0 program identification' },
        cf:{ cacheTtl:180, cacheEverything:true }
      });
      if (!response.ok) continue;
      const html = await response.text();
      const entries = parseBbcSchedule(html);
      if (entries.length >= 8) return entries;
    } catch {}
  }
  return [];
}

async function resolveBbc(request) {
  const url = new URL(request.url);
  const station = String(url.searchParams.get('station') || '').trim();
  if (!/BBC WORLD SERVICE|BRITISH BROADCASTING CORPORATION/i.test(station)) return null;
  const language = String(url.searchParams.get('language') || '');
  if (language && !/english/i.test(language)) return null;

  const frequency = Number(url.searchParams.get('frequency'));
  const at = url.searchParams.get('at') ? new Date(url.searchParams.get('at')) : new Date();
  let displayTimeZone = url.searchParams.get('tz') || 'UTC';
  if (!Number.isFinite(frequency) || Number.isNaN(at.getTime())) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone:displayTimeZone }).format(at); }
  catch { displayTimeZone = 'UTC'; }

  const local = zonedParts(at, BBC_TIME_ZONE);
  const entries = await fetchBbcSchedule(local);
  if (!entries.length) return null;
  const nowMinute = local.hour * 60 + local.minute;
  let index = -1;
  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i].minute <= nowMinute) index = i;
    else break;
  }
  if (index < 0) return null;
  const current = entries[index];
  const nextEntry = entries[index + 1] || null;
  const start = zonedTimeToUtc(local, Math.floor(current.minute / 60), current.minute % 60, BBC_TIME_ZONE);
  const endMinute = nextEntry ? nextEntry.minute : 1440;
  const end = endMinute === 1440
    ? zonedTimeToUtc(local, 0, 0, BBC_TIME_ZONE, 1)
    : zonedTimeToUtc(local, Math.floor(endMinute / 60), endMinute % 60, BBC_TIME_ZONE);
  const next = nextEntry ? {
    title:nextEntry.title,
    start:end,
    end:index + 2 < entries.length
      ? zonedTimeToUtc(local, Math.floor(entries[index + 2].minute / 60), entries[index + 2].minute % 60, BBC_TIME_ZONE)
      : zonedTimeToUtc(local, 0, 0, BBC_TIME_ZONE, 1)
  } : null;

  return programResponse({
    station:'BBC World Service', frequency, at, title:current.title, start, end, next,
    sourceUrl:BBC_SOURCE, sourceLabel:'BBC World Service schedule', displayTimeZone
  });
}

const EWTN_WEEKDAY = [
  ['05:00','05:30','Chaplet of Divine Mercy'],
  ['05:30','06:00','Fire on the Earth'],
  ['06:00','08:00','The Son Rise Morning Show'],
  ['08:00','09:00','Daily Mass'],
  ['09:00','10:00','Catholic Connection'],
  ['10:00','11:00','More 2 Life'],
  ['11:00','12:00','Women of Grace'],
  ['12:00','13:00','Take 2 with Jerry & Debbie'],
  ['13:00','14:00','The Doctor Is In'],
  ['14:00','15:00','Called to Communion'],
  ['15:00','16:00','EWTN Open Line'],
  ['16:00','17:00','Beacon of Truth'],
  ['17:00','18:00','Ave Maria in the Afternoon'],
  ['18:00','19:00','Catholic Answers Live'],
  ['19:00','20:00','Catholic Answers Live'],
  ['21:00','21:30','EWTN News Nightly'],
  ['21:30','22:00','Holy Rosary'],
  ['22:00','22:30','Bible in a Year'],
  ['22:30','23:00','Catechism in a Year'],
  ['23:00','24:00','Called to Communion (Encore)']
];

const EWTN_EIGHT_PM = {
  1:'The Journey Home',
  2:'Mother Angelica Live Classics',
  3:'EWTN Live',
  4:'The World Over',
  5:'EWTN News In Depth'
};

function clockMinutes(value) {
  if (value === '24:00') return 1440;
  const [hour, minute] = String(value).split(':').map(Number);
  return hour * 60 + minute;
}

function resolveEwtn(request) {
  const url = new URL(request.url);
  const station = String(url.searchParams.get('station') || '').trim();
  if (!/(?:^WEWN$|EWTN|ETERNAL WORD)/i.test(station)) return null;
  const language = String(url.searchParams.get('language') || '');
  if (language && !/english/i.test(language)) return null;

  const frequency = Number(url.searchParams.get('frequency'));
  const at = url.searchParams.get('at') ? new Date(url.searchParams.get('at')) : new Date();
  let displayTimeZone = url.searchParams.get('tz') || 'UTC';
  if (!Number.isFinite(frequency) || Number.isNaN(at.getTime())) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone:displayTimeZone }).format(at); }
  catch { displayTimeZone = 'UTC'; }

  const local = zonedParts(at, EWTN_TIME_ZONE);
  if (local.weekday < 1 || local.weekday > 5) return null;
  const rules = [...EWTN_WEEKDAY, ['20:00','21:00',EWTN_EIGHT_PM[local.weekday]]]
    .map(([start,end,title]) => ({ start, end, title }));
  const nowMinute = local.hour * 60 + local.minute;
  const current = rules.find((rule) => clockMinutes(rule.start) <= nowMinute && nowMinute < clockMinutes(rule.end));
  if (!current) return null;
  const startMin = clockMinutes(current.start);
  const endMin = clockMinutes(current.end);
  const start = zonedTimeToUtc(local, Math.floor(startMin / 60), startMin % 60, EWTN_TIME_ZONE);
  const end = endMin === 1440
    ? zonedTimeToUtc(local, 0, 0, EWTN_TIME_ZONE, 1)
    : zonedTimeToUtc(local, Math.floor(endMin / 60), endMin % 60, EWTN_TIME_ZONE);
  const nextRule = rules
    .filter((rule) => clockMinutes(rule.start) >= endMin)
    .sort((a,b) => clockMinutes(a.start) - clockMinutes(b.start))[0] || null;
  const next = nextRule ? {
    title:nextRule.title,
    start:zonedTimeToUtc(local, Math.floor(clockMinutes(nextRule.start) / 60), clockMinutes(nextRule.start) % 60, EWTN_TIME_ZONE),
    end:clockMinutes(nextRule.end) === 1440
      ? zonedTimeToUtc(local, 0, 0, EWTN_TIME_ZONE, 1)
      : zonedTimeToUtc(local, Math.floor(clockMinutes(nextRule.end) / 60), clockMinutes(nextRule.end) % 60, EWTN_TIME_ZONE)
  } : null;

  return programResponse({
    station:'WEWN / EWTN', frequency, at, title:current.title, start, end, next,
    sourceUrl:EWTN_SOURCE, sourceLabel:'EWTN official radio schedule — weekday network grid', displayTimeZone
  });
}

function injectMajorGuideRuntime(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;
  return response.text().then((html) => {
    if (!html.includes('program-guide-major.js')) {
      html = html.replace(
        '<script src="card-collapse.js?v=1"></script>',
        '<script src="program-guide-major.js?v=1"></script>\n  <script src="card-collapse.js?v=1"></script>'
      );
    }
    return new Response(html, {
      status:response.status,
      statusText:response.statusText,
      headers:response.headers
    });
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/program-guide') {
      const bbc = await resolveBbc(request);
      if (bbc) return bbc;
      const ewtn = resolveEwtn(request);
      if (ewtn) return ewtn;
    }
    const response = await baseWorker.fetch(request, env, ctx);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return injectMajorGuideRuntime(response);
    }
    return response;
  }
};
