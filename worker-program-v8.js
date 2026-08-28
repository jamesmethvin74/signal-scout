import primaryWorker from './worker-program-v7.js';
import fallbackWorker from './worker-program-v6.js';

const WRMI_URL = 'https://www.wrmi.net/index.php/programming/';
const ET = 'America/New_York';
const LAST_GOOD_SECONDS = 7 * 24 * 60 * 60;
const DAY = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function safeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function requestParts(request) {
  const url = new URL(request.url);
  const station = String(url.searchParams.get('station') || '').trim();
  const frequency = Number(url.searchParams.get('frequency'));
  const at = url.searchParams.get('at') ? new Date(url.searchParams.get('at')) : new Date();
  let tz = url.searchParams.get('tz') || 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(at); }
  catch { tz = 'UTC'; }
  return { url, station, frequency, at, tz };
}

function lastGoodKey(station, frequency) {
  return new Request(`https://freqbeacon-cache.invalid/program-last-good/${safeKey(station)}/${Math.round(Number(frequency) || 0)}`);
}

async function rememberVerified(data) {
  if (!data?.verified || data.status !== 'verified' || !data.station || !Number.isFinite(Number(data.frequency))) return;
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': `public, max-age=${LAST_GOOD_SECONDS}`,
    'x-freqbeacon-last-good-at': new Date().toISOString()
  });
  await caches.default.put(lastGoodKey(data.station, data.frequency), new Response(JSON.stringify(data), { headers }));
}

async function lastGoodFor(parts) {
  const response = await caches.default.match(lastGoodKey(parts.station, parts.frequency));
  if (!response) return null;
  let data;
  try { data = await response.json(); } catch { return null; }
  const start = data?.start ? new Date(data.start) : null;
  const end = data?.end ? new Date(data.end) : null;
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (!(start.getTime() <= parts.at.getTime() && parts.at.getTime() < end.getTime())) return null;
  data.source = { ...(data.source || {}), freshness:'stale-if-error', lastKnownGood:true };
  data.sourceLabel = `${data.sourceLabel || 'Official program guide'} · last known good`;
  return data;
}

async function responseJson(response) {
  const type = String(response.headers.get('content-type') || '');
  if (!type.includes('application/json')) return null;
  try { return await response.clone().json(); } catch { return null; }
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>|<\/div\s*>|<\/li\s*>|<\/h[1-6]\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&rsquo;|&#8217;/gi, '’')
    .replace(/&ldquo;|&#8220;/gi, '“')
    .replace(/&rdquo;|&#8221;/gi, '”')
    .replace(/&ndash;|&#8211;/gi, '–')
    .replace(/&mdash;|&#8212;/gi, '—')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function wrmiSource() {
  const cache = caches.default;
  const freshKey = new Request('https://freqbeacon-cache.invalid/wrmi-direct/fresh');
  const staleKey = new Request('https://freqbeacon-cache.invalid/wrmi-direct/last-good');
  const fresh = await cache.match(freshKey);
  if (fresh) return { text:await fresh.text(), stale:false, fetchedAt:fresh.headers.get('x-fetched-at') };

  try {
    const response = await fetch(WRMI_URL, {
      headers: {
        Accept:'text/html,application/xhtml+xml',
        'User-Agent':'FREQBEACON/1.0 program schedule refresh'
      },
      cf:{ cacheTtl:1800, cacheEverything:true }
    });
    if (!response.ok) throw new Error(`WRMI HTTP ${response.status}`);
    const html = await response.text();
    if (html.length < 1000) throw new Error('WRMI schedule page was unexpectedly short');
    const text = decodeHtml(html);
    const fetchedAt = new Date().toISOString();
    const freshHeaders = new Headers({
      'content-type':'text/plain; charset=utf-8',
      'cache-control':'public, max-age=3600',
      'x-fetched-at':fetchedAt
    });
    const staleHeaders = new Headers({
      'content-type':'text/plain; charset=utf-8',
      'cache-control':`public, max-age=${LAST_GOOD_SECONDS}`,
      'x-fetched-at':fetchedAt
    });
    await Promise.all([
      cache.put(freshKey, new Response(text, { headers:freshHeaders })),
      cache.put(staleKey, new Response(text, { headers:staleHeaders }))
    ]);
    return { text, stale:false, fetchedAt };
  } catch (error) {
    const stale = await cache.match(staleKey);
    if (stale) return { text:await stale.text(), stale:true, fetchedAt:stale.headers.get('x-fetched-at'), error:String(error?.message || error) };
    throw error;
  }
}

function zonedParts(date, timeZone) {
  const pieces = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday:'short', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(date);
  const out = {};
  for (const piece of pieces) out[piece.type] = piece.value;
  return {
    weekday:DAY[out.weekday], year:Number(out.year), month:Number(out.month), day:Number(out.day),
    hour:Number(out.hour), minute:Number(out.minute)
  };
}

function zonedTimeToUtc(parts, minuteOfDay, timeZone, dayOffset=0) {
  const base = new Date(Date.UTC(parts.year, parts.month-1, parts.day + dayOffset));
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const d = base.getUTCDate();
  const minute = ((minuteOfDay % 1440) + 1440) % 1440;
  const desired = Date.UTC(y,m,d,Math.floor(minute/60),minute%60);
  let guess = desired;
  for (let i=0; i<4; i += 1) {
    const seen = zonedParts(new Date(guess), timeZone);
    const wall = Date.UTC(seen.year,seen.month-1,seen.day,seen.hour,seen.minute);
    guess += desired - wall;
  }
  return new Date(guess);
}

function formatWindow(start, end, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US',{timeZone,hour:'numeric',minute:'2-digit',hour12:true});
    const zone = new Intl.DateTimeFormat('en-US',{timeZone,timeZoneName:'short'})
      .formatToParts(start).find((p)=>p.type==='timeZoneName')?.value || '';
    return `${fmt.format(start)}–${fmt.format(end)}${zone ? ` ${zone}` : ''}`;
  } catch {
    return `${start.toISOString().slice(11,16)}–${end.toISOString().slice(11,16)} UTC`;
  }
}

function ruleOccurrences(rules, at) {
  const now = at.getTime();
  const occurrences = [];
  for (const rule of rules) {
    const zone = rule.zone || ET;
    const local = zonedParts(at, zone);
    for (let delta=-1; delta<=8; delta += 1) {
      const base = new Date(Date.UTC(local.year,local.month-1,local.day+delta));
      const parts = { year:base.getUTCFullYear(), month:base.getUTCMonth()+1, day:base.getUTCDate(), weekday:base.getUTCDay() };
      if (!rule.days.includes(parts.weekday)) continue;
      const start = zonedTimeToUtc(parts, rule.start, zone);
      const endDay = rule.end <= rule.start ? 1 : 0;
      const end = rule.end === 1440
        ? zonedTimeToUtc(parts, 0, zone, 1)
        : zonedTimeToUtc(parts, rule.end, zone, endDay);
      occurrences.push({ ...rule, startDate:start, endDate:end });
    }
  }
  const current = occurrences.filter((o)=>o.startDate.getTime()<=now && now<o.endDate.getTime())
    .sort((a,b)=>(a.endDate-a.startDate)-(b.endDate-b.startDate));
  const next = occurrences.filter((o)=>o.startDate.getTime()>now).sort((a,b)=>a.startDate-b.startDate)[0] || null;
  return { current, next };
}

function addRule(rules, frequency, days, start, end, title, zone=ET) {
  rules.push({ frequency, days, start, end, title, zone });
}

function wrmiEmergencyRules(text) {
  const rules = [];
  const upper = text.toUpperCase();

  // These rules are only enabled when the current official WRMI page still
  // contains the matching published section. They are emergency parsing
  // fallbacks, not an independent hand-maintained schedule authority.
  if (upper.includes('WRMI LEGENDS') && upper.includes('JEFF CLARK') && upper.includes('DAN COLLINS')) {
    const hosts = { 1:'Jeff Clark', 2:'Dave Mason', 3:'Ted Randall', 4:'Dan Collins', 5:'Steve Hunter', 6:'Jeff Laurence' };
    for (const [dayText, host] of Object.entries(hosts)) {
      const day = Number(dayText);
      addRule(rules,5050,[day],1260,1440,`WRMI Legends — ${host}`);
      const nextDay = (day + 1) % 7;
      addRule(rules,9455,[nextDay],0,120,`WRMI Legends — ${host}`);
    }
    addRule(rules,5050,[0],1260,1320,'Soldiers of Light Ministry');
    addRule(rules,5050,[0],1320,1380,"Ria's Ham Shack");
    addRule(rules,5050,[0],1380,1440,'QSO Radio Show');
    addRule(rules,9455,[1],0,60,'QSO Radio Show');
    addRule(rules,9455,[1],60,120,'Soldiers of Light Ministry');
  }

  if (/HAL TURNER RADIO SHOW LIVE MONDAY-FRIDAY FROM 9:00/i.test(text)) {
    for (const frequency of [5950,9455,7570]) addRule(rules,frequency,[1,2,3,4,5],1260,1320,'The Hal Turner Radio Show');
  }

  if (/YOUR UFO SHOW/i.test(text) && /M-F 8:30 PM TO 9 PM E\.T\./i.test(text)) {
    addRule(rules,5950,[1,2,3,4,5],1230,1260,'Your UFO Show');
  }

  if (/FIFTEEN MINUTE COUNTDOWN/i.test(text) && /SUNDAY EVENINGS 7:45PM EASTERN TIME USA ON 9955/i.test(text)) {
    addRule(rules,9955,[0],1185,1200,'Fifteen Minute Countdown');
    addRule(rules,7780,[3],540,555,'Fifteen Minute Countdown','UTC');
  }

  if (/ECHOS IN THE ETHER/i.test(text) && /FRIDAYS AT 11:00 PM EASTERN TIME ON 5950/i.test(text)) {
    addRule(rules,5950,[5],1380,1440,'Echos in the Ether');
    addRule(rules,9455,[0],0,60,'Echos in the Ether','UTC');
  }

  if (/TRUTH TO PONDER/i.test(text) && /9455 KHZ AT 10:00 PM EASTERN TIME/i.test(text)) {
    addRule(rules,9455,[1,2,4,5],1320,1380,'Truth to Ponder');
  }

  return rules;
}

async function resolveWrmiDirect(request) {
  const parts = requestParts(request);
  if (!/WRMI|RADIO MIAMI INTERNATIONAL/i.test(parts.station)) return null;
  if (!Number.isFinite(parts.frequency) || Number.isNaN(parts.at.getTime())) return null;

  let snapshot;
  try { snapshot = await wrmiSource(); } catch { return null; }
  const rules = wrmiEmergencyRules(snapshot.text).filter((rule)=>Math.abs(rule.frequency-parts.frequency)<0.6);
  if (!rules.length) return null;
  const { current, next } = ruleOccurrences(rules, parts.at);
  if (current.length !== 1) return null;
  const item = current[0];
  const data = {
    station:'WRMI', frequency:parts.frequency, at:parts.at.toISOString(), status:'verified', verified:true,
    program:item.title,
    window:formatWindow(item.startDate,item.endDate,parts.tz),
    start:item.startDate.toISOString(), end:item.endDate.toISOString(),
    next:next ? {
      program:next.title,
      window:formatWindow(next.startDate,next.endDate,parts.tz),
      start:next.startDate.toISOString()
    } : null,
    sourceUrl:WRMI_URL,
    sourceLabel:`WRMI official programming page${snapshot.stale ? ' · last known good snapshot' : ''}`,
    source:{
      id:'wrmi-direct', label:'WRMI official programming page', url:WRMI_URL,
      fetchedAt:snapshot.fetchedAt || null, refresh:'automatic',
      freshness:snapshot.stale ? 'stale-if-error' : 'fresh', stale:Boolean(snapshot.stale)
    }
  };
  await rememberVerified(data);
  return json(data);
}

async function fallbackVerified(request, env, ctx, parts) {
  const cached = await lastGoodFor(parts);
  if (cached) return json(cached);

  try {
    const response = await fallbackWorker.fetch(request, env, ctx);
    const data = await responseJson(response);
    if (data?.status === 'verified' && data.verified) {
      data.source = { ...(data.source || {}), freshness:'last-verified-resolver', fallback:true };
      data.sourceLabel = `${data.sourceLabel || 'Verified program guide'} · fallback while live refresh recovers`;
      await rememberVerified(data);
      return json(data);
    }
  } catch {}
  return null;
}

function sanitizedUnavailable(data, parts) {
  return json({
    ...(data || {}),
    station:data?.station || parts.station,
    frequency:Number.isFinite(data?.frequency) ? data.frequency : parts.frequency,
    at:data?.at || parts.at.toISOString(),
    status:'unverified', verified:false,
    message:'Exact program information is temporarily unavailable while FREQBEACON refreshes the broadcaster guide. The station and transmission identification are still valid.',
    sourceError:data?.message || null
  });
}

export default {
  async fetch(request, env, ctx) {
    const parts = requestParts(request);

    if (parts.url.pathname === '/api/program-guide') {
      // WRMI is fetched directly from its official page first. This avoids the
      // reader-service 429 that caused exact program titles to disappear.
      const directWrmi = await resolveWrmiDirect(request);
      if (directWrmi) return directWrmi;

      const response = await primaryWorker.fetch(request, env, ctx);
      const data = await responseJson(response);

      if (data?.status === 'verified' && data.verified) {
        await rememberVerified(data);
        return response;
      }

      const refreshFailed = response.status >= 500 || data?.status === 'unavailable';
      if (refreshFailed) {
        const fallback = await fallbackVerified(request, env, ctx, parts);
        if (fallback) return fallback;
        return sanitizedUnavailable(data, parts);
      }

      return response;
    }

    return primaryWorker.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    if (typeof primaryWorker.scheduled === 'function') return primaryWorker.scheduled(event, env, ctx);
  }
};
