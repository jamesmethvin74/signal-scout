import baseWorker from './worker-program-v11.js';

const WRMI_SHEET_ID = '1pcIEX8kisrOPqlXHDAq6gympKUgDj0SIb96qce2kGGQ';
const WRMI_SHEET_URLS = [
  `https://docs.google.com/spreadsheets/d/${WRMI_SHEET_ID}/export?format=csv&gid=0`,
  `https://docs.google.com/spreadsheets/d/${WRMI_SHEET_ID}/gviz/tq?tqx=out:csv&gid=0`
];
const WRMI_SHEET_PAGE = `https://docs.google.com/spreadsheets/d/${WRMI_SHEET_ID}/edit?gid=0#gid=0`;
const MARTI_URL = 'https://www.martinoticias.com/Radio-Marti';
const LAST_GOOD_SECONDS = 7 * 24 * 60 * 60;
const RADIO_MARTI_FREQUENCIES = new Set([6030,7335,7365,7435,9410,9805,11860,11930,13570,13720]);
const RADIO_FARDA_FREQUENCIES = new Set([5860,7460]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'public, max-age=60'
    }
  });
}

function requestParts(request) {
  const url = new URL(request.url);
  const station = String(url.searchParams.get('station') || '').trim();
  const frequency = Number(url.searchParams.get('frequency'));
  const at = url.searchParams.get('at') ? new Date(url.searchParams.get('at')) : new Date();
  const language = String(url.searchParams.get('language') || '').trim();
  let tz = url.searchParams.get('tz') || 'UTC';
  try { new Intl.DateTimeFormat('en-US',{timeZone:tz}).format(at); }
  catch { tz = 'UTC'; }
  return { url, station, frequency, at, language, tz };
}

async function responseJson(response) {
  const type = String(response?.headers?.get('content-type') || '');
  if (!type.includes('application/json')) return null;
  try { return await response.clone().json(); } catch { return null; }
}

function validDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function cleanChronology(data, at) {
  if (!data || !['verified','broadcast'].includes(data.status)) return data;
  const nextStart = validDate(data.next?.start);
  const currentEnd = validDate(data.end);
  const floor = currentEnd && currentEnd > at ? currentEnd : at;
  if (nextStart && nextStart <= floor) data.next = null;
  return data;
}

function formatWindow(start, end, timeZone) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US',{timeZone,hour:'numeric',minute:'2-digit',hour12:true});
    const zone = new Intl.DateTimeFormat('en-US',{timeZone,timeZoneName:'short'})
      .formatToParts(start).find((part)=>part.type==='timeZoneName')?.value || '';
    return `${fmt.format(start)}–${fmt.format(end)}${zone ? ` ${zone}` : ''}`;
  } catch {
    return `${start.toISOString().slice(11,16)}–${end.toISOString().slice(11,16)} UTC`;
  }
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(text || '');
  for (let i=0; i<source.length; i += 1) {
    const ch = source[i];
    if (ch === '"') {
      if (quoted && source[i+1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(cell); cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && source[i+1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((value)=>String(value).trim())) rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((value)=>String(value).trim())) rows.push(row);
  return rows;
}

function frequencyValue(value) {
  const match = String(value || '').replace(/,/g,'').match(/\b(4\d{3}|5\d{3}|6\d{3}|7\d{3}|8\d{3}|9\d{3}|1\d{4})\b/);
  if (!match) return null;
  const number = Number(match[1]);
  return number >= 4000 && number <= 20000 ? number : null;
}

function utcClock(value) {
  const clean = String(value || '').trim();
  if (!/^\d{4}$/.test(clean)) return null;
  const hour = Number(clean.slice(0,2));
  const minute = Number(clean.slice(2));
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function cleanWrmiFragment(value) {
  return String(value || '')
    .replace(/\r?\n/g,' ')
    .replace(/\s+/g,' ')
    .replace(/^[-–—:;,.\s]+|[-–—:;,.\s]+$/g,'')
    .trim();
}

function usefulWrmiFragment(value) {
  const text = cleanWrmiFragment(value);
  if (!text || text.length < 2) return '';
  if (/^(?:na|ca|la|eu|af|sa|as|va|pa|mx|car|carib|n\.a\.?|s\.a\.?|e\.u\.?)$/i.test(text)) return '';
  if (/^(?:[A-Z]|[A-Z]\d|\d[A-Z])$/i.test(text)) return '';
  if (/^(?:kHz|UTC|ET|EDT|EST|schedule|program|programming)$/i.test(text)) return '';
  if (/^\d{4,5}(?:\s*kHz)?$/i.test(text)) return '';
  return text;
}

function parseWrmiGrid(csv) {
  const rows = parseCsv(csv);
  if (!rows.length) return null;
  let headerIndex = -1;
  let columns = [];
  for (let r=0; r<Math.min(rows.length,12); r += 1) {
    const found = [];
    rows[r].forEach((cell,index)=>{
      const frequency = frequencyValue(cell);
      if (frequency) found.push({ index, frequency });
    });
    if (found.length > columns.length) { headerIndex = r; columns = found; }
  }
  if (headerIndex < 0 || columns.length < 5) return null;
  const firstFrequencyColumn = Math.min(...columns.map((item)=>item.index));
  const blocks = [];
  for (let r=headerIndex+1; r<rows.length; r += 1) {
    let start = null;
    for (let c=0; c<Math.min(firstFrequencyColumn+1,rows[r].length); c += 1) {
      const parsed = utcClock(rows[r][c]);
      if (parsed != null) { start = parsed; break; }
    }
    if (start != null) blocks.push({ row:r, start });
  }
  if (blocks.length < 8) return null;

  const slots = new Map();
  for (let b=0; b<blocks.length; b += 1) {
    const block = blocks[b];
    const endRow = blocks[b+1]?.row ?? rows.length;
    const end = blocks[b+1]?.start ?? ((block.start + 60) % 1440);
    for (const { index, frequency } of columns) {
      const fragments = [];
      for (let r=block.row; r<endRow; r += 1) {
        const fragment = usefulWrmiFragment(rows[r]?.[index]);
        if (fragment && !fragments.some((item)=>item.toLowerCase()===fragment.toLowerCase())) fragments.push(fragment);
      }
      if (!fragments.length) continue;
      slots.set(`${frequency}|${block.start}`, {
        frequency, start:block.start, end,
        title:fragments.join(' / ')
      });
    }
  }
  return { slots, frequencies:new Set(columns.map((item)=>item.frequency)) };
}

async function cachedRemoteText({ id, urls, ttl=3600 }) {
  const freshKey = new Request(`https://freqbeacon-cache.invalid/source-v12/${id}/fresh`);
  const staleKey = new Request(`https://freqbeacon-cache.invalid/source-v12/${id}/last-good`);
  const cache = caches.default;
  const fresh = await cache.match(freshKey);
  if (fresh) return { text:await fresh.text(), stale:false, fetchedAt:fresh.headers.get('x-fetched-at') };

  let error = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers:{ Accept:'text/csv,text/plain,text/html;q=0.9,*/*;q=0.5', 'User-Agent':'FREQBEACON/1.0 schedule refresh' },
        cf:{ cacheTtl:Math.min(ttl,1800), cacheEverything:true }
      });
      if (!response.ok) { error = new Error(`${id} HTTP ${response.status}`); continue; }
      const text = await response.text();
      if (text.length < 300) { error = new Error(`${id} source too short`); continue; }
      const fetchedAt = new Date().toISOString();
      await Promise.all([
        cache.put(freshKey,new Response(text,{headers:{'cache-control':`public, max-age=${ttl}`,'x-fetched-at':fetchedAt}})),
        cache.put(staleKey,new Response(text,{headers:{'cache-control':`public, max-age=${LAST_GOOD_SECONDS}`,'x-fetched-at':fetchedAt}}))
      ]);
      return { text, stale:false, fetchedAt };
    } catch (caught) { error = caught; }
  }
  const stale = await cache.match(staleKey);
  if (stale) return { text:await stale.text(), stale:true, fetchedAt:stale.headers.get('x-fetched-at'), error:String(error?.message || error || '') };
  throw error || new Error(`${id} source unavailable`);
}

function utcOccurrence(at, startMinute, endMinute) {
  const dayStart = Date.UTC(at.getUTCFullYear(),at.getUTCMonth(),at.getUTCDate());
  let start = new Date(dayStart + startMinute*60000);
  let endMinuteAdjusted = endMinute;
  if (endMinuteAdjusted <= startMinute) endMinuteAdjusted += 1440;
  let end = new Date(dayStart + endMinuteAdjusted*60000);
  if (at < start) {
    start = new Date(start.getTime()-86400000);
    end = new Date(end.getTime()-86400000);
  }
  if (!(start <= at && at < end)) {
    start = new Date(dayStart + startMinute*60000);
    end = new Date(dayStart + endMinuteAdjusted*60000);
  }
  return { start, end };
}

async function resolveWrmiGrid(parts) {
  if (!/WRMI|RADIO MIAMI INTERNATIONAL/i.test(parts.station)) return null;
  if (!Number.isFinite(parts.frequency) || Number.isNaN(parts.at.getTime())) return null;
  let snapshot;
  try { snapshot = await cachedRemoteText({id:'wrmi-grid',urls:WRMI_SHEET_URLS,ttl:3600}); }
  catch { return null; }
  const grid = parseWrmiGrid(snapshot.text);
  if (!grid) return null;
  const frequency = [...grid.frequencies].find((value)=>Math.abs(value-parts.frequency)<0.6);
  if (!frequency) return null;
  const minute = parts.at.getUTCHours()*60 + parts.at.getUTCMinutes();
  const starts = [...new Set([...grid.slots.values()].filter((slot)=>slot.frequency===frequency).map((slot)=>slot.start))].sort((a,b)=>a-b);
  let activeStart = starts.filter((start)=>start<=minute).pop();
  if (activeStart == null) activeStart = starts[starts.length-1];
  const slot = grid.slots.get(`${frequency}|${activeStart}`);
  if (!slot?.title) return null;
  const occurrence = utcOccurrence(parts.at,slot.start,slot.end);

  let next = null;
  for (let step=1; step<=24; step += 1) {
    const nextMinute = (slot.start + step*60) % 1440;
    const candidate = grid.slots.get(`${frequency}|${nextMinute}`);
    if (!candidate?.title || candidate.title===slot.title) continue;
    let nextStart = new Date(Date.UTC(parts.at.getUTCFullYear(),parts.at.getUTCMonth(),parts.at.getUTCDate()) + nextMinute*60000);
    while (nextStart <= occurrence.end) nextStart = new Date(nextStart.getTime()+86400000);
    let candidateEndMinute = candidate.end;
    if (candidateEndMinute <= candidate.start) candidateEndMinute += 1440;
    const duration = (candidateEndMinute-candidate.start)*60000;
    next = { program:candidate.title, window:formatWindow(nextStart,new Date(nextStart.getTime()+duration),parts.tz), start:nextStart.toISOString() };
    break;
  }

  return {
    station:'WRMI', frequency:parts.frequency, at:parts.at.toISOString(),
    status:'broadcast', verified:true,
    program:slot.title,
    window:formatWindow(occurrence.start,occurrence.end,parts.tz),
    start:occurrence.start.toISOString(), end:occurrence.end.toISOString(), next,
    sourceUrl:WRMI_SHEET_PAGE,
    sourceLabel:`WRMI official A26 schedule grid${snapshot.stale ? ' · last known good' : ''}`,
    source:{ id:'wrmi-grid', fetchedAt:snapshot.fetchedAt || null, refresh:'automatic', stale:Boolean(snapshot.stale) }
  };
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<br\s*\/?>|<\/p\s*>|<\/div\s*>|<\/h[1-6]\s*>/gi,'\n')
    .replace(/<[^>]+>/g,' ')
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&aacute;|&#225;/gi,'á').replace(/&eacute;|&#233;/gi,'é')
    .replace(/&iacute;|&#237;/gi,'í').replace(/&oacute;|&#243;/gi,'ó')
    .replace(/&uacute;|&#250;/gi,'ú').replace(/&ntilde;|&#241;/gi,'ñ')
    .replace(/[ \t]+/g,' ').replace(/\n{2,}/g,'\n').trim();
}

function martiLiveTitle(html) {
  const text = decodeHtml(html);
  const match = text.match(/(?:^|\n)\s*En vivo\s+([^\n]{2,90})/i);
  if (!match) return '';
  return match[1].replace(/\s+/g,' ').trim().replace(/\s+(?:Embed|The code has been copied).*$/i,'').trim();
}

function isUsagm(station) {
  return /UNITED STATES AGENCY FOR GLOBAL MEDIA|\bUSAGM\b/i.test(station);
}

async function resolveUsagmService(parts) {
  if (!isUsagm(parts.station) || !Number.isFinite(parts.frequency)) return null;
  const frequency = Math.round(parts.frequency);
  if (RADIO_MARTI_FREQUENCIES.has(frequency) && /spanish|español/i.test(parts.language)) {
    const closeToNow = Math.abs(parts.at.getTime()-Date.now()) <= 20*60000;
    if (closeToNow) {
      try {
        const snapshot = await cachedRemoteText({id:'radio-marti-live',urls:[MARTI_URL],ttl:180});
        const title = martiLiveTitle(snapshot.text);
        if (title) {
          return {
            station:'Radio Martí', frequency:parts.frequency, at:parts.at.toISOString(), status:'verified', verified:true,
            program:title, window:'Live Radio Martí feed', start:null, end:null, next:null,
            sourceUrl:MARTI_URL, sourceLabel:`Radio Martí official live page${snapshot.stale ? ' · last known good' : ''}`,
            source:{id:'radio-marti-live',fetchedAt:snapshot.fetchedAt || null,refresh:'automatic',stale:Boolean(snapshot.stale)}
          };
        }
      } catch {}
    }
    return {
      station:'Radio Martí', frequency:parts.frequency, at:parts.at.toISOString(), status:'broadcast', verified:true,
      program:'Radio Martí — Spanish service', window:'', next:null,
      sourceUrl:MARTI_URL, sourceLabel:'Radio Martí official service',
      message:'USAGM frequency identity resolved to Radio Martí.'
    };
  }
  if (RADIO_FARDA_FREQUENCIES.has(frequency) && /persian|farsi/i.test(parts.language)) {
    return {
      station:'Radio Farda', frequency:parts.frequency, at:parts.at.toISOString(), status:'broadcast', verified:true,
      program:'Radio Farda — Persian service', window:'', next:null,
      sourceLabel:'USAGM transmission identity',
      message:'USAGM frequency identity resolved to Radio Farda.'
    };
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/program-guide') return baseWorker.fetch(request,env,ctx);

    const parts = requestParts(request);
    let baseResponse;
    let baseData = null;
    try {
      baseResponse = await baseWorker.fetch(request,env,ctx);
      baseData = await responseJson(baseResponse);
    } catch {}

    if (baseData && ['verified','broadcast','ambiguous'].includes(baseData.status)) {
      return json(cleanChronology(baseData,parts.at),baseResponse?.status || 200);
    }

    const wrmi = await resolveWrmiGrid(parts);
    if (wrmi) return json(cleanChronology(wrmi,parts.at));

    const usagm = await resolveUsagmService(parts);
    if (usagm) return json(cleanChronology(usagm,parts.at));

    if (baseResponse) return baseResponse;
    return json(baseData || {station:parts.station,frequency:parts.frequency,at:parts.at.toISOString(),status:'unsupported',verified:false},503);
  },

  async scheduled(event, env, ctx) {
    if (typeof baseWorker.scheduled === 'function') return baseWorker.scheduled(event,env,ctx);
  }
};
