import baseWorker from './worker-program-v3.js';

const RNZ_TIME_ZONE = 'Pacific/Auckland';
const REE_TIME_ZONE = 'Europe/Madrid';
const RNZ_BASE = 'https://www.rnz.co.nz/international/schedules/';
const REE_BASE = 'https://www.rtve.es/play/guia-rne/radioexterior/';
const RRI_SOURCE = 'https://www.rri.ro/en/frequencies';

const RRI_ENGLISH = [
  { start:'05:30', end:'06:00', frequencies:[11960,11650,17680,17760] },
  { start:'11:00', end:'12:00', frequencies:[15320,15130,21510,17860] },
  { start:'17:00', end:'18:00', frequencies:[13750,15180] },
  { start:'20:30', end:'21:00', frequencies:[11975,9740,15420,15130] },
  { start:'22:00', end:'23:00', frequencies:[9740,7220,13580,11650] },
  { start:'00:00', end:'01:00', frequencies:[11620,11900] },
  { start:'03:00', end:'04:00', frequencies:[11830,11620,17790,15330] }
];

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
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
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

function normalized(value) {
  return decodeHtml(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

function zonedParts(date, timeZone) {
  const pieces = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(date);
  const out = {};
  for (const piece of pieces) out[piece.type] = piece.value;
  return {
    year:Number(out.year), month:Number(out.month), day:Number(out.day),
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

function parseClock(value, meridiem = '') {
  if (/^noon$/i.test(value)) return 12 * 60;
  const match = String(value).match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (meridiem) {
    const pm = /^p/i.test(meridiem);
    hour %= 12;
    if (pm) hour += 12;
  }
  return hour * 60 + minute;
}

function programResponse({ station, frequency, at, title, start, end, next, sourceUrl, sourceLabel, displayTimeZone, status='verified' }) {
  return json({
    station, frequency, at:at.toISOString(), status, verified:true,
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

function parseRnzSchedule(html) {
  const blocks = String(html || '').match(/<h4[^>]*>[\s\S]*?<\/h4>/gi) || [];
  const entries = [];
  for (const block of blocks) {
    const text = decodeHtml(block).replace(/^#\s*/, '');
    let match = text.match(/^(\d{1,2}:\d{2})\s*(AM|PM)\.?\s+(.+)$/i);
    if (match) {
      const minute = parseClock(match[1], match[2]);
      if (minute != null) entries.push({ minute, title:match[3].trim() });
      continue;
    }
    match = text.match(/^Noon\s+(.+)$/i);
    if (match) entries.push({ minute:720, title:match[1].trim() });
  }
  return entries
    .filter((entry) => entry.title && !/weekly schedule/i.test(entry.title))
    .sort((a,b) => a.minute - b.minute);
}

async function resolveRnz(request) {
  const url = new URL(request.url);
  const stationRaw = String(url.searchParams.get('station') || '').trim();
  const station = stationRaw.toUpperCase();
  if (!/(?:RNZ PACIFIC|RADIO NEW ZEALAND INTERNATIONAL|\bRNZI\b)/.test(station)) return null;

  const frequency = Number(url.searchParams.get('frequency'));
  const at = url.searchParams.get('at') ? new Date(url.searchParams.get('at')) : new Date();
  let displayTimeZone = url.searchParams.get('tz') || 'UTC';
  if (!Number.isFinite(frequency) || Number.isNaN(at.getTime())) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone:displayTimeZone }).format(at); }
  catch { displayTimeZone = 'UTC'; }

  const local = zonedParts(at, RNZ_TIME_ZONE);
  const dateKey = `${local.year}${String(local.month).padStart(2,'0')}${String(local.day).padStart(2,'0')}`;
  const sourceUrl = `${RNZ_BASE}${dateKey}`;
  let response;
  try {
    response = await fetch(sourceUrl, {
      headers:{ Accept:'text/html,application/xhtml+xml', 'User-Agent':'FreqBeacon/1.0 program identification' },
      cf:{ cacheTtl:300, cacheEverything:true }
    });
  } catch { return null; }
  if (!response.ok) return null;

  const entries = parseRnzSchedule(await response.text());
  if (!entries.length) return null;
  const nowMinute = local.hour * 60 + local.minute;
  let index = -1;
  for (let i = 0; i < entries.length; i += 1) {
    if (entries[i].minute <= nowMinute) index = i;
    else break;
  }
  if (index < 0) index = entries.length - 1;
  const item = entries[index];
  const crossedMidnight = item.minute > nowMinute;
  const start = zonedTimeToUtc(local, Math.floor(item.minute/60), item.minute%60, RNZ_TIME_ZONE, crossedMidnight ? -1 : 0);
  const nextEntry = crossedMidnight ? entries[0] : entries[index + 1];
  let end;
  let next = null;
  if (nextEntry) {
    const dayOffset = crossedMidnight ? 0 : (nextEntry.minute <= item.minute ? 1 : 0);
    end = zonedTimeToUtc(local, Math.floor(nextEntry.minute/60), nextEntry.minute%60, RNZ_TIME_ZONE, dayOffset);
    next = { title:nextEntry.title, start:end, end:new Date(end.getTime() + 30*60000) };
  } else {
    end = zonedTimeToUtc(local, 0, 0, RNZ_TIME_ZONE, 1);
  }
  return programResponse({
    station:'RNZ Pacific', frequency, at, title:item.title, start, end, next,
    sourceUrl, sourceLabel:'RNZ Pacific official schedule', displayTimeZone
  });
}

const REE_CATEGORIES = [
  'Ciencia y Tecnología','Servicio público','Ficción sonora','Entretenimiento','Informativos',
  'Culturales','Divulgación','Magacín','Cultura','Viajes','Música','Deportes'
];

function reeTitleFromAnchor(href, text) {
  const path = String(href || '').match(/\/play\/audios\/([^/?#]+)\/?/i)?.[1] || '';
  const slug = normalized(path).replace(/^-|-$/g,'');
  let rest = String(text || '').replace(/^\d{2}:\d{2}\s+\d{2}:\d{2}\s+/, '');
  const category = REE_CATEGORIES.find((value) => normalized(rest).startsWith(normalized(value)));
  if (category) rest = rest.slice(category.length).trim();
  if (!slug) return rest.split(/\s{2,}|Visitar Programa/i)[0].trim();
  const words = rest.split(/\s+/);
  let candidate = '';
  for (let i = 0; i < Math.min(words.length, 12); i += 1) {
    candidate = `${candidate}${candidate ? ' ' : ''}${words[i]}`;
    const n = normalized(candidate).replace(/^-|-$/g,'');
    if (n === slug || n.endsWith(slug) || slug.endsWith(n) && i >= 1) return candidate.trim();
  }
  return rest.split(/\s{2,}|Visitar Programa/i)[0].trim();
}

function parseReeSchedule(html) {
  const entries = [];
  const anchors = String(html || '').matchAll(/<a\b([^>]*href=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi);
  for (const match of anchors) {
    const href = match[2];
    if (!/\/play\/audios\//i.test(href)) continue;
    const text = decodeHtml(match[3]);
    const time = text.match(/^(\d{2}:\d{2})\s+(\d{2}:\d{2})\s+/);
    if (!time) continue;
    const startMinute = parseClock(time[1]);
    const endMinute = parseClock(time[2]);
    if (startMinute == null || endMinute == null) continue;
    const title = reeTitleFromAnchor(href, text);
    if (!title) continue;
    entries.push({ startMinute, endMinute, title });
  }
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.startMinute}|${entry.endMinute}|${entry.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a,b) => a.startMinute - b.startMinute);
}

function localDateSerial(parts) {
  return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
}

async function resolveRee(request) {
  const url = new URL(request.url);
  const stationRaw = String(url.searchParams.get('station') || '').trim();
  const station = stationRaw.toUpperCase();
  if (!/(?:RADIO EXTERIOR DE ESPAÑA|RADIO EXTERIOR DE ESPANA|\bREE\b)/.test(station)) return null;

  const frequency = Number(url.searchParams.get('frequency'));
  const at = url.searchParams.get('at') ? new Date(url.searchParams.get('at')) : new Date();
  let displayTimeZone = url.searchParams.get('tz') || 'UTC';
  if (!Number.isFinite(frequency) || Number.isNaN(at.getTime())) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone:displayTimeZone }).format(at); }
  catch { displayTimeZone = 'UTC'; }

  const target = zonedParts(at, REE_TIME_ZONE);
  const today = zonedParts(new Date(), REE_TIME_ZONE);
  const dayDelta = localDateSerial(target) - localDateSerial(today);
  if (dayDelta < 0 || dayDelta > 1) return null;
  const sourceUrl = dayDelta === 1 ? `${REE_BASE}manana` : REE_BASE;
  let response;
  try {
    response = await fetch(sourceUrl, {
      headers:{ Accept:'text/html,application/xhtml+xml', 'User-Agent':'FreqBeacon/1.0 program identification' },
      cf:{ cacheTtl:180, cacheEverything:true }
    });
  } catch { return null; }
  if (!response.ok) return null;
  const entries = parseReeSchedule(await response.text());
  if (!entries.length) return null;
  const nowMinute = target.hour * 60 + target.minute;
  const current = entries.find((entry) => {
    const end = entry.endMinute <= entry.startMinute ? entry.endMinute + 1440 : entry.endMinute;
    const now = nowMinute < entry.startMinute && end > 1440 ? nowMinute + 1440 : nowMinute;
    return entry.startMinute <= now && now < end;
  });
  if (!current) return null;
  const start = zonedTimeToUtc(target, Math.floor(current.startMinute/60), current.startMinute%60, REE_TIME_ZONE);
  const endDay = current.endMinute <= current.startMinute ? 1 : 0;
  const end = zonedTimeToUtc(target, Math.floor((current.endMinute%1440)/60), current.endMinute%60, REE_TIME_ZONE, endDay);
  const nextEntry = entries.find((entry) => entry.startMinute > current.startMinute) || null;
  const next = nextEntry ? {
    title:nextEntry.title,
    start:zonedTimeToUtc(target, Math.floor(nextEntry.startMinute/60), nextEntry.startMinute%60, REE_TIME_ZONE),
    end:zonedTimeToUtc(target, Math.floor((nextEntry.endMinute%1440)/60), nextEntry.endMinute%60, REE_TIME_ZONE, nextEntry.endMinute <= nextEntry.startMinute ? 1 : 0)
  } : null;
  return programResponse({
    station:'Radio Exterior de España', frequency, at, title:current.title, start, end, next,
    sourceUrl, sourceLabel:'RTVE Radio Exterior official schedule', displayTimeZone
  });
}

function resolveRri(request) {
  const url = new URL(request.url);
  const stationRaw = String(url.searchParams.get('station') || '').trim();
  const station = stationRaw.toUpperCase();
  if (!station.includes('RADIO ROMANIA INTERNATIONAL')) return null;
  const language = String(url.searchParams.get('language') || '');
  if (language && !/english/i.test(language)) return null;
  const frequency = Number(url.searchParams.get('frequency'));
  const at = url.searchParams.get('at') ? new Date(url.searchParams.get('at')) : new Date();
  let displayTimeZone = url.searchParams.get('tz') || 'UTC';
  if (!Number.isFinite(frequency) || Number.isNaN(at.getTime())) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone:displayTimeZone }).format(at); }
  catch { displayTimeZone = 'UTC'; }
  const minute = at.getUTCHours()*60 + at.getUTCMinutes();
  const rule = RRI_ENGLISH.find((item) => {
    if (!item.frequencies.some((value) => Math.abs(value-frequency) < 0.6)) return false;
    const start = parseClock(item.start);
    const end = parseClock(item.end);
    return start <= minute && minute < end;
  });
  if (!rule) return null;
  const day = { year:at.getUTCFullYear(), month:at.getUTCMonth()+1, day:at.getUTCDate() };
  const startMin = parseClock(rule.start);
  const endMin = parseClock(rule.end);
  const start = new Date(Date.UTC(day.year, day.month-1, day.day, Math.floor(startMin/60), startMin%60));
  const end = new Date(Date.UTC(day.year, day.month-1, day.day, Math.floor(endMin/60), endMin%60));
  return programResponse({
    station:'Radio Romania International', frequency, at,
    title:'RRI English Language Broadcast', start, end, next:null,
    sourceUrl:RRI_SOURCE, sourceLabel:'Radio Romania International official frequency schedule',
    displayTimeZone, status:'broadcast'
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/program-guide') {
      const rri = resolveRri(request);
      if (rri) return rri;
      const rnz = await resolveRnz(request);
      if (rnz) return rnz;
      const ree = await resolveRee(request);
      if (ree) return ree;
    }
    return baseWorker.fetch(request, env, ctx);
  }
};
