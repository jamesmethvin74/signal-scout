const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const PROGRAM_REFRESH_CRON = '17 */6 * * *';
const RECEIVER_HEALTH_CRON = '* * * * *';

const WBCQ_BASE = 'https://wbcq.com/schedule/index.php?fn=sked&freq=';
const WRMI_SHEET = 'https://docs.google.com/spreadsheets/d/1pcIEX8kisrOPqlXHDAq6gympKUgDj0SIb96qce2kGGQ/edit';
const WRMI_CSV = 'https://docs.google.com/spreadsheets/d/1pcIEX8kisrOPqlXHDAq6gympKUgDj0SIb96qce2kGGQ/export?format=csv&gid=0';
const REE_SOURCE = 'https://www.rtve.es/play/radio/radio-exterior/';
const KARN_SOURCE = 'https://player.sportsanimal920.com/station-information/';

const DAY_INDEX = Object.freeze({ Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Su:0, Mo:1, Tu:2, We:3, Th:4, Fr:5, Sa:6 });

const STATION_ALIASES = new Map([
  ['WBCQ','WBCQ'],
  ['WRMI','WRMI'],
  ['RADIO MIAMI INTERNATIONAL','WRMI'],
  ['RADIO EXTERIOR DE ESPANA','REE'],
  ['REE','REE'],
  ['KARN','KARN'],
  ['KARN AM','KARN'],
  ['SPORTS ANIMAL 920','KARN'],
  ['SPORTSANIMAL 920','KARN']
]);

const SOURCE_DEFINITIONS = Object.freeze([
  {
    id:'wbcq-official',
    displayName:'WBCQ official frequency schedule',
    authority:'official-broadcaster',
    url:WBCQ_BASE,
    priority:100,
    refreshMs:6 * HOUR_MS,
    freshnessMs:36 * HOUR_MS,
    minRecords:5,
    maxRecords:4000,
    stationKeys:['WBCQ'],
    refresh:refreshWbcq
  },
  {
    id:'wrmi-official',
    displayName:'WRMI official A26 schedule',
    authority:'official-broadcaster',
    url:WRMI_SHEET,
    priority:100,
    refreshMs:6 * HOUR_MS,
    freshnessMs:48 * HOUR_MS,
    minRecords:8,
    maxRecords:4000,
    stationKeys:['WRMI'],
    refresh:refreshWrmi
  },
  {
    id:'ree-official-live',
    displayName:'RTVE Radio Exterior de España live schedule',
    authority:'official-broadcaster',
    url:REE_SOURCE,
    priority:100,
    refreshMs:2 * HOUR_MS,
    freshnessMs:12 * HOUR_MS,
    minRecords:2,
    maxRecords:100,
    stationKeys:['REE'],
    refresh:refreshRee
  },
  {
    id:'karn-official-live',
    displayName:'Sports Animal 920 / KARN official live schedule',
    authority:'official-broadcaster',
    url:KARN_SOURCE,
    priority:100,
    refreshMs:HOUR_MS,
    freshnessMs:2 * HOUR_MS,
    minRecords:1,
    maxRecords:10,
    stationKeys:['KARN'],
    refresh:refreshKarn
  }
]);

const SOURCES_BY_STATION = new Map();
for (const source of SOURCE_DEFINITIONS) {
  for (const stationKey of source.stationKeys) {
    const list = SOURCES_BY_STATION.get(stationKey) || [];
    list.push(source.id);
    SOURCES_BY_STATION.set(stationKey, list);
  }
}

function json(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store, max-age=0',
      ...extraHeaders
    }
  });
}

export function normalizeStationKey(value) {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return STATION_ALIASES.get(normalized) || normalized;
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
    .replace(/&ntilde;/gi, 'ñ')
    .replace(/&Ntilde;/g, 'Ñ')
    .replace(/&aacute;/gi, 'á')
    .replace(/&eacute;/gi, 'é')
    .replace(/&iacute;/gi, 'í')
    .replace(/&oacute;/gi, 'ó')
    .replace(/&uacute;/gi, 'ú')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseHHMM(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!/^\d{4}$/.test(digits)) return null;
  const hour = Number(digits.slice(0,2));
  const minute = Number(digits.slice(2));
  if (hour === 24 && minute === 0) return 1440;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function parseClock24(hour, minute) {
  const h = Number(hour);
  const m = Number(minute);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59 ? h * 60 + m : null;
}

function parseClock12(value) {
  const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})\s*([AP])M$/i);
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === 'P') hour += 12;
  return hour * 60 + Number(match[2]);
}

function isoDate(date) {
  return date.toISOString().slice(0,10);
}

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year:'numeric',
    month:'2-digit',
    day:'2-digit',
    hour:'2-digit',
    minute:'2-digit',
    hourCycle:'h23'
  }).formatToParts(date);
  const out = {};
  for (const part of parts) out[part.type] = part.value;
  return {
    year:Number(out.year),
    month:Number(out.month),
    day:Number(out.day),
    hour:Number(out.hour),
    minute:Number(out.minute)
  };
}

function addCalendarDays(parts, count) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + count));
  return { year:date.getUTCFullYear(), month:date.getUTCMonth() + 1, day:date.getUTCDate() };
}

function zonedTimeToUtc(parts, minuteOfDay, timeZone) {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  let guess = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute);
  const wanted = Date.UTC(parts.year, parts.month - 1, parts.day, hour, minute);
  for (let i = 0; i < 3; i += 1) {
    const seen = localParts(new Date(guess), timeZone);
    const observed = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    guess += wanted - observed;
  }
  return new Date(guess);
}

function localInterval(parts, startMinute, endMinute, timeZone) {
  const start = zonedTimeToUtc(parts, startMinute, timeZone);
  const endParts = endMinute <= startMinute ? addCalendarDays(parts, 1) : parts;
  const end = zonedTimeToUtc(endParts, endMinute % 1440, timeZone);
  return { start, end };
}

function nearestLocalInterval(reference, startMinute, endMinute, timeZone) {
  const base = localParts(reference, timeZone);
  const now = reference.getTime();
  let best = null;
  for (const delta of [-1,0,1]) {
    const candidate = localInterval(addCalendarDays(base, delta), startMinute, endMinute, timeZone);
    const contains = candidate.start.getTime() <= now && now < candidate.end.getTime();
    const distance = contains ? 0 : Math.min(Math.abs(candidate.start.getTime() - now), Math.abs(candidate.end.getTime() - now));
    if (!best || distance < best.distance) best = { ...candidate, distance };
  }
  return best;
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeTitle(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function recordKey(record) {
  return hashString([
    record.stationKey,
    record.frequencyKHz ?? '*',
    record.days || '',
    record.startMinuteUtc ?? '',
    record.endMinuteUtc ?? '',
    record.startAt || '',
    record.endAt || '',
    normalizeTitle(record.title).toUpperCase(),
    record.language || '',
    record.targetRegion || ''
  ].join('|'));
}

function withRecordKey(record) {
  return { ...record, recordKey:record.recordKey || recordKey(record) };
}

function dedupeRecords(records) {
  const unique = new Map();
  for (const raw of records || []) {
    const record = withRecordKey(raw);
    if (!unique.has(record.recordKey)) unique.set(record.recordKey, record);
  }
  return [...unique.values()];
}

export function parseWbcqRows(html) {
  const rows = [];
  for (const rowMatch of String(html || '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => htmlDecode(match[1]));
    if (cells.length < 5) continue;
    const frequency = Number(String(cells[0]).replace(/[^0-9.]/g, ''));
    const day = DAY_INDEX[cells[1]];
    const startMinuteUtc = parseHHMM(cells[2]);
    const endMinuteUtc = parseHHMM(cells[3]);
    const title = normalizeTitle(cells[cells.length - 1]);
    if (!Number.isFinite(frequency) || day == null || startMinuteUtc == null || endMinuteUtc == null || !title || /program title/i.test(title)) continue;
    rows.push(withRecordKey({
      stationKey:'WBCQ',
      stationName:'WBCQ',
      frequencyKHz:frequency,
      days:String(day),
      startMinuteUtc,
      endMinuteUtc,
      startAt:null,
      endAt:null,
      effectiveFrom:null,
      effectiveTo:null,
      title,
      description:'',
      language:'',
      targetRegion:'',
      sourceRecordId:'',
      confidence:'official',
      originalTimeZone:'UTC',
      originalTime:cells[2] + '-' + cells[3] + ' UTC'
    }));
  }
  return dedupeRecords(rows);
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(text || '');
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"') {
      if (quoted && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function daysFromWrmiTitle(title) {
  let clean = normalizeTitle(title);
  if (!clean) return null;

  if (/\bweekdays\b/i.test(clean)) {
    clean = clean.replace(/\bweekdays\b[\s\S]*$/i, '').trim();
    return clean ? { days:'12345', title:clean } : null;
  }
  if (/\bMon\s*-\s*Fri\b/i.test(clean)) {
    clean = clean.replace(/\bMon\s*-\s*Fri\b[\s\S]*$/i, '').trim();
    return clean ? { days:'12345', title:clean } : null;
  }
  if (/\b(?:Sa\/Su|Sat\s*-\s*Sun)\b/i.test(clean)) {
    clean = clean.replace(/\b(?:Sa\/Su|Sat\s*-\s*Sun)\b[\s\S]*$/i, '').trim();
    return clean ? { days:'06', title:clean } : null;
  }

  if (/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(clean)) return null;
  if (/\b(?:others|except|UTC)\b/i.test(clean)) return null;
  return { days:'0123456', title:clean };
}

function parseEffectiveFrom(text) {
  const match = String(text || '').match(/effective\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/i);
  if (!match) return null;
  const month = ['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(match[1].toLowerCase());
  if (month < 0) return null;
  return new Date(Date.UTC(Number(match[3]), month, Number(match[2]))).toISOString().slice(0,10);
}

export function parseWrmiScheduleCsv(csv) {
  const rows = parseCsv(csv);
  const headerIndex = rows.findIndex((row) => String(row[0] || '').trim().toUpperCase() === 'UTC' && row.some((cell) => /kHz/i.test(cell)));
  if (headerIndex < 0) return { records:[], season:null, effectiveFrom:null };

  const banner = rows.slice(0, headerIndex).flat().join(' ');
  const season = banner.match(/\b([AB]\d{2})\b/i)?.[1]?.toUpperCase() || null;
  const effectiveFrom = parseEffectiveFrom(banner);
  const frequencies = new Map();
  rows[headerIndex].forEach((cell, index) => {
    const match = String(cell || '').match(/(\d{3,5})\s*kHz/i);
    if (match) frequencies.set(index, Number(match[1]));
  });

  const records = [];
  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const startText = String(rows[rowIndex]?.[0] || '').trim();
    if (!/^\d{4}$/.test(startText)) continue;
    const startMinuteUtc = parseHHMM(startText);
    if (startMinuteUtc == null) continue;

    let nextIndex = rowIndex + 1;
    while (nextIndex < rows.length && !/^\d{4}$/.test(String(rows[nextIndex]?.[0] || '').trim())) nextIndex += 1;
    const nextText = String(rows[nextIndex]?.[0] || '').trim();
    let endMinuteUtc = /^\d{4}$/.test(nextText) ? parseHHMM(nextText) : null;
    if (endMinuteUtc == null) endMinuteUtc = (startMinuteUtc + 60) % 1440;
    if (endMinuteUtc === 0 && startMinuteUtc > 0) endMinuteUtc = 1440;

    for (const [column, frequencyKHz] of frequencies) {
      const parts = [];
      for (let detailIndex = rowIndex + 1; detailIndex < nextIndex; detailIndex += 1) {
        const value = normalizeTitle(rows[detailIndex]?.[column]);
        if (value) parts.push(value);
      }
      let title = normalizeTitle(parts.join(' '));
      if (!title || /^[-A-Z]$/i.test(title) || /kHz/i.test(title)) continue;

      const qualified = daysFromWrmiTitle(title);
      if (!qualified || !qualified.title) continue;
      title = qualified.title;
      if (title.length < 3 || title.length > 180) continue;

      records.push(withRecordKey({
        stationKey:'WRMI',
        stationName:'WRMI',
        frequencyKHz,
        days:qualified.days,
        startMinuteUtc,
        endMinuteUtc,
        startAt:null,
        endAt:null,
        effectiveFrom,
        effectiveTo:null,
        title,
        description:'',
        language:'',
        targetRegion:'',
        sourceRecordId:'grid-' + startText + '-' + frequencyKHz,
        confidence:'official',
        originalTimeZone:'UTC',
        originalTime:startText + '-' + String(endMinuteUtc === 1440 ? '2400' : String(Math.floor(endMinuteUtc / 60)).padStart(2,'0') + String(endMinuteUtc % 60).padStart(2,'0')) + ' UTC'
      }));
    }
    rowIndex = Math.max(rowIndex, nextIndex - 1);
  }

  return { records:dedupeRecords(records), season, effectiveFrom };
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
}

function orderedLocalRecords(items, fetchedAt, timeZone, base) {
  if (!items.length) return [];
  const reference = fetchedAt instanceof Date ? fetchedAt : new Date(fetchedAt);
  const first = nearestLocalInterval(reference, items[0].startMinute, items[0].endMinute, timeZone);
  let dateParts = localParts(first.start, timeZone);
  let previousStart = items[0].startMinute;
  const records = [];

  for (const item of items) {
    if (item.startMinute < previousStart) dateParts = addCalendarDays(dateParts, 1);
    const interval = localInterval(dateParts, item.startMinute, item.endMinute, timeZone);
    records.push(withRecordKey({
      ...base,
      days:'',
      startMinuteUtc:null,
      endMinuteUtc:null,
      startAt:interval.start.toISOString(),
      endAt:interval.end.toISOString(),
      effectiveFrom:isoDate(interval.start),
      effectiveTo:isoDate(interval.end),
      title:item.title,
      description:item.description || '',
      language:item.language || '',
      targetRegion:item.targetRegion || '',
      sourceRecordId:item.sourceRecordId || '',
      confidence:'official',
      originalTimeZone:timeZone,
      originalTime:item.originalTime || ''
    }));
    previousStart = item.startMinute;
  }
  return dedupeRecords(records);
}

export function parseReeSchedule(html, fetchedAt = new Date()) {
  const raw = String(html || '');
  const text = htmlDecode(raw);
  const titles = [];
  for (const match of raw.matchAll(/alt=["']([^"']+?)\s+con\s+[^"']+["']/gi)) {
    const title = htmlDecode(match[1]);
    if (title && title.length <= 120 && !titles.includes(title)) titles.push(title);
  }

  const items = [];
  for (const title of titles) {
    const regex = new RegExp(escapeRegex(title) + '.{0,140}?De\\s+(\\d{1,2}):(\\d{2})\\s+a\\s+(\\d{1,2}):(\\d{2})\\s+horas', 'i');
    const match = text.match(regex);
    if (!match) continue;
    const startMinute = parseClock24(match[1], match[2]);
    const endMinute = parseClock24(match[3], match[4]);
    if (startMinute == null || endMinute == null) continue;
    items.push({
      title,
      startMinute,
      endMinute,
      index:text.indexOf(match[0]),
      originalTime:match[1].padStart(2,'0') + ':' + match[2] + '-' + match[3].padStart(2,'0') + ':' + match[4] + ' Europe/Madrid'
    });
  }
  items.sort((a,b) => a.index - b.index);

  return orderedLocalRecords(items, fetchedAt, 'Europe/Madrid', {
    stationKey:'REE',
    stationName:'Radio Exterior de España',
    frequencyKHz:null
  });
}

export function parseKarnNow(html, fetchedAt = new Date()) {
  const text = htmlDecode(html);
  const match = text.match(/On Air Now\s+(.{2,140}?)\s+(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
  if (!match) return [];
  const title = normalizeTitle(match[1]);
  const startMinute = parseClock12(match[2]);
  const endMinute = parseClock12(match[3]);
  if (!title || startMinute == null || endMinute == null) return [];
  const interval = nearestLocalInterval(fetchedAt, startMinute, endMinute, 'America/Chicago');
  return [withRecordKey({
    stationKey:'KARN',
    stationName:'KARN / Sports Animal 920',
    frequencyKHz:920,
    days:'',
    startMinuteUtc:null,
    endMinuteUtc:null,
    startAt:interval.start.toISOString(),
    endAt:interval.end.toISOString(),
    effectiveFrom:isoDate(interval.start),
    effectiveTo:isoDate(interval.end),
    title,
    description:'Current program published by the station.',
    language:'English',
    targetRegion:'Central Arkansas',
    sourceRecordId:'on-air-now',
    confidence:'official',
    originalTimeZone:'America/Chicago',
    originalTime:match[2] + '-' + match[3] + ' America/Chicago'
  })];
}

async function fetchText(url, accept) {
  const response = await fetch(url, {
    headers:{
      Accept:accept || 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      'User-Agent':'FreqBeacon/1.0 (+https://freqbeacon.methvindigitalworks.com/)'
    },
    cf:{ cacheEverything:true, cacheTtl:900 }
  });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' from ' + url);
  return response.text();
}

async function refreshWbcq(fetchedAt) {
  const frequencies = [3265,5130,6160,7490,9330];
  const records = [];
  for (const frequency of frequencies) {
    const html = await fetchText(WBCQ_BASE + encodeURIComponent(frequency));
    records.push(...parseWbcqRows(html));
  }
  return { records:dedupeRecords(records), season:null, effectiveFrom:null, effectiveTo:null, fetchedAt };
}

async function refreshWrmi(fetchedAt) {
  const csv = await fetchText(WRMI_CSV, 'text/csv,text/plain;q=0.9,*/*;q=0.8');
  const parsed = parseWrmiScheduleCsv(csv);
  return { ...parsed, effectiveTo:null, fetchedAt };
}

async function refreshRee(fetchedAt) {
  const html = await fetchText(REE_SOURCE);
  return { records:parseReeSchedule(html, fetchedAt), season:null, effectiveFrom:null, effectiveTo:null, fetchedAt };
}

async function refreshKarn(fetchedAt) {
  const html = await fetchText(KARN_SOURCE);
  return { records:parseKarnNow(html, fetchedAt), season:null, effectiveFrom:null, effectiveTo:null, fetchedAt };
}

export function validateCandidateRecords(records, definition, previousCount = 0) {
  const errors = [];
  const minRecords = Number(definition?.minRecords ?? 1);
  const maxRecords = Number(definition?.maxRecords ?? 100000);
  if (!Array.isArray(records)) return { ok:false, errors:['adapter did not return a record array'], count:0 };
  if (records.length < minRecords) errors.push('record count ' + records.length + ' is below minimum ' + minRecords);
  if (records.length > maxRecords) errors.push('record count ' + records.length + ' exceeds maximum ' + maxRecords);

  const seen = new Set();
  for (const record of records) {
    if (!record?.stationKey) errors.push('record missing station identity');
    const frequency = Number(record?.frequencyKHz);
    if (record?.frequencyKHz != null && (!Number.isFinite(frequency) || frequency < 100 || frequency > 30000)) errors.push('invalid frequency');
    if (!String(record?.title || '').trim()) errors.push('record missing program title');
    if (String(record?.title || '').length > 240) errors.push('program title too long');

    const dated = record?.startAt && record?.endAt;
    if (dated) {
      const start = new Date(record.startAt).getTime();
      const end = new Date(record.endAt).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > DAY_MS) errors.push('invalid dated schedule window');
    } else {
      const start = Number(record?.startMinuteUtc);
      const end = Number(record?.endMinuteUtc);
      if (!/^[0-6]+$/.test(String(record?.days || ''))) errors.push('invalid recurring day set');
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > 1439 || end < 0 || end > 1440 || start === end) errors.push('invalid UTC schedule window');
    }

    const key = record?.recordKey || recordKey(record);
    if (seen.has(key)) errors.push('duplicate record key ' + key);
    seen.add(key);
    if (errors.length >= 20) break;
  }

  if (previousCount >= minRecords && records.length > 0) {
    if (records.length < Math.max(minRecords, Math.floor(previousCount * 0.25))) errors.push('unexpected record-count collapse from ' + previousCount + ' to ' + records.length);
    if (records.length > Math.max(maxRecords, previousCount * 4)) errors.push('unexpected record-count explosion from ' + previousCount + ' to ' + records.length);
  }

  return { ok:errors.length === 0, errors, count:records.length };
}

function previousDay(day) {
  return (day + 6) % 7;
}

function recurringOccurrence(record, at) {
  const start = Number(record.startMinuteUtc);
  const end = Number(record.endMinuteUtc);
  const days = String(record.days || '');
  const day = at.getUTCDay();
  const minute = at.getUTCHours() * 60 + at.getUTCMinutes();

  if (end > start) {
    if (!days.includes(String(day)) || minute < start || minute >= end) return null;
    const startDate = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), Math.floor(start / 60), start % 60));
    const endDate = end === 1440
      ? new Date(startDate.getTime() + (1440 - start) * 60000)
      : new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), Math.floor(end / 60), end % 60));
    return { startDate, endDate };
  }

  if (days.includes(String(day)) && minute >= start) {
    const startDate = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), Math.floor(start / 60), start % 60));
    const endDate = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1, Math.floor(end / 60), end % 60));
    return { startDate, endDate };
  }

  if (days.includes(String(previousDay(day))) && minute < end) {
    const startDate = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() - 1, Math.floor(start / 60), start % 60));
    const endDate = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), Math.floor(end / 60), end % 60));
    return { startDate, endDate };
  }
  return null;
}

function recordOccurrence(record, at) {
  if (record.startAt && record.endAt) {
    const startDate = new Date(record.startAt);
    const endDate = new Date(record.endAt);
    if (startDate.getTime() <= at.getTime() && at.getTime() < endDate.getTime()) return { startDate, endDate };
    return null;
  }

  const requestedDate = isoDate(at);
  if (record.effectiveFrom && requestedDate < record.effectiveFrom) return null;
  if (record.effectiveTo && requestedDate > record.effectiveTo) return null;
  return recurringOccurrence(record, at);
}

export function selectProgramFromRecords(records, atInput, nominalFrequencyKHz, nowInput = new Date()) {
  const at = atInput instanceof Date ? atInput : new Date(atInput);
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const frequency = Number(nominalFrequencyKHz);
  const candidates = [];

  for (const record of records || []) {
    const expiresAt = Number(record.activeExpiresAt ?? record.active_expires_at ?? Infinity);
    if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) continue;
    if (record.frequencyKHz != null || record.frequency_khz != null) {
      const recordFrequency = Number(record.frequencyKHz ?? record.frequency_khz);
      if (!Number.isFinite(frequency) || !Number.isFinite(recordFrequency) || Math.abs(recordFrequency - frequency) > 0.6) continue;
    }
    const normalized = {
      ...record,
      startMinuteUtc:record.startMinuteUtc ?? record.start_minute_utc,
      endMinuteUtc:record.endMinuteUtc ?? record.end_minute_utc,
      startAt:record.startAt ?? record.start_at,
      endAt:record.endAt ?? record.end_at,
      effectiveFrom:record.effectiveFrom ?? record.effective_from,
      effectiveTo:record.effectiveTo ?? record.effective_to,
      days:record.days || ''
    };
    const occurrence = recordOccurrence(normalized, at);
    if (!occurrence) continue;
    candidates.push({
      record:normalized,
      occurrence,
      priority:Number(record.sourcePriority ?? record.source_priority ?? 0),
      frequencySpecific:(record.frequencyKHz ?? record.frequency_khz) != null ? 1 : 0
    });
  }

  candidates.sort((a,b) =>
    b.priority - a.priority
    || b.frequencySpecific - a.frequencySpecific
    || String(b.record.lastVerifiedAt ?? b.record.last_verified_at ?? '').localeCompare(String(a.record.lastVerifiedAt ?? a.record.last_verified_at ?? ''))
    || String(a.record.title).localeCompare(String(b.record.title))
  );

  if (!candidates.length) return { status:'none', candidates:[] };
  const best = candidates[0];
  const peers = candidates.filter((candidate) =>
    candidate.priority === best.priority
    && candidate.frequencySpecific === best.frequencySpecific
  );
  const titles = [...new Set(peers.map((candidate) => normalizeTitle(candidate.record.title)))];
  if (titles.length > 1) return { status:'ambiguous', candidates:peers, titles };
  return { status:'verified', best, candidates:peers };
}

async function ensureSchema(env) {
  const db = env?.RECEIVER_HEALTH_DB;
  if (!db) throw new Error('Program catalog database binding is unavailable');
  const statements = [
    [
      'CREATE TABLE IF NOT EXISTS freqbeacon_program_sources (',
      'source_id TEXT PRIMARY KEY,',
      'display_name TEXT NOT NULL,',
      'authority TEXT NOT NULL,',
      'source_url TEXT NOT NULL,',
      'source_priority INTEGER NOT NULL,',
      'refresh_interval_ms INTEGER NOT NULL,',
      'freshness_ttl_ms INTEGER NOT NULL,',
      'last_attempt_at INTEGER,',
      'last_success_at INTEGER,',
      'last_verified_at INTEGER,',
      'next_refresh_at INTEGER,',
      'status TEXT NOT NULL DEFAULT "never-published",',
      'record_count INTEGER NOT NULL DEFAULT 0,',
      'active_version TEXT,',
      'active_fetched_at INTEGER,',
      'active_expires_at INTEGER,',
      'effective_from TEXT,',
      'effective_to TEXT,',
      'season TEXT,',
      'last_error TEXT,',
      'last_validation TEXT,',
      'consecutive_failures INTEGER NOT NULL DEFAULT 0',
      ')'
    ].join(' '),
    [
      'CREATE TABLE IF NOT EXISTS freqbeacon_program_entries (',
      'source_id TEXT NOT NULL,',
      'version TEXT NOT NULL,',
      'record_key TEXT NOT NULL,',
      'station_key TEXT NOT NULL,',
      'station_name TEXT NOT NULL,',
      'frequency_khz REAL,',
      'days TEXT,',
      'start_minute_utc INTEGER,',
      'end_minute_utc INTEGER,',
      'start_at TEXT,',
      'end_at TEXT,',
      'effective_from TEXT,',
      'effective_to TEXT,',
      'title TEXT NOT NULL,',
      'description TEXT,',
      'language TEXT,',
      'target_region TEXT,',
      'source_record_id TEXT,',
      'confidence TEXT,',
      'original_time_zone TEXT,',
      'original_time TEXT,',
      'fetched_at INTEGER NOT NULL,',
      'last_verified_at INTEGER NOT NULL,',
      'PRIMARY KEY (source_id, version, record_key)',
      ')'
    ].join(' '),
    'CREATE INDEX IF NOT EXISTS idx_freqbeacon_program_station ON freqbeacon_program_entries(station_key, frequency_khz)',
    'CREATE INDEX IF NOT EXISTS idx_freqbeacon_program_version ON freqbeacon_program_entries(source_id, version)'
  ];
  for (const statement of statements) await db.prepare(statement).run();

  for (const source of SOURCE_DEFINITIONS) {
    await db.prepare([
      'INSERT INTO freqbeacon_program_sources',
      '(source_id,display_name,authority,source_url,source_priority,refresh_interval_ms,freshness_ttl_ms,status)',
      'VALUES (?,?,?,?,?,?,?,"never-published")',
      'ON CONFLICT(source_id) DO UPDATE SET',
      'display_name=excluded.display_name, authority=excluded.authority, source_url=excluded.source_url,',
      'source_priority=excluded.source_priority, refresh_interval_ms=excluded.refresh_interval_ms, freshness_ttl_ms=excluded.freshness_ttl_ms'
    ].join(' ')).bind(
      source.id,
      source.displayName,
      source.authority,
      source.url,
      source.priority,
      source.refreshMs,
      source.freshnessMs
    ).run();
  }
}

async function insertVersion(db, source, version, records, fetchedAt) {
  const statements = records.map((record) => db.prepare([
    'INSERT INTO freqbeacon_program_entries',
    '(source_id,version,record_key,station_key,station_name,frequency_khz,days,start_minute_utc,end_minute_utc,start_at,end_at,effective_from,effective_to,title,description,language,target_region,source_record_id,confidence,original_time_zone,original_time,fetched_at,last_verified_at)',
    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ].join(' ')).bind(
    source.id,
    version,
    record.recordKey,
    record.stationKey,
    record.stationName || record.stationKey,
    record.frequencyKHz ?? null,
    record.days || null,
    record.startMinuteUtc ?? null,
    record.endMinuteUtc ?? null,
    record.startAt || null,
    record.endAt || null,
    record.effectiveFrom || null,
    record.effectiveTo || null,
    record.title,
    record.description || null,
    record.language || null,
    record.targetRegion || null,
    record.sourceRecordId || null,
    record.confidence || 'official',
    record.originalTimeZone || null,
    record.originalTime || null,
    fetchedAt,
    fetchedAt
  ));

  const batchSize = 50;
  for (let offset = 0; offset < statements.length; offset += batchSize) {
    const chunk = statements.slice(offset, offset + batchSize);
    if (typeof db.batch === 'function') await db.batch(chunk);
    else for (const statement of chunk) await statement.run();
  }
}

async function refreshSource(env, source, force = false) {
  const db = env.RECEIVER_HEALTH_DB;
  const now = Date.now();
  const current = await db.prepare('SELECT * FROM freqbeacon_program_sources WHERE source_id=?').bind(source.id).first();
  if (!force && Number(current?.next_refresh_at || 0) > now) {
    return { source:source.id, status:'not-due', recordCount:Number(current?.record_count || 0) };
  }

  await db.prepare('UPDATE freqbeacon_program_sources SET last_attempt_at=?, next_refresh_at=? WHERE source_id=?')
    .bind(now, now + source.refreshMs, source.id).run();

  try {
    const payload = await source.refresh(new Date(now));
    const records = dedupeRecords(payload.records || []);
    const validation = validateCandidateRecords(records, source, Number(current?.record_count || 0));
    if (!validation.ok) throw new Error('validation rejected refresh: ' + validation.errors.join('; '));

    const version = source.id + '-' + now;
    await insertVersion(db, source, version, records, now);
    const expiresAt = now + source.freshnessMs;
    const validationText = JSON.stringify({ ok:true, count:records.length, checkedAt:new Date(now).toISOString() });

    await db.prepare([
      'UPDATE freqbeacon_program_sources SET',
      'last_success_at=?, last_verified_at=?, next_refresh_at=?, status="healthy", record_count=?,',
      'active_version=?, active_fetched_at=?, active_expires_at=?, effective_from=?, effective_to=?, season=?,',
      'last_error=NULL, last_validation=?, consecutive_failures=0',
      'WHERE source_id=?'
    ].join(' ')).bind(
      now,
      now,
      now + source.refreshMs,
      records.length,
      version,
      now,
      expiresAt,
      payload.effectiveFrom || null,
      payload.effectiveTo || null,
      payload.season || null,
      validationText,
      source.id
    ).run();

    const retentionCutoff = now - 30 * DAY_MS;
    await db.prepare('DELETE FROM freqbeacon_program_entries WHERE source_id=? AND version<>? AND fetched_at<?')
      .bind(source.id, version, retentionCutoff).run();

    return { source:source.id, status:'published', recordCount:records.length, version, expiresAt };
  } catch (error) {
    const freshLastGood = Number(current?.active_expires_at || 0) > now && current?.active_version;
    const status = freshLastGood ? 'degraded' : 'expired';
    await db.prepare([
      'UPDATE freqbeacon_program_sources SET',
      'status=?, last_error=?, last_validation=?, consecutive_failures=consecutive_failures+1',
      'WHERE source_id=?'
    ].join(' ')).bind(
      status,
      String(error?.message || error).slice(0,1000),
      JSON.stringify({ ok:false, checkedAt:new Date(now).toISOString(), error:String(error?.message || error).slice(0,800) }),
      source.id
    ).run();
    return { source:source.id, status, error:String(error?.message || error), servingLastKnownGood:Boolean(freshLastGood) };
  }
}

async function refreshDueSources(env, options = {}) {
  await ensureSchema(env);
  const force = options.force === true;
  const results = [];
  for (const source of SOURCE_DEFINITIONS) results.push(await refreshSource(env, source, force));
  return results;
}

function sourceFreshness(row, now = Date.now()) {
  if (!row?.active_version) return 'never-published';
  if (Number(row.active_expires_at || 0) <= now) return 'expired';
  if (row.status === 'degraded') return 'degraded';
  return 'fresh';
}

function safeJson(value) {
  try { return JSON.parse(value); } catch { return value; }
}

async function sourceStatus(env) {
  await ensureSchema(env);
  const result = await env.RECEIVER_HEALTH_DB.prepare('SELECT * FROM freqbeacon_program_sources ORDER BY source_priority DESC, display_name').all();
  const now = Date.now();
  return (result?.results || []).map((row) => ({
    sourceId:row.source_id,
    sourceName:row.display_name,
    authority:row.authority,
    sourceUrl:row.source_url,
    priority:row.source_priority,
    status:row.status,
    freshness:sourceFreshness(row, now),
    recordCount:row.record_count,
    season:row.season || null,
    effectiveFrom:row.effective_from || null,
    effectiveTo:row.effective_to || null,
    lastAttemptAt:row.last_attempt_at ? new Date(Number(row.last_attempt_at)).toISOString() : null,
    lastSuccessfulFetch:row.last_success_at ? new Date(Number(row.last_success_at)).toISOString() : null,
    lastVerifiedAt:row.last_verified_at ? new Date(Number(row.last_verified_at)).toISOString() : null,
    freshUntil:row.active_expires_at ? new Date(Number(row.active_expires_at)).toISOString() : null,
    nextExpectedRefresh:row.next_refresh_at ? new Date(Number(row.next_refresh_at)).toISOString() : null,
    servingLastKnownGood:Boolean(row.active_version && row.last_attempt_at && row.last_success_at && Number(row.last_attempt_at) > Number(row.last_success_at) && Number(row.active_expires_at || 0) > now),
    activeVersion:row.active_version || null,
    validation:row.last_validation ? safeJson(row.last_validation) : null,
    lastError:row.last_error || null,
    consecutiveFailures:Number(row.consecutive_failures || 0)
  }));
}

function formatWindow(startDate, endDate, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone, hour:'numeric', minute:'2-digit', hour12:true });
    const zone = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName:'short' })
      .formatToParts(startDate).find((part) => part.type === 'timeZoneName')?.value || '';
    return formatter.format(startDate) + '–' + formatter.format(endDate) + (zone ? ' ' + zone : '');
  } catch {
    return startDate.toISOString().slice(11,16) + '–' + endDate.toISOString().slice(11,16) + ' UTC';
  }
}

async function rowsForStation(env, stationKey) {
  const result = await env.RECEIVER_HEALTH_DB.prepare([
    'SELECT e.*,',
    's.display_name AS source_label, s.authority AS source_authority, s.source_url, s.source_priority,',
    's.active_expires_at, s.last_verified_at, s.active_fetched_at, s.season AS source_season, s.status AS source_status',
    'FROM freqbeacon_program_entries e',
    'JOIN freqbeacon_program_sources s ON s.source_id=e.source_id AND s.active_version=e.version',
    'WHERE e.station_key=?'
  ].join(' ')).bind(stationKey).all();
  return result?.results || [];
}

async function integratedSourceRows(env, stationKey) {
  const ids = SOURCES_BY_STATION.get(stationKey) || [];
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const result = await env.RECEIVER_HEALTH_DB.prepare('SELECT * FROM freqbeacon_program_sources WHERE source_id IN (' + placeholders + ')').bind(...ids).all();
  return result?.results || [];
}

async function programGuideResponse(request, env, ctx) {
  await ensureSchema(env);
  const url = new URL(request.url);
  const stationRaw = String(url.searchParams.get('station') || '').trim();
  const stationKey = normalizeStationKey(stationRaw);
  const frequency = Number(url.searchParams.get('frequency'));
  const at = url.searchParams.get('at') ? new Date(url.searchParams.get('at')) : new Date();
  const displayTimeZone = url.searchParams.get('tz') || 'UTC';

  if (!stationRaw || !stationKey || !Number.isFinite(frequency) || frequency < 100 || frequency > 30000 || Number.isNaN(at.getTime())) {
    return json({ status:'error', message:'Invalid program-guide request.' }, 400);
  }
  try { new Intl.DateTimeFormat('en-US', { timeZone:displayTimeZone }).format(at); }
  catch { return json({ status:'error', message:'Invalid time zone.' }, 400); }

  const integratedSources = await integratedSourceRows(env, stationKey);
  if (!integratedSources.length) {
    return json({
      station:stationRaw,
      frequency,
      at:at.toISOString(),
      status:'unsupported',
      verified:false,
      message:'Exact program guide is not yet integrated for this broadcaster.'
    });
  }

  const rows = await rowsForStation(env, stationKey);
  if (!rows.length) {
    if (ctx?.waitUntil) ctx.waitUntil(refreshDueSources(env));
    const stale = integratedSources.some((row) => row.active_version && Number(row.active_expires_at || 0) <= Date.now());
    return json({
      station:stationRaw,
      frequency,
      at:at.toISOString(),
      status:stale ? 'stale' : 'unavailable',
      verified:false,
      message:stale
        ? 'Station identified — current program schedule unavailable because the last verified guide has expired.'
        : 'Station identified — current program schedule is not available yet.'
    });
  }

  const selection = selectProgramFromRecords(rows, at, frequency, new Date());
  if (selection.status === 'ambiguous') {
    const first = selection.candidates[0]?.record || {};
    return json({
      station:stationRaw,
      frequency,
      at:at.toISOString(),
      status:'ambiguous',
      verified:false,
      candidates:selection.titles,
      message:'Published program records conflict at this time, so FREQBEACON will not guess.',
      sourceUrl:first.source_url,
      sourceLabel:first.source_label
    });
  }

  if (selection.status === 'verified') {
    const candidate = selection.best;
    const record = candidate.record;
    const occurrence = candidate.occurrence;
    return json({
      station:stationRaw,
      frequency,
      at:at.toISOString(),
      status:'verified',
      verified:true,
      program:record.title,
      description:record.description || null,
      language:record.language || null,
      targetRegion:record.target_region || null,
      window:formatWindow(occurrence.startDate, occurrence.endDate, displayTimeZone),
      start:occurrence.startDate.toISOString(),
      end:occurrence.endDate.toISOString(),
      sourceUrl:record.source_url,
      sourceLabel:record.source_label,
      provenance:{
        sourceId:record.source_id,
        authority:record.source_authority,
        sourcePriority:Number(record.source_priority || 0),
        fetchedAt:record.active_fetched_at ? new Date(Number(record.active_fetched_at)).toISOString() : null,
        lastVerifiedAt:record.last_verified_at ? new Date(Number(record.last_verified_at)).toISOString() : null,
        freshUntil:record.active_expires_at ? new Date(Number(record.active_expires_at)).toISOString() : null,
        season:record.source_season || null,
        confidence:record.confidence || 'official',
        originalTimeZone:record.original_time_zone || null,
        originalTime:record.original_time || null
      }
    });
  }

  const now = Date.now();
  const hasFreshSource = integratedSources.some((row) => row.active_version && Number(row.active_expires_at || 0) > now);
  if (!hasFreshSource) {
    return json({
      station:stationRaw,
      frequency,
      at:at.toISOString(),
      status:'stale',
      verified:false,
      message:'Station identified — current program schedule unavailable because all integrated schedules for this station are stale or expired.'
    });
  }

  return json({
    station:stationRaw,
    frequency,
    at:at.toISOString(),
    status:'unverified',
    verified:false,
    message:'Station identified — no trustworthy current program listing covers this frequency and time.'
  });
}

async function statusResponse(request, env) {
  const url = new URL(request.url);
  let refresh = null;
  if (url.searchParams.get('refresh') === 'due') refresh = await refreshDueSources(env);
  const sources = await sourceStatus(env);
  const usable = sources.filter((source) => source.freshness === 'fresh' || source.freshness === 'degraded').length;
  return json({
    generatedAt:new Date().toISOString(),
    sources,
    summary:{
      sourceCount:sources.length,
      usableSources:usable,
      staleOrExpired:sources.filter((source) => source.freshness === 'expired').length,
      neverPublished:sources.filter((source) => source.freshness === 'never-published').length,
      records:sources.reduce((sum, source) => sum + Number(source.recordCount || 0), 0)
    },
    refresh,
    policy:{
      publication:'candidate versions are validated before the active-version pointer changes',
      stale:'expired sources are never presented as ON NOW',
      precedence:'official broadcaster sources outrank lower-authority adapters; equal-authority conflicts fail closed',
      runtime:'program lookup reads only the local indexed catalog; user Identify never waits on broadcaster networks'
    }
  });
}

export async function handleProgramCatalogRequest(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    if (url.pathname === '/api/program-guide' || url.pathname === '/api/program-guide/status') return json({ error:'Method not allowed' }, 405);
    return null;
  }

  if (url.pathname === '/api/program-guide/status') {
    const response = await statusResponse(request, env);
    return request.method === 'HEAD' ? new Response(null, { status:response.status, headers:response.headers }) : response;
  }
  if (url.pathname === '/api/program-guide') {
    const response = await programGuideResponse(request, env, ctx);
    return request.method === 'HEAD' ? new Response(null, { status:response.status, headers:response.headers }) : response;
  }
  return null;
}

export async function runProgramCatalogScheduled(event, env) {
  const cron = String(event?.cron || '');
  if (cron === PROGRAM_REFRESH_CRON || !cron) return refreshDueSources(env);
  if (cron === RECEIVER_HEALTH_CRON) {
    const scheduledTime = Number(event?.scheduledTime);
    const minute = new Date(Number.isFinite(scheduledTime) ? scheduledTime : Date.now()).getUTCMinutes();
    if (minute === 15) return refreshDueSources(env);
  }
  return [];
}

export { SOURCE_DEFINITIONS };
