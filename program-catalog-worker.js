const HOUR_MS = 3600000;
const DAY_MS = 86400000;
const PROGRAM_REFRESH_CRON = '17 */6 * * *';
const RECEIVER_HEALTH_CRON = '* * * * *';

const WBCQ_BASE = 'https://wbcq.com/schedule/index.php?fn=sked&freq=';
const WRMI_SHEET = 'https://docs.google.com/spreadsheets/d/1pcIEX8kisrOPqlXHDAq6gympKUgDj0SIb96qce2kGGQ/edit';
const WRMI_CSV = 'https://docs.google.com/spreadsheets/d/1pcIEX8kisrOPqlXHDAq6gympKUgDj0SIb96qce2kGGQ/export?format=csv&gid=0';
const REE_SOURCE = 'https://www.rtve.es/play/radio/radio-exterior/';
const KARN_SOURCE = 'https://player.sportsanimal920.com/station-information/';
const RRI_SOURCE = 'https://www.rri.ro/en/frequencies';
const ABC_RN_SOURCE = 'https://www.abc.net.au/listen/live/radionational';
const KBS_WORLD_SOURCE = 'https://world.kbs.co.kr/service/';
const CHANNEL_AFRICA_SOURCE = 'https://www.channelafrica.co.za/channelafrica/prgramme-schedule/';
const RADIO_NACIONAL_AMAZONIA_SOURCE = 'https://radionacional.ebc.com.br/';
const VATICAN_ENGLISH_EPG_SOURCE = 'https://www.vaticannews.va/en/epg.html';
const VOA_GLOBAL_ENGLISH_SOURCE = 'https://www.voanews.com/radio/schedule/60';
const RTI_ENGLISH_SOURCE = 'https://www.rti.org.tw/en/programschedule?uid=4';
const AKASHVANI_NEWS_SOURCE = 'https://newsonair.gov.in/news-services-division/?lang=en';

const DAY_INDEX = Object.freeze({ Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Su:0, Mo:1, Tu:2, We:3, Th:4, Fr:5, Sa:6 });

const STATION_ALIASES = new Map([
  ['WBCQ','WBCQ'],
  ['WRMI','WRMI'],
  ['RADIO MIAMI INTERNATIONAL','WRMI'],
  ['RADIO EXTERIOR DE ESPANA','REE'],
  ['REE','REE'],
  ['RADIO ROMANIA INTERNATIONAL','RRI'],
  ['RADIO ROMANIA INTL','RRI'],
  ['RRI','RRI'],
  ['KARN','KARN'],
  ['KARN AM','KARN'],
  ['SPORTS ANIMAL 920','KARN'],
  ['SPORTSANIMAL 920','KARN'],
  ['ABC RADIO NATIONAL','ABC_RN'],
  ['2RN','ABC_RN'],
  ['3RN','ABC_RN'],
  ['4RN','ABC_RN'],
  ['5RN','ABC_RN'],
  ['6RN','ABC_RN'],
  ['7RN','ABC_RN'],
  ['KBS WORLD RADIO','KBS_WORLD'],
  ['KBS WORLD','KBS_WORLD'],
  ['CHANNEL AFRICA','CHANNEL_AFRICA'],
  ['RADIO NACIONAL DA AMAZONIA','RADIO_NACIONAL_AMAZONIA'],
  ['RADIO NACIONAL AMAZONIA','RADIO_NACIONAL_AMAZONIA'],
  ['RADIO NACIONAL DA AMAZÔNIA','RADIO_NACIONAL_AMAZONIA'],
  ['VATICAN RADIO','VATICAN_RADIO'],
  ['RADIO VATICANA','VATICAN_RADIO'],
  ['VOICE OF AMERICA','VOA'],
  ['VOA','VOA'],
  ['RADIO TAIWAN INTERNATIONAL','RTI'],
  ['RTI','RTI'],
  ['ALL INDIA RADIO','AKASHVANI'],
  ['AIR','AKASHVANI'],
  ['AKASHVANI','AKASHVANI'],
  ['AKASHVANI EXTERNAL SERVICES','AKASHVANI'],
  ['ALL INDIA RADIO EXTERNAL SERVICES','AKASHVANI'],
  ['AIR EXTERNAL SERVICES','AKASHVANI']
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
    id:'rri-official-english',
    displayName:'Radio Romania International official English shortwave schedule',
    authority:'official-broadcaster',
    url:RRI_SOURCE,
    priority:100,
    refreshMs:24 * HOUR_MS,
    freshnessMs:8 * DAY_MS,
    minRecords:10,
    maxRecords:100,
    stationKeys:['RRI'],
    coverageLevel:'service-only',
    refresh:refreshRri
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
  },
  {
    id:'abc-rn-official-live',
    displayName:'ABC Radio National official live player',
    authority:'official-broadcaster',
    url:ABC_RN_SOURCE,
    priority:100,
    refreshMs:15 * 60 * 1000,
    freshnessMs:45 * 60 * 1000,
    minRecords:1,
    maxRecords:3,
    stationKeys:['ABC_RN'],
    refresh:refreshAbcRn
  },
  {
    id:'kbs-world-english-official-live',
    displayName:'KBS WORLD Radio official English live schedule',
    authority:'official-broadcaster',
    url:KBS_WORLD_SOURCE,
    priority:100,
    refreshMs:15 * 60 * 1000,
    freshnessMs:45 * 60 * 1000,
    minRecords:1,
    maxRecords:3,
    stationKeys:['KBS_WORLD_ENGLISH'],
    scope:'English service',
    refresh:refreshKbsWorldEnglish
  },
  {
    id:'channel-africa-official-live',
    displayName:'Channel Africa official live schedule',
    authority:'official-broadcaster',
    url:CHANNEL_AFRICA_SOURCE,
    priority:100,
    refreshMs:15 * 60 * 1000,
    freshnessMs:45 * 60 * 1000,
    minRecords:1,
    maxRecords:3,
    stationKeys:['CHANNEL_AFRICA'],
    refresh:refreshChannelAfrica
  },
  {
    id:'radio-nacional-amazonia-official-live',
    displayName:'Rádio Nacional da Amazônia official live schedule',
    authority:'official-broadcaster',
    url:RADIO_NACIONAL_AMAZONIA_SOURCE,
    priority:100,
    refreshMs:15 * 60 * 1000,
    freshnessMs:45 * 60 * 1000,
    minRecords:2,
    maxRecords:4,
    stationKeys:['RADIO_NACIONAL_AMAZONIA'],
    refresh:refreshRadioNacionalAmazonia
  },
  {
    id:'vatican-radio-english-official-live',
    displayName:'Vatican Radio official English-channel live EPG',
    authority:'official-broadcaster',
    url:VATICAN_ENGLISH_EPG_SOURCE,
    priority:100,
    refreshMs:15 * 60 * 1000,
    freshnessMs:45 * 60 * 1000,
    minRecords:1,
    maxRecords:2,
    stationKeys:['VATICAN_RADIO_ENGLISH'],
    scope:'English service',
    refresh:refreshVaticanEnglish
  },
  {
    id:'voa-global-english-official-live',
    displayName:'Voice of America Global English official live schedule',
    authority:'official-broadcaster',
    url:VOA_GLOBAL_ENGLISH_SOURCE,
    priority:100,
    refreshMs:15 * 60 * 1000,
    freshnessMs:45 * 60 * 1000,
    minRecords:1,
    maxRecords:2,
    stationKeys:['VOA_GLOBAL_ENGLISH'],
    scope:'Global English service',
    refresh:refreshVoaGlobalEnglish
  },
  {
    id:'rti-english-official-live',
    displayName:'Radio Taiwan International official English on-air schedule',
    authority:'official-broadcaster',
    url:RTI_ENGLISH_SOURCE,
    priority:100,
    refreshMs:15 * 60 * 1000,
    freshnessMs:45 * 60 * 1000,
    minRecords:1,
    maxRecords:2,
    stationKeys:['RTI_ENGLISH'],
    scope:'English service',
    refresh:refreshRtiEnglish
  },
  {
    id:'akashvani-external-news-official',
    displayName:'Akashvani News official External Services bulletin schedule',
    authority:'official-broadcaster',
    url:AKASHVANI_NEWS_SOURCE,
    priority:100,
    refreshMs:24 * HOUR_MS,
    freshnessMs:7 * DAY_MS,
    minRecords:10,
    maxRecords:100,
    stationKeys:["AKASHVANI_FRENCH","AKASHVANI_INDONESIAN","AKASHVANI_BURMESE","AKASHVANI_PERSIAN","AKASHVANI_DARI","AKASHVANI_PASHTO","AKASHVANI_ARABIC","AKASHVANI_CHINESE","AKASHVANI_TIBETAN","AKASHVANI_SWAHILI","AKASHVANI_BALUCHI","AKASHVANI_URDU"],
    scope:'External Services named news bulletins',
    refresh:refreshAkashvaniExternalNews
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

export function resolveProgramStationKey(value, language = '') {
  const stationKey = normalizeStationKey(value);
  if (stationKey === 'KBS_WORLD' && /\bEnglish\b/i.test(String(language || ''))) return 'KBS_WORLD_ENGLISH';
  if (stationKey === 'VATICAN_RADIO' && /\bEnglish\b/i.test(String(language || ''))) return 'VATICAN_RADIO_ENGLISH';
  if (stationKey === 'VOA' && /\bEnglish\b/i.test(String(language || ''))) return 'VOA_GLOBAL_ENGLISH';
  if (stationKey === 'RTI' && /\bEnglish\b/i.test(String(language || ''))) return 'RTI_ENGLISH';
  if (stationKey === 'AKASHVANI') {
    const languageKey = normalizeStationKey(language).replace(/\s+/g, '_');
    const supported = new Set(['FRENCH','INDONESIAN','BURMESE','PERSIAN','DARI','PASHTO','ARABIC','CHINESE','TIBETAN','SWAHILI','BALUCHI','URDU']);
    if (supported.has(languageKey)) return 'AKASHVANI_' + languageKey;
  }
  return stationKey;
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

function wrmiConfidence(title) {
  const exactPrograms = [
    /Supreme Master TV/i,
    /WRMI Legends/i,
    /Hal Turner/i,
    /Your UFO Show/i,
    /Truth2Ponder/i,
    /Early Jazz/i,
    /Hello World/i,
    /Christian America Ministries/i,
    /We Pluribus/i,
    /Fifteen Minute Countdown/i
  ];
  return exactPrograms.some((pattern) => pattern.test(title)) ? 'official' : 'official-block';
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
        confidence:wrmiConfidence(title),
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


function monthNumber(name) {
  return ['january','february','march','april','may','june','july','august','september','october','november','december']
    .indexOf(String(name || '').toLowerCase()) + 1;
}

function parseRriEffectiveRange(text) {
  const match = String(text || '').match(
    /valid\s+as\s+of\s+([A-Za-z]+)\s+(\d{1,2})\s+to\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/i
  );
  if (!match) return { effectiveFrom:null, effectiveTo:null, season:null };
  const startMonth = monthNumber(match[1]);
  const endMonth = monthNumber(match[3]);
  const year = Number(match[5]);
  if (!startMonth || !endMonth || !Number.isFinite(year)) return { effectiveFrom:null, effectiveTo:null, season:null };
  const effectiveFrom = new Date(Date.UTC(year, startMonth - 1, Number(match[2]))).toISOString().slice(0,10);
  const effectiveTo = new Date(Date.UTC(year, endMonth - 1, Number(match[4]))).toISOString().slice(0,10);
  const season = (startMonth >= 3 && startMonth <= 5 ? 'A' : 'B') + String(year).slice(-2);
  return { effectiveFrom, effectiveTo, season };
}

function rriFrequency(value) {
  const match = String(value || '').replace(/,/g, '').match(/\b(\d{4,5})\b/);
  return match ? Number(match[1]) : null;
}

export function parseRriEnglishSchedule(html) {
  const raw = String(html || '');
  const text = htmlDecode(raw);
  const range = parseRriEffectiveRange(text);
  const records = [];
  let currentRegion = '';

  for (const rowMatch of raw.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((match) => htmlDecode(match[1]))
      .filter((cell) => cell !== '');
    if (cells.length < 2) continue;

    const timeIndex = cells.findIndex((cell) => /\d{1,2}[.:]\d{2}\s*[–—-]\s*\d{1,2}[.:]\d{2}/.test(cell));
    if (timeIndex < 0) {
      const possibleRegion = cells.find((cell) => !/frequency|alternative|reception|utc|khz/i.test(cell));
      if (possibleRegion) currentRegion = possibleRegion;
      continue;
    }

    if (timeIndex > 0 && !/\bUTC\b/i.test(cells[timeIndex - 1])) currentRegion = cells[timeIndex - 1] || currentRegion;
    if (!currentRegion) currentRegion = 'International';

    const timeMatch = cells[timeIndex].match(/(\d{1,2})[.:](\d{2})\s*[–—-]\s*(\d{1,2})[.:](\d{2})/);
    if (!timeMatch) continue;
    const startMinuteUtc = parseClock24(timeMatch[1], timeMatch[2]);
    let endMinuteUtc = parseClock24(timeMatch[3], timeMatch[4]);
    if (startMinuteUtc == null || endMinuteUtc == null) continue;
    if (endMinuteUtc === 0 && startMinuteUtc > 0) endMinuteUtc = 1440;

    const frequencyCells = cells.slice(timeIndex + 1);
    const frequencies = [];
    for (const frequencyCell of frequencyCells) {
      const frequencyKHz = rriFrequency(frequencyCell);
      if (Number.isFinite(frequencyKHz) && frequencyKHz >= 3000 && frequencyKHz <= 30000 && !frequencies.includes(frequencyKHz)) {
        frequencies.push(frequencyKHz);
      }
    }

    for (let index = 0; index < frequencies.length; index += 1) {
      const frequencyKHz = frequencies[index];
      records.push(withRecordKey({
        stationKey:'RRI',
        stationName:'Radio Romania International',
        frequencyKHz,
        days:'0123456',
        startMinuteUtc,
        endMinuteUtc,
        startAt:null,
        endAt:null,
        effectiveFrom:range.effectiveFrom,
        effectiveTo:range.effectiveTo,
        title:'RRI English-language service',
        description:index === 0
          ? 'Official English shortwave transmission block.'
          : 'Official alternative frequency for the English shortwave transmission block.',
        language:'English',
        targetRegion:currentRegion,
        sourceRecordId:currentRegion + '-' + cells[timeIndex] + '-' + frequencyKHz,
        confidence:'official-block',
        originalTimeZone:'UTC',
        originalTime:cells[timeIndex] + ' UTC'
      }));
    }
  }

  return { records:dedupeRecords(records), ...range };
}


function liveWindowRecord({ stationKey, stationName, frequencyKHz = null, title, fetchedAt, startMinute = null, endMinute = null, timeZone, language = '', targetRegion = '', sourceRecordId }) {
  const reference = fetchedAt instanceof Date ? fetchedAt : new Date(fetchedAt);
  let start;
  let end;
  let originalTime = 'live at ' + reference.toISOString();

  if (Number.isFinite(startMinute) && Number.isFinite(endMinute) && timeZone) {
    const interval = nearestLocalInterval(reference, startMinute, endMinute, timeZone);
    start = interval.start;
    end = interval.end;
    originalTime = String(Math.floor(startMinute / 60)).padStart(2,'0') + ':' + String(startMinute % 60).padStart(2,'0')
      + '-' + String(Math.floor(endMinute / 60)).padStart(2,'0') + ':' + String(endMinute % 60).padStart(2,'0')
      + ' ' + timeZone;
  } else {
    start = new Date(reference.getTime() - 5 * 60 * 1000);
    end = new Date(reference.getTime() + 20 * 60 * 1000);
  }

  return withRecordKey({
    stationKey,
    stationName,
    frequencyKHz,
    days:'',
    startMinuteUtc:null,
    endMinuteUtc:null,
    startAt:start.toISOString(),
    endAt:end.toISOString(),
    effectiveFrom:isoDate(start),
    effectiveTo:isoDate(end),
    title:normalizeTitle(title),
    description:'Current program published by the broadcaster.',
    language,
    targetRegion,
    sourceRecordId,
    confidence:'official-live',
    originalTimeZone:timeZone || 'UTC',
    originalTime
  });
}

export function parseAbcRadioNationalNow(html, fetchedAt = new Date()) {
  const text = htmlDecode(html);
  const match = text.match(/Play Live\s+(.{2,120}?)\s+on\s+Radio National\b/i);
  const title = normalizeTitle(match?.[1] || '');
  if (!title || /select station|loading/i.test(title)) return [];
  return [liveWindowRecord({
    stationKey:'ABC_RN',
    stationName:'ABC Radio National',
    title,
    fetchedAt,
    timeZone:'Australia/Sydney',
    language:'English',
    targetRegion:'Australia',
    sourceRecordId:'live-player'
  })];
}

export function parseKbsWorldEnglishNow(html, fetchedAt = new Date()) {
  const text = htmlDecode(html);
  const startIndex = text.search(/KBS WORLD Radio\s+Ch2 English/i);
  if (startIndex < 0) return [];
  const segment = text.slice(startIndex, startIndex + 1200);
  const onAirIndex = segment.search(/\bON AIR\b/i);
  if (onAirIndex < 0) return [];
  const before = segment.slice(0, onAirIndex);
  const after = segment.slice(onAirIndex + 'ON AIR'.length);
  const starts = [...before.matchAll(/(\d{1,2}):(\d{2})\s+(.{2,120}?)(?=\s+\d{1,2}:\d{2}|$)/g)];
  const current = starts.at(-1);
  const next = after.match(/\s*(\d{1,2}):(\d{2})\b/);
  if (!current || !next) return [];
  const startMinute = parseClock24(current[1], current[2]);
  const endMinute = parseClock24(next[1], next[2]);
  const title = normalizeTitle(current[3]);
  if (!title || startMinute == null || endMinute == null) return [];
  return [liveWindowRecord({
    stationKey:'KBS_WORLD_ENGLISH',
    stationName:'KBS WORLD Radio English',
    title,
    fetchedAt,
    startMinute,
    endMinute,
    timeZone:'Asia/Seoul',
    language:'English',
    targetRegion:'International',
    sourceRecordId:'ch2-live'
  })];
}

export function parseChannelAfricaNow(html, fetchedAt = new Date()) {
  const text = htmlDecode(html);
  const head = text.split(/Programme Schedule/i)[0] || text.slice(0, 1800);
  const match = head.match(/Live Radio\s+(.{2,120}?)\s+(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s+Listen Live/i);
  if (!match) return [];
  const startMinute = parseClock24(match[2], match[3]);
  const endMinute = parseClock24(match[4], match[5]);
  const title = normalizeTitle(match[1]);
  if (!title || startMinute == null || endMinute == null) return [];
  return [liveWindowRecord({
    stationKey:'CHANNEL_AFRICA',
    stationName:'Channel Africa',
    title,
    fetchedAt,
    startMinute,
    endMinute,
    timeZone:'Africa/Johannesburg',
    targetRegion:'Africa',
    sourceRecordId:'live-radio'
  })];
}


export function parseRadioNacionalAmazoniaNow(html, fetchedAt = new Date()) {
  const text = htmlDecode(html);
  const schedule = (text.split(/Podcast/i)[0] || text).slice(0, 12000);
  const match = schedule.match(/(?:\d{1,2}\s*h\s+)?Amaz[oô]nia\s+(.{2,120}?)\s+ouvir\s+A seguir\s*\|\s*(.{2,120}?)(?=\s+\d{1,2}\s*h\b|\s+Ver programa[cç][aã]o completa|$)/i);
  const title = normalizeTitle(match?.[1] || '');
  if (!title || /ao vivo|programa[cç][aã]o das r[aá]dios/i.test(title)) return [];
  return [6180,11780].map((frequencyKHz) => liveWindowRecord({
    stationKey:'RADIO_NACIONAL_AMAZONIA',
    stationName:'Rádio Nacional da Amazônia',
    frequencyKHz,
    title,
    fetchedAt,
    timeZone:'America/Sao_Paulo',
    language:'Portuguese',
    targetRegion:'Brazil / Amazonia',
    sourceRecordId:'live-' + frequencyKHz
  }));
}

export function parseVaticanEnglishNow(html, fetchedAt = new Date()) {
  const text = htmlDecode(html);
  const liveHead = text.slice(0, 1800);
  const match = liveHead.match(/Live now[\s\S]{0,500}?(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})\s+(.{2,100}?)(?=\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b)/i);
  if (!match) return [];
  const startMinute = parseClock24(match[1], match[2]);
  const endMinute = parseClock24(match[3], match[4]);
  const title = normalizeTitle(match[5]);
  if (!title || startMinute == null || endMinute == null || /select\s*$/i.test(title)) return [];
  return [liveWindowRecord({
    stationKey:'VATICAN_RADIO_ENGLISH',
    stationName:'Vatican Radio English',
    title,
    fetchedAt,
    startMinute,
    endMinute,
    timeZone:'Europe/Rome',
    language:'English',
    targetRegion:'International',
    sourceRecordId:'english-epg-live'
  })];
}


export function parseVoaGlobalEnglishNow(html, fetchedAt = new Date()) {
  const text = htmlDecode(html);
  const liveIndex = text.search(/\bLIVE\b/i);
  if (liveIndex < 0) return [];
  const segment = text.slice(Math.max(0, liveIndex - 220), liveIndex + 420);
  const afterLive = normalizeTitle(segment.slice(segment.search(/\bLIVE\b/i) + 4));
  const titleMatch = afterLive.match(/^(.{2,120}?)(?=\s+(?:VOA1|VOA’s|Voice of America|International Edition|Worldwide in Five|The Issue|Border Crossings|[A-Z][a-z]+\s+\d{1,2}\b)|$)/);
  const title = normalizeTitle(titleMatch?.[1] || afterLive.split(/\s{2,}/)[0] || '');
  if (!title || title.length > 120 || /^(radio|schedule|programs)$/i.test(title)) return [];
  return [liveWindowRecord({
    stationKey:'VOA_GLOBAL_ENGLISH',
    stationName:'Voice of America Global English',
    title,
    fetchedAt,
    language:'English',
    targetRegion:'International',
    sourceRecordId:'global-english-live'
  })];
}


export function parseRtiEnglishNow(html, fetchedAt = new Date()) {
  const raw = String(html || '');
  const markerIndex = raw.search(/alt=["'][^"']*ON\s*AIR[^"']*["']/i);
  if (markerIndex < 0) return [];
  const tagStart = Math.max(0, raw.lastIndexOf('<', markerIndex));
  const segment = htmlDecode(raw.slice(tagStart, tagStart + 2200));
  const title = normalizeTitle(
    segment
      .replace(/^ON\s*AIR\s*/i, '')
      .split(/\s+Hosts?\s*[:：]|\s+Listen\b|\s+Every\b|\s+Tune in\b/i)[0]
  );
  if (!title || title.length < 2 || title.length > 120 || /^(image|english program)$/i.test(title)) return [];
  return [liveWindowRecord({
    stationKey:'RTI_ENGLISH',
    stationName:'Radio Taiwan International English',
    title,
    fetchedAt,
    language:'English',
    targetRegion:'International',
    sourceRecordId:'english-on-air'
  })];
}


function parseTimeRanges(value) {
  const out = [];
  for (const match of String(value || '').matchAll(/(\d{4})\s*[-–—]\s*(\d{4})/g)) {
    const start = parseHHMM(match[1]);
    const end = parseHHMM(match[2]);
    if (start != null && end != null && start !== end) out.push({ start, end });
  }
  return out;
}

function kolkataMinutesToUtc(minute) {
  return ((Number(minute) - 330) % 1440 + 1440) % 1440;
}

export function parseAkashvaniExternalNews(html) {
  const languageMap = new Map([
    ['FRENCH','French'],['INDONESIAN','Indonesian'],['BURMESE','Burmese'],['PERSIAN','Persian'],
    ['DARI','Dari'],['PASHTO','Pashto'],['SWAHILI','Swahili'],['BALUCHI','Baluchi'],['ARABIC','Arabic'],
    ['CHINESE','Chinese'],['TIBETAN','Tibetan'],['URDU','Urdu']
  ]);
  const records = [];

  for (const rowMatch of String(html || '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((match) => htmlDecode(match[1]))
      .filter(Boolean);
    if (cells.length < 3) continue;

    const languageCell = normalizeStationKey(cells[0]).replace(/[-–—]\s*[IVX]+$/i, '').replace(/\s+[IVX]+$/i, '').trim();
    const language = languageMap.get(languageCell);
    if (!language) continue;

    const bulletinCell = String(cells[cells.length - 1] || '');
    if (!/\d{4}\s*[-–—]\s*\d{4}/.test(bulletinCell)) continue;

    const ranges = parseTimeRanges(bulletinCell);
    for (let index = 0; index < ranges.length; index += 1) {
      const localStart = ranges[index].start;
      const localEnd = ranges[index].end;
      const startMinuteUtc = kolkataMinutesToUtc(localStart);
      const endMinuteUtc = kolkataMinutesToUtc(localEnd);
      records.push(withRecordKey({
        stationKey:'AKASHVANI_' + language.toUpperCase(),
        stationName:'Akashvani External Services ' + language,
        frequencyKHz:null,
        days:'0123456',
        startMinuteUtc,
        endMinuteUtc,
        startAt:null,
        endAt:null,
        effectiveFrom:null,
        effectiveTo:null,
        title:language + ' News Bulletin',
        description:'Official Akashvani News bulletin carried within the External Services ' + language + ' transmission.',
        language,
        targetRegion:'International',
        sourceRecordId:language.toLowerCase() + '-news-' + index + '-' + localStart + '-' + localEnd,
        confidence:'official',
        originalTimeZone:'Asia/Kolkata',
        originalTime:String(Math.floor(localStart / 60)).padStart(2,'0') + ':' + String(localStart % 60).padStart(2,'0')
          + '-' + String(Math.floor(localEnd / 60)).padStart(2,'0') + ':' + String(localEnd % 60).padStart(2,'0') + ' Asia/Kolkata'
      }));
    }
  }

  return dedupeRecords(records);
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

async function refreshRri(fetchedAt) {
  const html = await fetchText(RRI_SOURCE);
  const parsed = parseRriEnglishSchedule(html);
  return { ...parsed, fetchedAt };
}

async function refreshKarn(fetchedAt) {
  const html = await fetchText(KARN_SOURCE);
  return { records:parseKarnNow(html, fetchedAt), season:null, effectiveFrom:null, effectiveTo:null, fetchedAt };
}

async function refreshAbcRn(fetchedAt) {
  const html = await fetchText(ABC_RN_SOURCE);
  return { records:parseAbcRadioNationalNow(html, fetchedAt), season:null, effectiveFrom:null, effectiveTo:null, fetchedAt };
}

async function refreshKbsWorldEnglish(fetchedAt) {
  const html = await fetchText(KBS_WORLD_SOURCE);
  return { records:parseKbsWorldEnglishNow(html, fetchedAt), season:null, effectiveFrom:null, effectiveTo:null, fetchedAt };
}

async function refreshChannelAfrica(fetchedAt) {
  const html = await fetchText(CHANNEL_AFRICA_SOURCE);
  return { records:parseChannelAfricaNow(html, fetchedAt), season:null, effectiveFrom:null, effectiveTo:null, fetchedAt };
}

async function refreshRadioNacionalAmazonia(fetchedAt) {
  const html = await fetchText(RADIO_NACIONAL_AMAZONIA_SOURCE);
  return { records:parseRadioNacionalAmazoniaNow(html, fetchedAt), season:null, effectiveFrom:null, effectiveTo:null, fetchedAt };
}

async function refreshVaticanEnglish(fetchedAt) {
  const html = await fetchText(VATICAN_ENGLISH_EPG_SOURCE);
  return { records:parseVaticanEnglishNow(html, fetchedAt), season:null, effectiveFrom:null, effectiveTo:null, fetchedAt };
}

async function refreshVoaGlobalEnglish(fetchedAt) {
  const html = await fetchText(VOA_GLOBAL_ENGLISH_SOURCE);
  return { records:parseVoaGlobalEnglishNow(html, fetchedAt), season:null, effectiveFrom:null, effectiveTo:null, fetchedAt };
}

async function refreshRtiEnglish(fetchedAt) {
  const html = await fetchText(RTI_ENGLISH_SOURCE);
  return { records:parseRtiEnglishNow(html, fetchedAt), season:null, effectiveFrom:null, effectiveTo:null, fetchedAt };
}

async function refreshAkashvaniExternalNews(fetchedAt) {
  const html = await fetchText(AKASHVANI_NEWS_SOURCE);
  return { records:parseAkashvaniExternalNews(html), season:null, effectiveFrom:null, effectiveTo:null, fetchedAt };
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

let schemaReady = null;

async function ensureSchema(env) {
  if (schemaReady) return schemaReady;
  schemaReady = initializeSchema(env).catch((error) => {
    schemaReady = null;
    throw error;
  });
  return schemaReady;
}

async function initializeSchema(env) {
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
      "status TEXT NOT NULL DEFAULT 'never-published',",
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
      "VALUES (?,?,?,?,?,?,?,'never-published')",
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
      "last_success_at=?, last_verified_at=?, next_refresh_at=?, status='healthy', record_count=?,",
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
  return (result?.results || []).map((row) => {
    const definition = SOURCE_DEFINITIONS.find((candidate) => candidate.id === row.source_id);
    const lastSuccess = Number(row.last_success_at || 0);
    const nextRefresh = Number(row.next_refresh_at || 0);
    const expiresAt = Number(row.active_expires_at || 0);
    return {
      sourceId:row.source_id,
      sourceName:row.display_name,
      authority:row.authority,
      coverageLevel:definition?.coverageLevel || 'program',
      scope:definition?.scope || null,
      sourceUrl:row.source_url,
      priority:row.source_priority,
      status:row.status,
      freshness:sourceFreshness(row, now),
      recordCount:row.record_count,
      season:row.season || null,
      effectiveFrom:row.effective_from || null,
      effectiveTo:row.effective_to || null,
      lastAttemptAt:row.last_attempt_at ? new Date(Number(row.last_attempt_at)).toISOString() : null,
      lastSuccessfulFetch:lastSuccess ? new Date(lastSuccess).toISOString() : null,
      lastVerifiedAt:row.last_verified_at ? new Date(Number(row.last_verified_at)).toISOString() : null,
      freshUntil:expiresAt ? new Date(expiresAt).toISOString() : null,
      nextExpectedRefresh:nextRefresh ? new Date(nextRefresh).toISOString() : null,
      ageMs:lastSuccess ? Math.max(0, now - lastSuccess) : null,
      freshnessRemainingMs:expiresAt ? expiresAt - now : null,
      refreshDue:Boolean(!nextRefresh || nextRefresh <= now),
      refreshOverdueMs:nextRefresh && nextRefresh < now ? now - nextRefresh : 0,
      servingLastKnownGood:Boolean(row.active_version && row.last_attempt_at && row.last_success_at && Number(row.last_attempt_at) > Number(row.last_success_at) && expiresAt > now),
      activeVersion:row.active_version || null,
      validation:row.last_validation ? safeJson(row.last_validation) : null,
      lastError:row.last_error || null,
      consecutiveFailures:Number(row.consecutive_failures || 0)
    };
  });
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
  const language = String(url.searchParams.get('language') || '').trim();
  const stationKey = resolveProgramStationKey(stationRaw, language);
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
      status:record.confidence === 'official-block' ? 'service' : 'verified',
      verified:record.confidence !== 'official-block',
      program:record.title,
      description:record.description || null,
      language:record.language || null,
      targetRegion:record.target_region || null,
      window:formatWindow(occurrence.startDate, occurrence.endDate, displayTimeZone),
      start:occurrence.startDate.toISOString(),
      end:occurrence.endDate.toISOString(),
      sourceUrl:record.source_url,
      sourceLabel:record.source_label,
      message:record.confidence === 'official-block'
        ? 'Station identified — the official source confirms this broadcast/service block, but does not identify the exact show airing at this minute.'
        : null,
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

  if (stationKey === 'WBCQ') {
    return json({
      station:stationRaw,
      frequency,
      at:at.toISOString(),
      status:'unverified',
      verified:false,
      message:'WBCQ’s official schedule has no current listing for this frequency and time.',
      sourceUrl:WBCQ_BASE + encodeURIComponent(Math.round(frequency)),
      sourceLabel:'WBCQ official program guide'
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


async function loadCoverageInventory(request, env) {
  if (!env?.ASSETS?.fetch) throw new Error('Coverage identity asset binding is unavailable');
  const assetUrl = new URL('/data/program-guide/coverage-identities.json', request.url);
  const response = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method:'GET' }));
  if (!response.ok) throw new Error('Coverage identity inventory unavailable: HTTP ' + response.status);
  const payload = await response.json();
  if (!Array.isArray(payload?.identities) || !Number.isFinite(Number(payload?.recognizedIdentityCount))) {
    throw new Error('Coverage identity inventory is invalid');
  }
  return payload;
}

async function activeProgramRows(env) {
  const result = await env.RECEIVER_HEALTH_DB.prepare([
    'SELECT e.*,',
    's.display_name AS source_label, s.authority AS source_authority, s.source_url, s.source_priority,',
    's.active_expires_at, s.last_verified_at, s.active_fetched_at, s.season AS source_season, s.status AS source_status',
    'FROM freqbeacon_program_entries e',
    'JOIN freqbeacon_program_sources s ON s.source_id=e.source_id AND s.active_version=e.version'
  ].join(' ')).all();
  return result?.results || [];
}

function summarizeCoverage(rows, keyName) {
  const grouped = new Map();
  for (const row of rows) {
    const values = Array.isArray(row[keyName]) ? row[keyName] : [row[keyName] || 'Unknown'];
    for (const value of values) {
      const key = String(value || 'Unknown');
      if (!grouped.has(key)) grouped.set(key, { key, recognized:0, programCovered:0, freshProgramSource:0, onNowDetermined:0 });
      const group = grouped.get(key);
      group.recognized += 1;
      if (row.hasProgramSource) group.programCovered += 1;
      if (row.hasFreshProgramSource) group.freshProgramSource += 1;
      if (row.onNowCanBeDetermined) group.onNowDetermined += 1;
    }
  }
  return [...grouped.values()]
    .map((group) => ({
      ...group,
      coveragePct:group.recognized ? Number((100 * group.programCovered / group.recognized).toFixed(1)) : 0,
      onNowPct:group.recognized ? Number((100 * group.onNowDetermined / group.recognized).toFixed(1)) : 0
    }))
    .sort((a,b) => b.recognized - a.recognized || a.key.localeCompare(b.key));
}

function publicCoverageSource(source) {
  if (!source) return null;
  return {
    sourceId:source.sourceId,
    sourceName:source.sourceName,
    authority:source.authority,
    coverageLevel:source.coverageLevel,
    freshness:source.freshness,
    status:source.status,
    currentRecordCount:Number(source.recordCount || 0),
    activeVersion:source.activeVersion,
    lastSuccessfulRefresh:source.lastSuccessfulFetch,
    freshUntil:source.freshUntil
  };
}

async function coverageResponse(request, env) {
  await ensureSchema(env);
  const [inventory, statuses, activeRows] = await Promise.all([
    loadCoverageInventory(request, env),
    sourceStatus(env),
    activeProgramRows(env)
  ]);
  const statusById = new Map(statuses.map((source) => [source.sourceId, source]));
  const rowsByStation = new Map();
  for (const row of activeRows) {
    const key = String(row.station_key || '');
    const list = rowsByStation.get(key) || [];
    list.push(row);
    rowsByStation.set(key, list);
  }

  const now = new Date();
  const matrix = (inventory.identities || []).map((identity) => {
    const stationKeys = new Set([normalizeStationKey(identity.stationServiceKey || identity.displayName)]);
    for (const language of identity.languages || []) {
      stationKeys.add(resolveProgramStationKey(identity.stationServiceKey || identity.displayName, language));
    }
    const sourceIds = [...new Set([...stationKeys].flatMap((key) => SOURCES_BY_STATION.get(key) || []))];
    const sources = sourceIds.map((id) => statusById.get(id)).filter(Boolean);
    const programSources = sources.filter((source) => source.coverageLevel !== 'service-only');
    const hasProgramSource = programSources.length > 0;
    const hasFreshProgramSource = programSources.some((source) => source.freshness === 'fresh' || source.freshness === 'degraded');
    const stationRows = [...stationKeys].flatMap((key) => rowsByStation.get(key) || []);
    const exactRows = stationRows.filter((row) => row.confidence !== 'official-block');
    let onNowCanBeDetermined = false;
    let onNowStatus = hasFreshProgramSource ? 'no-current-program-record' : (hasProgramSource ? 'stale-or-unpublished' : 'no-program-source');

    if (hasFreshProgramSource && exactRows.length) {
      for (const frequency of identity.frequenciesKHz || []) {
        const selection = selectProgramFromRecords(exactRows, now, frequency, now);
        if (selection.status === 'verified') {
          onNowCanBeDetermined = true;
          onNowStatus = 'verified';
          break;
        }
        if (selection.status === 'ambiguous') onNowStatus = 'ambiguous';
      }
    }

    return {
      stationServiceKey:identity.stationServiceKey,
      country:identity.country,
      region:identity.region,
      bands:identity.bands || [],
      knownFrequencyCount:Number(identity.knownFrequencyCount || 0),
      hasProgramSource,
      hasFreshProgramSource,
      sourceAuthority:programSources.map((source) => source.authority).filter(Boolean),
      sourceFreshness:programSources.map((source) => source.freshness).filter(Boolean),
      currentRecordCount:programSources.reduce((sum, source) => sum + Number(source.recordCount || 0), 0),
      activeCatalogVersion:programSources.map((source) => source.activeVersion).filter(Boolean),
      lastSuccessfulRefresh:programSources.map((source) => source.lastSuccessfulFetch).filter(Boolean),
      onNowCanBeDetermined,
      onNowStatus,
      programSources:programSources.map(publicCoverageSource),
      serviceOnlySources:sources.filter((source) => source.coverageLevel === 'service-only').map(publicCoverageSource)
    };
  });

  const recognized = matrix.length;
  const programCovered = matrix.filter((row) => row.hasProgramSource).length;
  const freshProgramSource = matrix.filter((row) => row.hasFreshProgramSource).length;
  const onNowDetermined = matrix.filter((row) => row.onNowCanBeDetermined).length;
  const url = new URL(request.url);
  const detail = url.searchParams.get('detail') === '1' || url.searchParams.get('detail') === 'full';

  const body = {
    generatedAt:new Date().toISOString(),
    inventoryGeneratedAt:inventory.generatedAt || null,
    summary:{
      recognizedBroadcasterServices:recognized,
      programCoveredBroadcasterServices:programCovered,
      freshProgramCoveredBroadcasterServices:freshProgramSource,
      onNowDeterminedBroadcasterServices:onNowDetermined,
      programCoveragePct:recognized ? Number((100 * programCovered / recognized).toFixed(1)) : 0,
      onNowCoveragePct:recognized ? Number((100 * onNowDetermined / recognized).toFixed(1)) : 0
    },
    byBand:summarizeCoverage(matrix, 'bands'),
    byRegion:summarizeCoverage(matrix, 'region'),
    byCountry:summarizeCoverage(matrix, 'country'),
    sourceHealth:statuses.map(publicCoverageSource),
    inventoryInputs:inventory.inputs || null,
    detailAvailable:'Append ?detail=1 for the full broadcaster/service matrix.'
  };
  if (detail) body.identities = matrix;
  return json(body);
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
      exactProgramSources:sources.filter((source) => source.coverageLevel !== 'service-only').length,
      serviceOnlySources:sources.filter((source) => source.coverageLevel === 'service-only').length,
      usableSources:usable,
      refreshDue:sources.filter((source) => source.refreshDue).length,
      refreshOverdue:sources.filter((source) => source.refreshOverdueMs > 0).length,
      staleOrExpired:sources.filter((source) => source.freshness === 'expired').length,
      neverPublished:sources.filter((source) => source.freshness === 'never-published').length,
      servingLastKnownGood:sources.filter((source) => source.servingLastKnownGood).length,
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
    if (url.pathname === '/api/program-guide' || url.pathname === '/api/program-guide/status' || url.pathname === '/api/program-guide/coverage') return json({ error:'Method not allowed' }, 405);
    return null;
  }

  if (url.pathname === '/api/program-guide/status') {
    const response = await statusResponse(request, env);
    return request.method === 'HEAD' ? new Response(null, { status:response.status, headers:response.headers }) : response;
  }
  if (url.pathname === '/api/program-guide/coverage') {
    const response = await coverageResponse(request, env);
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
    if (minute % 15 === 0) return refreshDueSources(env);
  }
  return [];
}

export { SOURCE_DEFINITIONS };
