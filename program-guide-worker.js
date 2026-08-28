const WBCQ_BASE = 'https://wbcq.com/schedule/index.php?fn=sked&freq=';
const WRMI_SOURCE = 'https://www.wrmi.net/index.php/programming/';
const WRMI_TIME_ZONE = 'America/New_York';

const DAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };

const WRMI_RULES = [
  { days:[1], start:'21:00', end:'24:00', frequency:5050, title:'WRMI Legends — Jeff Clark' },
  { days:[2], start:'00:00', end:'02:00', frequency:9455, title:'WRMI Legends — Jeff Clark' },
  { days:[2], start:'21:00', end:'24:00', frequency:5050, title:'WRMI Legends — Dave Mason' },
  { days:[3], start:'00:00', end:'02:00', frequency:9455, title:'WRMI Legends — Dave Mason' },
  { days:[3], start:'21:00', end:'24:00', frequency:5050, title:'WRMI Legends — Ted Randall' },
  { days:[4], start:'00:00', end:'02:00', frequency:9455, title:'WRMI Legends — Ted Randall' },
  { days:[4], start:'21:00', end:'24:00', frequency:5050, title:'WRMI Legends — Dan Collins' },
  { days:[5], start:'00:00', end:'02:00', frequency:9455, title:'WRMI Legends — Dan Collins' },
  { days:[5], start:'21:00', end:'24:00', frequency:5050, title:'WRMI Legends — Steve Hunter' },
  { days:[6], start:'00:00', end:'02:00', frequency:9455, title:'WRMI Legends — Steve Hunter' },
  { days:[6], start:'21:00', end:'24:00', frequency:5050, title:'WRMI Legends — Jeff Laurence' },
  { days:[0], start:'00:00', end:'02:00', frequency:9455, title:'WRMI Legends — Jeff Laurence' },
  { days:[0], start:'21:00', end:'22:00', frequency:5050, title:'Soldiers of Light Ministry' },
  { days:[0], start:'22:00', end:'23:00', frequency:5050, title:"Ria’s Ham Shack" },
  { days:[0], start:'23:00', end:'24:00', frequency:5050, title:'QSO Radio Show' },
  { days:[1], start:'00:00', end:'01:00', frequency:9455, title:'QSO Radio Show' },
  { days:[1], start:'01:00', end:'02:00', frequency:9455, title:'Soldiers of Light Ministry' },
  { days:[1,2,3,4,5], start:'20:30', end:'21:00', frequency:5950, title:'Your UFO Show' },
  { days:[4], start:'23:00', end:'24:00', frequency:9455, title:'SWL with The Tech Prepper' },
  { days:[6], start:'22:00', end:'22:30', frequency:9455, title:'The IQ40 with Chris O’Brien' },
  { days:[1,2,3,4,5], start:'22:00', end:'23:00', frequency:9455, title:'Christian America Ministries' },
  { days:[6,0], start:'22:00', end:'23:00', frequency:9395, title:'Christian America Ministries' },
  { days:[6], start:'21:00', end:'22:00', frequency:9395, title:'We Pluribus' }
];

const WRMI_UTC_RULES = [
  { days:[0,1,2,3,4,5,6], start:'11:00', end:'14:00', frequency:7570, title:'Supreme Master TV' },
  { days:[0,1,2,3,4,5,6], start:'14:00', end:'20:00', frequency:15770, title:'Supreme Master TV' },
  { days:[0,1,2,3,4,5,6], start:'20:00', end:'21:00', frequency:5950, title:'Supreme Master TV' },
  { days:[0,1,2,3,4,5,6], start:'21:00', end:'24:00', frequency:4980, title:'Supreme Master TV' },
  { days:[0], start:'00:00', end:'01:00', frequency:9455, title:'Echos in the Ether' }
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=120' }
  });
}

function normalizeStation(value) {
  return String(value || '').trim().toUpperCase();
}

function minutes(value) {
  const [h, m] = String(value).split(':').map(Number);
  return h * 60 + (m || 0);
}

function htmlDecode(value) {
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
    .replace(/\s+/g, ' ')
    .trim();
}

function parseWbcqRows(html) {
  const rows = [];
  for (const rowMatch of String(html || '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => htmlDecode(match[1]));
    if (cells.length < 5) continue;
    const frequency = Number(String(cells[0]).replace(/[^0-9.]/g, ''));
    const day = DAY[cells[1]];
    const start = String(cells[2] || '').replace(/\D/g, '').padStart(4, '0');
    const end = String(cells[3] || '').replace(/\D/g, '').padStart(4, '0');
    const program = cells[cells.length - 1];
    if (!Number.isFinite(frequency) || day == null || !/^\d{4}$/.test(start) || !/^\d{4}$/.test(end) || !program || /program title/i.test(program)) continue;
    rows.push({ frequency, day, start, end, title: program });
  }
  return rows;
}

function currentAndNextUtcRules(rules, at, frequency) {
  const now = at.getTime();
  const dayStart = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  const occurrences = [];
  for (const rule of rules.filter((item) => Math.abs(Number(item.frequency) - frequency) < 0.6)) {
    const startMin = Number(rule.start.slice(0,2)) * 60 + Number(rule.start.slice(2));
    let endMin = rule.end === '2400' ? 1440 : Number(rule.end.slice(0,2)) * 60 + Number(rule.end.slice(2));
    if (endMin <= startMin) endMin += 1440;
    for (let delta = -7; delta <= 7; delta += 1) {
      const date = new Date(dayStart + delta * 86400000);
      if (date.getUTCDay() !== rule.day) continue;
      const startDate = new Date(date.getTime() + startMin * 60000);
      const endDate = new Date(date.getTime() + endMin * 60000);
      occurrences.push({ startDate, endDate, title:rule.title });
    }
  }
  const current = occurrences
    .filter((occ) => occ.startDate.getTime() <= now && now < occ.endDate.getTime())
    .sort((a,b) => (a.endDate - a.startDate) - (b.endDate - b.startDate));
  const next = occurrences.filter((occ) => occ.startDate.getTime() > now).sort((a,b) => a.startDate - b.startDate)[0] || null;
  return { current, next };
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(date);
  const out = {};
  for (const part of parts) out[part.type] = part.value;
  return {
    weekday: DAY[out.weekday], year:Number(out.year), month:Number(out.month), day:Number(out.day),
    hour:Number(out.hour), minute:Number(out.minute)
  };
}

function zonedTimeToUtc(year, month, day, hour, minute, timeZone) {
  let guess = Date.UTC(year, month - 1, day, hour, minute);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  for (let i = 0; i < 3; i += 1) {
    const p = zonedParts(new Date(guess), timeZone);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += desired - seen;
  }
  return new Date(guess);
}

function addCalendarDays(parts, days) {
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return { year:base.getUTCFullYear(), month:base.getUTCMonth()+1, day:base.getUTCDate() };
}

function localOccurrence(at, rule, timeZone) {
  const local = zonedParts(at, timeZone);
  const startMin = minutes(rule.start);
  const endMin = minutes(rule.end);
  const candidates = [];
  for (const ruleDay of rule.days) {
    for (const week of [-7, 0, 7]) {
      const delta = (ruleDay - local.weekday + 7) % 7 + week;
      const date = addCalendarDays(local, delta);
      const startDate = zonedTimeToUtc(date.year, date.month, date.day, Math.floor(startMin/60), startMin%60, timeZone);
      let endDate;
      if (endMin === 1440) {
        const nextDate = addCalendarDays(date, 1);
        endDate = zonedTimeToUtc(nextDate.year, nextDate.month, nextDate.day, 0, 0, timeZone);
      } else {
        endDate = zonedTimeToUtc(date.year, date.month, date.day, Math.floor(endMin/60), endMin%60, timeZone);
      }
      candidates.push({ startDate, endDate });
    }
  }
  return candidates;
}

function currentAndNextLocalRules(rules, at, frequency, timeZone) {
  const now = at.getTime();
  const occurrences = [];
  for (const rule of rules.filter((item) => Math.abs(Number(item.frequency) - frequency) < 0.6)) {
    for (const occ of localOccurrence(at, rule, timeZone)) occurrences.push({ ...occ, title: rule.title });
  }
  const current = occurrences
    .filter((occ) => occ.startDate.getTime() <= now && now < occ.endDate.getTime())
    .sort((a,b) => (a.endDate - a.startDate) - (b.endDate - b.startDate));
  const next = occurrences.filter((occ) => occ.startDate.getTime() > now).sort((a,b) => a.startDate - b.startDate)[0] || null;
  return { current, next };
}

function formatWindow(startDate, endDate, timeZone) {
  if (!startDate || !endDate) return '';
  try {
    const time = new Intl.DateTimeFormat('en-US', { timeZone, hour:'numeric', minute:'2-digit', hour12:true });
    const zone = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName:'short' })
      .formatToParts(startDate).find((part) => part.type === 'timeZoneName')?.value || '';
    return `${time.format(startDate)}–${time.format(endDate)}${zone ? ` ${zone}` : ''}`;
  } catch {
    return `${startDate.toISOString().slice(11,16)}–${endDate.toISOString().slice(11,16)} UTC`;
  }
}

function responseFromMatches({ station, frequency, at, current, next, sourceUrl, sourceLabel, displayTimeZone }) {
  if (current.length > 1) {
    return {
      station, frequency, at: at.toISOString(), status:'ambiguous', verified:false,
      candidates:[...new Set(current.map((item) => item.title))],
      message:'The broadcaster’s published listings overlap at this time, so FreqBeacon will not guess.',
      sourceUrl, sourceLabel
    };
  }
  if (current.length === 1) {
    const item = current[0];
    return {
      station, frequency, at: at.toISOString(), status:'verified', verified:true,
      program:item.title,
      window:formatWindow(item.startDate, item.endDate, displayTimeZone),
      start:item.startDate.toISOString(), end:item.endDate.toISOString(),
      next: next ? { program:next.title, window:formatWindow(next.startDate, next.endDate, displayTimeZone), start:next.startDate.toISOString() } : null,
      sourceUrl, sourceLabel
    };
  }
  return {
    station, frequency, at:at.toISOString(), status:'unverified', verified:false,
    message:'Exact program not verified for this transmission block.',
    next: next ? { program:next.title, window:formatWindow(next.startDate, next.endDate, displayTimeZone), start:next.startDate.toISOString() } : null,
    sourceUrl, sourceLabel
  };
}

async function wbcqGuide(frequency, at, displayTimeZone) {
  const sourceUrl = `${WBCQ_BASE}${encodeURIComponent(Math.round(frequency))}`;
  let response;
  try {
    response = await fetch(sourceUrl, {
      headers: { Accept:'text/html,application/xhtml+xml', 'User-Agent':'FreqBeacon/1.0 program identification' },
      cf: { cacheTtl:300, cacheEverything:true }
    });
  } catch {
    return { station:'WBCQ', frequency, at:at.toISOString(), status:'unavailable', verified:false, message:'WBCQ program guide could not be reached.', sourceUrl, sourceLabel:'WBCQ official program guide' };
  }
  if (!response.ok) return { station:'WBCQ', frequency, at:at.toISOString(), status:'unavailable', verified:false, message:`WBCQ program guide HTTP ${response.status}.`, sourceUrl, sourceLabel:'WBCQ official program guide' };
  const rows = parseWbcqRows(await response.text()).filter((row) => Math.abs(row.frequency - frequency) < 0.6);
  if (!rows.length) return { station:'WBCQ', frequency, at:at.toISOString(), status:'unverified', verified:false, message:'No frequency-specific WBCQ program listing was published for this carrier.', sourceUrl, sourceLabel:'WBCQ official program guide' };
  const { current, next } = currentAndNextUtcRules(rows, at, frequency);
  return responseFromMatches({ station:'WBCQ', frequency, at, current, next, sourceUrl, sourceLabel:'WBCQ official program guide', displayTimeZone });
}

function wrmiGuide(frequency, at, displayTimeZone) {
  const local = currentAndNextLocalRules(WRMI_RULES, at, frequency, WRMI_TIME_ZONE);
  const expandedUtc = [];
  for (const rule of WRMI_UTC_RULES) {
    for (const day of rule.days) {
      expandedUtc.push({ ...rule, day, start:rule.start.replace(':',''), end:rule.end === '24:00' ? '2400' : rule.end.replace(':','') });
    }
  }
  const utcMatches = currentAndNextUtcRules(expandedUtc, at, frequency);
  const current = [...local.current, ...utcMatches.current].sort((a,b) => (a.endDate-a.startDate) - (b.endDate-b.startDate));
  const nextCandidates = [local.next, utcMatches.next].filter(Boolean).sort((a,b) => a.startDate-b.startDate);
  return responseFromMatches({
    station:'WRMI', frequency, at, current, next:nextCandidates[0] || null,
    sourceUrl:WRMI_SOURCE, sourceLabel:'WRMI official programming page (verified Aug 27, 2026)', displayTimeZone
  });
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
  try { new Intl.DateTimeFormat('en-US', { timeZone:displayTimeZone }).format(at); }
  catch { return json({ status:'error', message:'Invalid time zone.' }, 400); }

  if (station.includes('WBCQ')) return json(await wbcqGuide(frequency, at, displayTimeZone));
  if (station.includes('WRMI') || station.includes('RADIO MIAMI INTERNATIONAL')) return json(wrmiGuide(frequency, at, displayTimeZone));

  return json({
    station, frequency, at:at.toISOString(), status:'unsupported', verified:false,
    message:'Exact program guide is not yet integrated for this broadcaster.'
  });
}
