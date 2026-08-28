import baseWorker from './worker-program-v6.js';

const SOURCE_CONFIG = {
  wrmi: {
    id:'wrmi', station:'WRMI', url:'https://www.wrmi.net/index.php/programming/',
    reader:true, ttl:3600, label:'WRMI official programming page'
  },
  wwcr: {
    id:'wwcr', station:'WWCR', url:'https://www.wwcr.com/program-guides/WWCR_Program_Guide.xls',
    reader:true, ttl:14400, label:'WWCR official Program Guide'
  },
  ewtn: {
    id:'ewtn', station:'WEWN / EWTN', url:'https://www.ewtn.com/radio/schedule',
    reader:true, ttl:3600, label:'EWTN official radio schedule'
  },
  rri: {
    id:'rri', station:'Radio Romania International', url:'https://www.rri.ro/en/frequencies',
    reader:true, ttl:7200, label:'Radio Romania International official frequencies'
  },
  omiss: {
    id:'omiss', station:'OMISS amateur nets', url:'https://omiss.net/Facelift/index.php',
    reader:true, ttl:1800, label:'OMISS published net schedule'
  }
};

const ET = 'America/New_York';
const CT = 'America/Chicago';
const DAY = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
const DAY_WORD = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };

function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers:{ 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' }
  });
}

function normalizeSpace(value) {
  return String(value || '').replace(/\r/g,'').replace(/[\t ]+/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}

function stripMarkdown(value) {
  return String(value || '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g,' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g,'$1')
    .replace(/[*_`>#]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

async function cachedSource(config, { force=false }={}) {
  const cache = caches.default;
  const key = new Request(`https://freqbeacon-cache.invalid/program-source/${config.id}`);
  if (!force) {
    const hit = await cache.match(key);
    if (hit) {
      return {
        text:await hit.text(),
        fetchedAt:hit.headers.get('x-freqbeacon-source-fetched-at') || null,
        cached:true,
        extractor:hit.headers.get('x-freqbeacon-source-extractor') || (config.reader ? 'reader' : 'direct')
      };
    }
  }

  const fetchUrl = config.reader ? `https://r.jina.ai/${config.url}` : config.url;
  const requestHeaders = {
    Accept:'text/plain,text/markdown,text/html;q=0.9,*/*;q=0.5',
    'User-Agent':'FreqBeacon/1.0 schedule refresh'
  };
  if (config.reader) {
    requestHeaders['X-Cache-Tolerance'] = String(config.ttl);
    if (force) requestHeaders['X-No-Cache'] = 'true';
  }
  const response = await fetch(fetchUrl, {
    headers:requestHeaders,
    cf:{ cacheTtl:Math.min(config.ttl, 3600), cacheEverything:true }
  });
  if (!response.ok) throw new Error(`${config.id} source HTTP ${response.status}`);
  const text = await response.text();
  if (!text || text.length < 120) throw new Error(`${config.id} source was empty`);
  const fetchedAt = new Date().toISOString();
  const headers = new Headers({
    'content-type':'text/plain; charset=utf-8',
    'cache-control':`public, max-age=${config.ttl}`,
    'x-freqbeacon-source-fetched-at':fetchedAt,
    'x-freqbeacon-source-extractor':config.reader ? 'reader' : 'direct'
  });
  await cache.put(key, new Response(text, { headers }));
  return { text, fetchedAt, cached:false, extractor:config.reader ? 'reader' : 'direct' };
}

function sourceMeta(config, snapshot) {
  return {
    id:config.id,
    label:config.label,
    url:config.url,
    fetchedAt:snapshot?.fetchedAt || null,
    cached:Boolean(snapshot?.cached),
    extractor:snapshot?.extractor || (config.reader ? 'reader' : 'direct'),
    refresh:'automatic',
    ttlSeconds:config.ttl
  };
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday:'short', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(date);
  const out = {};
  for (const part of parts) out[part.type] = part.value;
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
  const hour = Math.floor((minuteOfDay % 1440) / 60);
  const minute = minuteOfDay % 60;
  const desired = Date.UTC(y,m,d,hour,minute);
  let guess = desired;
  for (let i=0; i<4; i += 1) {
    const seen = zonedParts(new Date(guess), timeZone);
    const seenWall = Date.UTC(seen.year, seen.month-1, seen.day, seen.hour, seen.minute);
    guess += desired - seenWall;
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

function parse12Hour(clock, ap) {
  const match = String(clock).match(/(\d{1,2})(?::(\d{2}))?/);
  if (!match) return null;
  let h = Number(match[1]);
  const m = Number(match[2] || 0);
  const mer = String(ap || '').toLowerCase();
  if (mer.startsWith('p') && h < 12) h += 12;
  if (mer.startsWith('a') && h === 12) h = 0;
  if (h > 23 || m > 59) return null;
  return h*60+m;
}

function parseUtcClock(value) {
  const clean = String(value || '').replace(/[^0-9]/g,'').padStart(4,'0');
  if (!/^\d{4}$/.test(clean)) return null;
  const h = Number(clean.slice(0,2));
  const m = Number(clean.slice(2));
  if (h > 23 || m > 59) return null;
  return h*60+m;
}

function daysFromText(value) {
  const text = String(value || '').toLowerCase();
  if (/\b(?:daily|every day|seven days|7 days)\b/.test(text)) return [0,1,2,3,4,5,6];
  if (/monday\s*(?:-|through|thru|to)\s*friday/.test(text)) return [1,2,3,4,5];
  if (/saturday\s*(?:-|through|thru|to)\s*sunday/.test(text)) return [6,0];
  const out = [];
  for (const [name, day] of Object.entries(DAY_WORD)) {
    if (new RegExp(`\\b${name}s?\\b`).test(text)) out.push(day);
  }
  return [...new Set(out)];
}

function nextOccurrence(rules, at, frequency, timeZone) {
  const now = at.getTime();
  const localNow = zonedParts(at, timeZone);
  const occurrences = [];
  for (const rule of rules.filter((r)=>Math.abs(Number(r.frequency)-frequency)<0.6)) {
    for (let delta=-1; delta<=8; delta += 1) {
      const base = new Date(Date.UTC(localNow.year,localNow.month-1,localNow.day+delta));
      const parts = {
        year:base.getUTCFullYear(), month:base.getUTCMonth()+1, day:base.getUTCDate(),
        weekday:base.getUTCDay()
      };
      if (!rule.days.includes(parts.weekday)) continue;
      const start = zonedTimeToUtc(parts, rule.start, timeZone);
      const dayOffset = rule.end <= rule.start ? 1 : 0;
      const end = zonedTimeToUtc(parts, rule.end, timeZone, dayOffset);
      occurrences.push({ ...rule, startDate:start, endDate:end });
    }
  }
  const current = occurrences.filter((o)=>o.startDate.getTime()<=now && now<o.endDate.getTime())
    .sort((a,b)=>(a.endDate-a.startDate)-(b.endDate-b.startDate));
  const next = occurrences.filter((o)=>o.startDate.getTime()>now).sort((a,b)=>a.startDate-b.startDate)[0] || null;
  return { current, next };
}

function responseFromRules({station,frequency,at,displayTimeZone,rules,timeZone,config,snapshot,status='verified'}) {
  const { current, next } = nextOccurrence(rules, at, frequency, timeZone);
  if (current.length > 1) {
    return json({
      station,frequency,at:at.toISOString(),status:'ambiguous',verified:false,
      candidates:[...new Set(current.map((r)=>r.title))],
      message:'The current official source produced overlapping program listings, so FREQBEACON will not guess.',
      sourceUrl:config.url,sourceLabel:config.label,source:sourceMeta(config,snapshot)
    });
  }
  if (current.length !== 1) return null;
  const item = current[0];
  return json({
    station,frequency,at:at.toISOString(),status,verified:true,
    program:item.title,
    window:formatWindow(item.startDate,item.endDate,displayTimeZone),
    start:item.startDate.toISOString(),end:item.endDate.toISOString(),
    next:next ? {
      program:next.title,
      window:formatWindow(next.startDate,next.endDate,displayTimeZone),
      start:next.startDate.toISOString()
    } : null,
    sourceUrl:config.url,sourceLabel:config.label,source:sourceMeta(config,snapshot)
  });
}

function markdownSections(text) {
  const source = normalizeSpace(text);
  const matches = [...source.matchAll(/^#{1,4}\s+(.+)$/gm)];
  const sections = [];
  for (let i=0; i<matches.length; i += 1) {
    const start = matches[i].index + matches[i][0].length;
    const end = matches[i+1]?.index ?? source.length;
    sections.push({ title:stripMarkdown(matches[i][1]), body:source.slice(start,end).trim() });
  }
  return sections;
}

function durationHint(title, body) {
  const text = `${title} ${body}`;
  if (/\bfifteen[- ]minute|\b15[- ]minute/i.test(text)) return 15;
  if (/\bhalf[- ]hour|\b30[- ]minute/i.test(text)) return 30;
  if (/\bhour[- ]long|\bone[- ]hour|\b60[- ]minute/i.test(text)) return 60;
  return 60;
}

function addWrmiRule(rules, seen, {title,days,frequency,start,end,zone}) {
  if (!title || !days.length || !Number.isFinite(frequency) || start == null || end == null) return;
  const key = `${zone}|${days.join('')}|${frequency}|${start}|${end}|${title}`;
  if (seen.has(key)) return;
  seen.add(key);
  rules.push({title,days,frequency,start,end,zone});
}

function parseWrmiRules(text) {
  const rules = [];
  const seen = new Set();
  const sections = markdownSections(text);
  const ignored = /^(?:wrmi programming|programación|how to hear wrmi|cómo escuchar wrmi|information about some of our programs|english section)$/i;

  for (const section of sections) {
    const title = section.title.trim();
    if (!title || ignored.test(title) || title.length > 120) continue;
    const body = stripMarkdown(section.body);
    const duration = durationHint(title, body);

    const etPattern = /((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:s|\s*(?:-|through|thru|to)\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))?|Monday-Friday|Saturday-Sunday|daily|every day)[^\n.]{0,180}?(\d{1,2}:\d{2})\s*(AM|PM)[^\n.]{0,140}?(\d{4,5})\s*kHz/gi;
    for (const match of body.matchAll(etPattern)) {
      const days = daysFromText(match[1]);
      const start = parse12Hour(match[2],match[3]);
      const frequency = Number(match[4]);
      addWrmiRule(rules,seen,{title,days,frequency,start,end:(start+duration)%1440,zone:'ET'});
    }

    const freqFirst = /(\d{4,5})\s*kHz[^\n.]{0,120}?(?:at\s+)?(\d{1,2}:\d{2})\s*(AM|PM)[^\n.]{0,120}?((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:s|\s*(?:-|through|thru|to)\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday))?|Monday-Friday|Saturday-Sunday|daily|every day)/gi;
    for (const match of body.matchAll(freqFirst)) {
      const frequency = Number(match[1]);
      const start = parse12Hour(match[2],match[3]);
      const days = daysFromText(match[4]);
      addWrmiRule(rules,seen,{title,days,frequency,start,end:(start+duration)%1440,zone:'ET'});
    }

    const utcPattern = /((?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)(?:s)?|daily)?[^\n]{0,80}?(\d{4})(?:\s*[-–]\s*(\d{4}))?\s*UTC[^\n]{0,160}?(?:on\s+)?(\d{4,5})\s*kHz/gi;
    for (const match of body.matchAll(utcPattern)) {
      const days = daysFromText(match[1] || body.slice(Math.max(0,match.index-80),match.index+20));
      if (!days.length) continue;
      const start = parseUtcClock(match[2]);
      const explicitEnd = match[3] ? parseUtcClock(match[3]) : null;
      const end = explicitEnd == null ? (start+duration)%1440 : explicitEnd;
      addWrmiRule(rules,seen,{title,days,frequency:Number(match[4]),start,end,zone:'UTC'});
    }
  }
  return rules;
}

function unavailableFromSource(config, station, frequency, at, message, snapshot=null) {
  return json({
    station, frequency, at:at.toISOString(), status:'unavailable', verified:false,
    message,
    sourceUrl:config.url, sourceLabel:config.label,
    source:snapshot ? sourceMeta(config,snapshot) : { id:config.id, label:config.label, url:config.url, refresh:'automatic', ttlSeconds:config.ttl }
  });
}

function unverifiedFromSource(config, station, frequency, at, message, snapshot) {
  return json({
    station, frequency, at:at.toISOString(), status:'unverified', verified:false,
    message,
    sourceUrl:config.url, sourceLabel:config.label, source:sourceMeta(config,snapshot)
  });
}

async function resolveWrmi(request) {
  const url = new URL(request.url);
  const station = String(url.searchParams.get('station') || '');
  if (!/WRMI|RADIO MIAMI INTERNATIONAL/i.test(station)) return null;
  const frequency = Number(url.searchParams.get('frequency'));
  const at = url.searchParams.get('at') ? new Date(url.searchParams.get('at')) : new Date();
  const displayTimeZone = url.searchParams.get('tz') || 'UTC';
  if (!Number.isFinite(frequency) || Number.isNaN(at.getTime())) return null;
  let snapshot;
  try { snapshot = await cachedSource(SOURCE_CONFIG.wrmi); } catch (error) { return unavailableFromSource(SOURCE_CONFIG.wrmi,'WRMI',frequency,at,`Official WRMI schedule refresh failed: ${error?.message || error}`); }
  const all = parseWrmiRules(snapshot.text);
  const localRules = all.filter((r)=>r.zone==='ET');
  const utcRules = all.filter((r)=>r.zone==='UTC');
  const local = responseFromRules({station:'WRMI',frequency,at,displayTimeZone,rules:localRules,timeZone:ET,config:SOURCE_CONFIG.wrmi,snapshot});
  if (local) return local;
  const utc = responseFromRules({station:'WRMI',frequency,at,displayTimeZone,rules:utcRules,timeZone:'UTC',config:SOURCE_CONFIG.wrmi,snapshot});
  if (utc) return utc;
  return unverifiedFromSource(SOURCE_CONFIG.wrmi,'WRMI',frequency,at,'The refreshed WRMI programming page does not expose a confident exact-show match for this frequency and minute.',snapshot);
}

function splitPipeRow(line) {
  if (!String(line).includes('|')) return [];
  return String(line).replace(/^\s*\|/,'').replace(/\|\s*$/,'').split('|').map((v)=>stripMarkdown(v));
}

function parseCentralClock(value) {
  const match = String(value || '').match(/^(\d{1,2})(?::(\d{2}))?\s*([AP])(?:M)?$/i);
  if (!match) return null;
  return parse12Hour(`${match[1]}:${match[2] || '00'}`,match[3]);
}

function wwcrDays(title, groupDays) {
  const text = String(title || '');
  const prefix = text.match(/^\(([^)]+)\)\s*/)?.[1] || '';
  if (!prefix) return groupDays;
  const p = prefix.toUpperCase().replace(/\s/g,'');
  if (p === 'M') return [1];
  if (p === 'T-F' || p === 'TU-F') return [2,3,4,5];
  if (p === 'M-W') return [1,2,3];
  if (p === 'TH-FR' || p === 'TH-F') return [4,5];
  return groupDays;
}

function parseWwcrEntries(text) {
  const entries = [];
  const currentFreq = [null,null,null];
  const lastTitle = [null,null,null];
  const groupDays = [[1,2,3,4,5],[6],[0]];
  for (const line of String(text || '').split(/\n/)) {
    const cells = splitPipeRow(line);
    if (cells.length < 9) continue;
    if (cells.every((c)=>/^:?-{2,}:?$/.test(c) || !c)) continue;
    for (let group=0; group<3; group += 1) {
      const base = group*3;
      const timeCell = cells[base] || '';
      let title = cells[base+1] || '';
      const freqMatch = `${timeCell} ${title}`.match(/(\d{1,2}\.\d{3})\s*(?:m?hz)/i);
      if (freqMatch) {
        currentFreq[group] = Number(freqMatch[1])*1000;
        lastTitle[group] = null;
        continue;
      }
      const start = parseCentralClock(timeCell);
      if (start == null || !currentFreq[group]) continue;
      if (/^["“”]+$/.test(title)) title = lastTitle[group] || '';
      if (!title) continue;
      const days = wwcrDays(title,groupDays[group]);
      title = title.replace(/^\([^)]+\)\s*/,'').trim();
      if (!title || /program title|host\/sponsor/i.test(title)) continue;
      lastTitle[group] = title;
      entries.push({ days, frequency:currentFreq[group], start, title });
    }
  }
  return entries;
}

function buildWwcrRules(entries) {
  const rules = [];
  for (let day=0; day<=6; day += 1) {
    const dayEntries = entries.filter((e)=>e.days.includes(day)).sort((a,b)=>a.start-b.start);
    for (let i=0; i<dayEntries.length; i += 1) {
      const item = dayEntries[i];
      const next = dayEntries.slice(i+1).find((e)=>e.start>item.start);
      const end = next ? next.start : 1440;
      if (end === item.start) continue;
      rules.push({days:[day],frequency:item.frequency,start:item.start,end,title:item.title});
    }
  }
  return rules;
}

async function resolveWwcr(request) {
  const url = new URL(request.url);
  const station = String(url.searchParams.get('station') || '');
  if (!/^WWCR$/i.test(station)) return null;
  const frequency = Number(url.searchParams.get('frequency'));
  const at = url.searchParams.get('at') ? new Date(url.searchParams.get('at')) : new Date();
  const displayTimeZone = url.searchParams.get('tz') || 'UTC';
  if (!Number.isFinite(frequency) || Number.isNaN(at.getTime())) return null;
  let snapshot;
  try { snapshot = await cachedSource(SOURCE_CONFIG.wwcr); } catch (error) { return unavailableFromSource(SOURCE_CONFIG.wwcr,'WWCR',frequency,at,`Official WWCR program guide refresh failed: ${error?.message || error}`); }
  const rules = buildWwcrRules(parseWwcrEntries(snapshot.text));
  if (rules.length < 25) return unavailableFromSource(SOURCE_CONFIG.wwcr,'WWCR',frequency,at,'The refreshed WWCR guide could not be parsed confidently, so FREQBEACON is refusing to serve the older compiled schedule as current.',snapshot);
  return responseFromRules({station:'WWCR',frequency,at,displayTimeZone,rules,timeZone:CT,config:SOURCE_CONFIG.wwcr,snapshot})
    || unverifiedFromSource(SOURCE_CONFIG.wwcr,'WWCR',frequency,at,'The refreshed WWCR guide has no exact listing for this frequency and minute.',snapshot);
}

function parseEwtnEntries(text) {
  const out = [];
  const lines = String(text || '').split(/\n/);
  for (let i=0; i<lines.length; i += 1) {
    const cells = splitPipeRow(lines[i]);
    if (cells.length >= 2) {
      const timeIndex = cells.findIndex((c)=>/\b\d{1,2}:\d{2}\s*(?:AM|PM)\b/i.test(c));
      if (timeIndex >= 0) {
        const match = cells[timeIndex].match(/(\d{1,2}:\d{2})\s*(AM|PM)/i);
        const start = parse12Hour(match?.[1],match?.[2]);
        const title = cells.slice(timeIndex+1).find((c)=>c && !/listen|schedule|eastern|central|mountain|pacific/i.test(c));
        if (start != null && title) out.push({start,title});
      }
    }
    const plain = stripMarkdown(lines[i]);
    const match = plain.match(/^(\d{1,2}:\d{2})\s*(AM|PM)\s+(.{3,100})$/i);
    if (match) {
      const start = parse12Hour(match[1],match[2]);
      if (start != null) out.push({start,title:match[3].trim()});
    }
  }
  const seen = new Set();
  return out.filter((e)=>{
    const key=`${e.start}|${e.title}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).sort((a,b)=>a.start-b.start);
}

async function resolveEwtn(request) {
  const url = new URL(request.url);
  const station = String(url.searchParams.get('station') || '');
  if (!/(?:WEWN|EWTN|ETERNAL WORD)/i.test(station)) return null;
  const language = String(url.searchParams.get('language') || '');
  if (language && !/english/i.test(language)) return null;
  const frequency = Number(url.searchParams.get('frequency'));
  const at = url.searchParams.get('at') ? new Date(url.searchParams.get('at')) : new Date();
  const displayTimeZone = url.searchParams.get('tz') || 'UTC';
  if (!Number.isFinite(frequency) || Number.isNaN(at.getTime())) return null;
  let snapshot;
  try { snapshot = await cachedSource(SOURCE_CONFIG.ewtn); } catch (error) { return unavailableFromSource(SOURCE_CONFIG.ewtn,'WEWN / EWTN',frequency,at,`Official EWTN schedule refresh failed: ${error?.message || error}`); }
  const entries = parseEwtnEntries(snapshot.text);
  if (entries.length < 8) return unavailableFromSource(SOURCE_CONFIG.ewtn,'WEWN / EWTN',frequency,at,'The refreshed EWTN schedule did not expose enough clocked entries to identify the exact show confidently.',snapshot);
  const rules = entries.map((entry,i)=>({
    days:[0,1,2,3,4,5,6], frequency, start:entry.start,
    end:entries[i+1]?.start ?? 1440, title:entry.title
  })).filter((r)=>r.end>r.start);
  return responseFromRules({station:'WEWN / EWTN',frequency,at,displayTimeZone,rules,timeZone:ET,config:SOURCE_CONFIG.ewtn,snapshot})
    || unverifiedFromSource(SOURCE_CONFIG.ewtn,'WEWN / EWTN',frequency,at,'The refreshed EWTN schedule has no exact program match for this minute.',snapshot);
}

function parseRriRules(text) {
  const rules = [];
  let currentArea = '';
  for (const line of String(text || '').split(/\n/)) {
    const cells = splitPipeRow(line);
    if (cells.length < 2) continue;
    if (cells[0] && !/\d/.test(cells[0]) && !/utc|frequency|area/i.test(cells[0])) currentArea = cells[0];
    const timeCell = cells.find((c)=>/\b\d{1,2}[.:]\d{2}\s*[–-]\s*\d{1,2}[.:]\d{2}\b/.test(c));
    if (!timeCell) continue;
    const match = timeCell.match(/(\d{1,2})[.:](\d{2})\s*[–-]\s*(\d{1,2})[.:](\d{2})/);
    if (!match) continue;
    const start = Number(match[1])*60+Number(match[2]);
    const end = Number(match[3])*60+Number(match[4]);
    const frequencies = cells
      .filter((c)=>c!==timeCell)
      .flatMap((c)=>[...c.matchAll(/\b(\d{1,2}[,.]\d{3}|\d{4,5})\b/g)].map((m)=>Number(m[1].replace(/[,.]/,''))))
      .filter((n)=>Number.isFinite(n) && n>=3000 && n<=30000);
    for (const frequency of frequencies) {
      rules.push({days:[0,1,2,3,4,5,6],frequency,start,end,title:`RRI English Language Broadcast${currentArea ? ` · ${currentArea}` : ''}`});
    }
  }
  return rules;
}

async function resolveRri(request) {
  const url = new URL(request.url);
  const station = String(url.searchParams.get('station') || '');
  if (!/RADIO ROMANIA INTERNATIONAL/i.test(station)) return null;
  const language = String(url.searchParams.get('language') || '');
  if (language && !/english/i.test(language)) return null;
  const frequency = Number(url.searchParams.get('frequency'));
  const at = url.searchParams.get('at') ? new Date(url.searchParams.get('at')) : new Date();
  const displayTimeZone = url.searchParams.get('tz') || 'UTC';
  if (!Number.isFinite(frequency) || Number.isNaN(at.getTime())) return null;
  let snapshot;
  try { snapshot = await cachedSource(SOURCE_CONFIG.rri); } catch (error) { return unavailableFromSource(SOURCE_CONFIG.rri,'Radio Romania International',frequency,at,`Official RRI frequency schedule refresh failed: ${error?.message || error}`); }
  const rules = parseRriRules(snapshot.text);
  if (rules.length < 6) return unavailableFromSource(SOURCE_CONFIG.rri,'Radio Romania International',frequency,at,'The refreshed RRI frequency page could not be parsed confidently.',snapshot);
  return responseFromRules({station:'Radio Romania International',frequency,at,displayTimeZone,rules,timeZone:'UTC',config:SOURCE_CONFIG.rri,snapshot,status:'broadcast'})
    || unverifiedFromSource(SOURCE_CONFIG.rri,'Radio Romania International',frequency,at,'The refreshed RRI frequency page has no matching English broadcast block for this carrier and minute.',snapshot);
}

function omissDays(value) {
  const text = String(value || '').toLowerCase();
  if (/daily/.test(text)) return [0,1,2,3,4,5,6];
  const out = [];
  if (/sun/.test(text)) out.push(0);
  if (/mon/.test(text)) out.push(1);
  if (/tue/.test(text)) out.push(2);
  if (/wed/.test(text)) out.push(3);
  if (/thu/.test(text)) out.push(4);
  if (/fri/.test(text)) out.push(5);
  if (/sat/.test(text)) out.push(6);
  return [...new Set(out)];
}

function parseOmissNets(text) {
  const nets = [];
  for (const line of String(text || '').split(/\n/)) {
    const clean = stripMarkdown(line);
    const match = clean.match(/\b(160|80|40|20|17|15|12|10)m(?:\s+Late)?\b[^0-9]{0,30}(\d{4})z[^0-9]{0,30}(\d{1,2}\.\d{3})\s*MHz/i);
    if (!match) continue;
    const band = `${match[1]}m`;
    const timeUtc = match[2];
    const frequencyMHz = Number(match[3]);
    if (!Number.isFinite(frequencyMHz)) continue;
    const days = omissDays(clean);
    const dayTextMatch = clean.match(/MHz[^A-Za-z]*(.+?)(?:,\s*[A-Z0-9#]|$)/i);
    nets.push({
      band, label:/Late/i.test(clean) ? 'OMISS late SSB net' : 'OMISS SSB net',
      timeUtc, frequencyMHz, days,
      scheduleText:(dayTextMatch?.[1] || '').replace(/\s+/g,' ').trim() || 'Published OMISS schedule',
      sourceUrl:SOURCE_CONFIG.omiss.url, sourceLabel:SOURCE_CONFIG.omiss.label
    });
  }
  const seen = new Set();
  return nets.filter((net)=>{
    const key=`${net.band}|${net.timeUtc}|${net.frequencyMHz}|${net.days.join('')}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

async function hamActivityResponse(force=false) {
  let snapshot;
  try { snapshot = await cachedSource(SOURCE_CONFIG.omiss,{force}); }
  catch (error) {
    return json({status:'unavailable',updatedAt:new Date().toISOString(),message:String(error?.message || error),nets:[],source:{id:'omiss',url:SOURCE_CONFIG.omiss.url,refresh:'automatic'}} , 503);
  }
  const nets = parseOmissNets(snapshot.text);
  return json({
    status:nets.length ? 'ok' : 'unavailable',
    updatedAt:new Date().toISOString(),
    nets,
    source:sourceMeta(SOURCE_CONFIG.omiss,snapshot)
  }, nets.length ? 200 : 503);
}

async function resolveDynamicGuide(request) {
  return await resolveWrmi(request)
    || await resolveWwcr(request)
    || await resolveEwtn(request)
    || await resolveRri(request)
    || null;
}

async function sourceHealth(force=false) {
  const rows = [];
  for (const config of Object.values(SOURCE_CONFIG)) {
    const started = Date.now();
    try {
      const snapshot = await cachedSource(config,{force});
      rows.push({
        id:config.id,station:config.station,status:'ok',refresh:'automatic',ttlSeconds:config.ttl,
        sourceUrl:config.url,fetchedAt:snapshot.fetchedAt,cached:snapshot.cached,extractor:snapshot.extractor,
        bytes:snapshot.text.length,latencyMs:Date.now()-started
      });
    } catch (error) {
      rows.push({id:config.id,station:config.station,status:'error',refresh:'automatic',sourceUrl:config.url,message:String(error?.message || error),latencyMs:Date.now()-started});
    }
  }
  return rows;
}

async function injectRefreshRuntime(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;
  let html = await response.text();
  if (!html.includes('ham-activity-guide.js')) {
    html = html.replace(
      '<script src="ham-ui.js?v=1"></script>',
      '<script src="ham-activity-guide.js?v=1"></script>\n  <script src="ham-ui.js?v=1"></script>'
    );
  }
  const headers = new Headers(response.headers);
  headers.set('content-type','text/html; charset=utf-8');
  headers.set('cache-control','no-store, max-age=0');
  headers.set('x-freqbeacon-schedule-refresh','v1');
  return new Response(html,{status:response.status,statusText:response.statusText,headers});
}

async function warmSources() {
  await Promise.allSettled(Object.values(SOURCE_CONFIG).map((config)=>cachedSource(config,{force:true})));
}

function patchFullDataAutoSeason(source) {
  const seasonPrelude = [
    "  function lastSundayUtc(year, monthIndex) {",
    "    const d = new Date(Date.UTC(year, monthIndex + 1, 0));",
    "    d.setUTCDate(d.getUTCDate() - d.getUTCDay());",
    "    return d;",
    "  }",
    "",
    "  function hfccSeasonFor(date = new Date()) {",
    "    const year = date.getUTCFullYear();",
    "    const yy = String(year).slice(-2);",
    "    const aStart = lastSundayUtc(year, 2);",
    "    const bStart = lastSundayUtc(year, 9);",
    "    return date >= aStart && date < bStart ? `A${yy}` : `B${yy}`;",
    "  }",
    "",
    "  function hfccSeasonCandidates(date = new Date()) {",
    "    const current = hfccSeasonFor(date);",
    "    const year = date.getUTCFullYear();",
    "    const yy = String(year).slice(-2);",
    "    const prevYear = String(year - 1).slice(-2);",
    "    return current.startsWith('A')",
    "      ? [current, `B${prevYear}`, `A${prevYear}`]",
    "      : [current, `A${yy}`, `B${prevYear}`];",
    "  }",
    "",
    "  const SCHEDULE_BASE = 'https://raw.githubusercontent.com/Roger-Need/StationFinder/main/Frequency%20Lists/Merged/';",
    "  let ACTIVE_HFCC_SEASON = hfccSeasonFor();",
    "",
    "  async function fetchCurrentSchedule() {",
    "    let lastError = null;",
    "    for (const season of hfccSeasonCandidates()) {",
    "      const filename = encodeURIComponent(`${season} merged_schedule.csv`);",
    "      try {",
    "        const response = await fetch(`${SCHEDULE_BASE}${filename}`, { cache: 'default' });",
    "        if (!response.ok) {",
    "          lastError = new Error(`${season} schedule fetch failed (${response.status})`);",
    "          continue;",
    "        }",
    "        ACTIVE_HFCC_SEASON = season;",
    "        return { response, season };",
    "      } catch (error) {",
    "        lastError = error;",
    "      }",
    "    }",
    "    throw lastError || new Error('No current HFCC/EiBi season feed is available');",
    "  }"
  ].join('\n');

  let patched = String(source || '').replace(
    "  const SCHEDULE_URL = 'https://raw.githubusercontent.com/Roger-Need/StationFinder/main/Frequency%20Lists/Merged/A26%20merged_schedule.csv';",
    seasonPrelude
  );

  patched = patched.replace(
    "      const [scheduleResponse, countriesResponse] = await Promise.all([\n        fetch(SCHEDULE_URL, { cache: 'default' }),\n        fetch(COUNTRIES_URL, { cache: 'default' })\n      ]);",
    "      const [scheduleLoad, countriesResponse] = await Promise.all([\n        fetchCurrentSchedule(),\n        fetch(COUNTRIES_URL, { cache: 'default' })\n      ]);\n      const scheduleResponse = scheduleLoad.response;\n      ACTIVE_HFCC_SEASON = scheduleLoad.season;"
  );

  patched = patched
    .replaceAll("source: 'HFCC + EiBi A26'", "source: `HFCC + EiBi ${ACTIVE_HFCC_SEASON}`")
    .replace("if (sourceNote) sourceNote.textContent = 'Loading full A26 HFCC + EiBi shortwave schedules…';", "if (sourceNote) sourceNote.textContent = `Loading full ${ACTIVE_HFCC_SEASON} HFCC + EiBi shortwave schedules…`;")
    .replaceAll('A26 schedule ·', '${ACTIVE_HFCC_SEASON} schedule ·')
    .replace('`Full A26 shortwave schedule loaded:', '`Full ${ACTIVE_HFCC_SEASON} shortwave schedule loaded:');

  return patched;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/ham-activity') {
      return hamActivityResponse(url.searchParams.get('refresh') === '1');
    }
    if (url.pathname === '/api/program-guide/health') {
      const force = url.searchParams.get('refresh') === '1';
      return json({checkedAt:new Date().toISOString(),sources:await sourceHealth(force)});
    }
    if (url.pathname === '/api/program-guide') {
      try {
        const dynamic = await resolveDynamicGuide(request);
        if (dynamic) return dynamic;
      } catch (error) {
        const station = String(url.searchParams.get('station') || '');
        if (/(?:WRMI|RADIO MIAMI|WWCR|WEWN|EWTN|ETERNAL WORD|RADIO ROMANIA INTERNATIONAL)/i.test(station)) {
          return json({
            station, frequency:Number(url.searchParams.get('frequency')), at:url.searchParams.get('at') || new Date().toISOString(),
            status:'unavailable', verified:false,
            message:`Automatic program-guide refresh failed: ${error?.message || error}`
          }, 503);
        }
        console.warn('dynamic program guide failed', error);
      }
    }
    const response = await baseWorker.fetch(request, env, ctx);
    if (request.method === 'GET' && url.pathname === '/full-data.js') {
      const contentType = String(response.headers.get('content-type') || '');
      if (/javascript|text\/plain/.test(contentType)) {
        const source = await response.text();
        const headers = new Headers(response.headers);
        headers.set('content-type', 'application/javascript; charset=utf-8');
        headers.set('cache-control', 'no-store, max-age=0');
        headers.set('x-freqbeacon-schedule-season', 'auto');
        return new Response(patchFullDataAutoSeason(source), {
          status: response.status,
          statusText: response.statusText,
          headers
        });
      }
    }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return injectRefreshRuntime(response);
    }
    return response;
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(warmSources());
  }
};
