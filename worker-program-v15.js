import baseWorker from './worker-program-v14.js';

const AOKI_CSV = 'https://ndxc.info/wordpress/wp-content/uploads/freqdb/sked.csv';
const AOKI_PAGE = 'https://ndxc.info/freqdb/';
const AOKI_TTL = 2 * 60 * 60;
const LAST_GOOD_SECONDS = 7 * 24 * 60 * 60;
let aokiPromise = null;

const LANGUAGE_ALIASES = new Map([
  ['eng','english'],['en','english'],['spa','spanish'],['sp','spanish'],['esp','spanish'],
  ['fre','french'],['fra','french'],['fr','french'],['ger','german'],['deu','german'],
  ['por','portuguese'],['pt','portuguese'],['ara','arabic'],['ar','arabic'],
  ['rus','russian'],['ru','russian'],['chi','chinese'],['zho','chinese'],['chn','chinese'],
  ['jpn','japanese'],['kor','korean'],['rom','romanian'],['ron','romanian'],
  ['ita','italian'],['dut','dutch'],['nld','dutch'],['pol','polish'],
  ['hin','hindi'],['urd','urdu'],['per','persian'],['fas','persian'],['far','persian'],
  ['tur','turkish'],['swa','swahili'],['hau','hausa'],['tha','thai'],['vie','vietnamese'],
  ['ind','indonesian'],['msa','malay'],['ukr','ukrainian'],['bul','bulgarian'],
  ['srp','serbian'],['hrv','croatian'],['ell','greek'],['gre','greek'],['heb','hebrew']
]);

function json(data,status=200) {
  return new Response(JSON.stringify(data),{
    status,
    headers:{'content-type':'application/json; charset=utf-8','cache-control':'public, max-age=60'}
  });
}

async function responseJson(response) {
  const type = String(response?.headers?.get('content-type') || '');
  if (!type.includes('application/json')) return null;
  try { return await response.clone().json(); } catch { return null; }
}

function requestParts(request) {
  const url = new URL(request.url);
  const station = String(url.searchParams.get('station') || '').trim();
  const frequency = Number(url.searchParams.get('frequency'));
  const at = url.searchParams.get('at') ? new Date(url.searchParams.get('at')) : new Date();
  const language = String(url.searchParams.get('language') || '').trim();
  let tz = url.searchParams.get('tz') || 'UTC';
  try { new Intl.DateTimeFormat('en-US',{timeZone:tz}).format(at); }
  catch { tz='UTC'; }
  return {url,station,frequency,at,language,tz};
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

function languageName(value) {
  const clean = normalize(value);
  if (!clean) return '';
  const first = clean.split(/\s+/)[0];
  return LANGUAGE_ALIASES.get(first) || clean;
}

function requestedLanguages(value) {
  return String(value || '').split(/[\/,+]/).map(languageName).filter(Boolean);
}

function clock(value) {
  const clean = String(value || '').replace(/[^0-9]/g,'').padStart(4,'0');
  if (!/^\d{4}$/.test(clean)) return null;
  const hour = Number(clean.slice(0,2));
  const minute = Number(clean.slice(2));
  if (hour===24 && minute===0) return 1440;
  if (hour>23 || minute>59) return null;
  return hour*60+minute;
}

function parseRange(value) {
  const match = String(value || '').trim().match(/(\d{4})\s*[-–]\s*(\d{4})/);
  if (!match) return null;
  const start=clock(match[1]);
  const end=clock(match[2]);
  if (start==null || end==null) return null;
  return {start,end};
}

function aokiDayActive(code,at) {
  const raw=String(code || '').trim();
  if (!raw) return true;
  const day=at.getUTCDay()+1; // AOKI convention: 1=Sunday ... 7=Saturday.
  if (/^[.1-7]{7}$/.test(raw)) return raw[day-1]!=='.';
  if (/^[1-7]+$/.test(raw)) return raw.includes(String(day));
  const ranges=[...raw.matchAll(/([1-7])\s*-\s*([1-7])/g)];
  for (const match of ranges) {
    let cursor=Number(match[1]);
    const end=Number(match[2]);
    for (let i=0;i<7;i+=1) {
      if (cursor===day) return true;
      if (cursor===end) break;
      cursor=cursor===7?1:cursor+1;
    }
  }
  const digits=raw.match(/[1-7]/g) || [];
  return digits.length ? digits.includes(String(day)) : true;
}

function activeTime(range,at) {
  const now=at.getUTCHours()*60+at.getUTCMinutes();
  if (range.end===1440) return range.start<=now;
  if (range.end>range.start) return range.start<=now && now<range.end;
  return now>=range.start || now<range.end;
}

function occurrence(range,at) {
  const dayStart=Date.UTC(at.getUTCFullYear(),at.getUTCMonth(),at.getUTCDate());
  const now=at.getUTCHours()*60+at.getUTCMinutes();
  let startDay=dayStart;
  let endMinute=range.end;
  if (range.end<=range.start && range.end!==1440) {
    endMinute+=1440;
    if (now<range.end) startDay-=86400000;
  }
  const start=new Date(startDay+range.start*60000);
  const end=range.end===1440
    ? new Date(startDay+86400000)
    : new Date(startDay+endMinute*60000);
  return {start,end};
}

function parseAoki(text) {
  const rows=[];
  for (const rawLine of String(text || '').replace(/^\uFEFF/,'').split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const cells=rawLine.split(';').map((value)=>value.trim());
    if (cells.length<5) continue;
    const frequency=Number(String(cells[0]).replace(',','.'));
    const range=parseRange(cells[1]);
    const days=cells[2] || '';
    const country=cells[3] || '';
    const station=cells[4] || '';
    const language=cells[5] || '';
    const transmitter=cells[7] || cells[6] || '';
    if (!Number.isFinite(frequency) || frequency<2300 || frequency>30000 || !range || !station) continue;
    rows.push({frequency,range,days,country,station,language,transmitter});
  }
  return rows;
}

async function fetchAoki({force=false}={}) {
  if (aokiPromise && !force) return aokiPromise;
  const job=(async()=>{
    const cache=caches.default;
    const freshKey=new Request('https://freqbeacon-cache.invalid/aoki-a26/fresh');
    const staleKey=new Request('https://freqbeacon-cache.invalid/aoki-a26/last-good');
    if (!force) {
      const fresh=await cache.match(freshKey);
      if (fresh) return {text:await fresh.text(),stale:false,fetchedAt:fresh.headers.get('x-fetched-at')};
    }
    try {
      const response=await fetch(AOKI_CSV,{
        headers:{Accept:'text/csv,text/plain;q=0.9,*/*;q=0.5','User-Agent':'FREQBEACON/1.0 schedule identification'},
        cf:{cacheTtl:1800,cacheEverything:true}
      });
      if (!response.ok) throw new Error(`AOKI HTTP ${response.status}`);
      const text=await response.text();
      if (text.length<10000) throw new Error('AOKI schedule download was unexpectedly short');
      const fetchedAt=new Date().toISOString();
      await Promise.all([
        cache.put(freshKey,new Response(text,{headers:{'cache-control':`public, max-age=${AOKI_TTL}`,'x-fetched-at':fetchedAt}})),
        cache.put(staleKey,new Response(text,{headers:{'cache-control':`public, max-age=${LAST_GOOD_SECONDS}`,'x-fetched-at':fetchedAt}}))
      ]);
      return {text,stale:false,fetchedAt};
    } catch (error) {
      const stale=await cache.match(staleKey);
      if (stale) return {text:await stale.text(),stale:true,fetchedAt:stale.headers.get('x-fetched-at'),error:String(error?.message || error)};
      throw error;
    }
  })();
  if (!force) aokiPromise=job.finally(()=>{aokiPromise=null;});
  return job;
}

function umbrellaMatch(card,candidate) {
  const a=normalize(card);
  const b=normalize(candidate);
  if (/united states agency for global media|\busagm\b/.test(a)) {
    return /voice of america|\bvoa\b|radio marti|marti|radio farda|radio free asia|\brfa\b|radio sawa/.test(b);
  }
  if (/british broadcasting corporation/.test(a)) return /bbc/.test(b);
  if (/eternal word television network/.test(a)) return /wewn|ewtn/.test(b);
  if (/allan h weiner/.test(a)) return /wbcq/.test(b);
  if (/wnqm/.test(a)) return /wwcr/.test(b);
  return false;
}

function stationScore(card,candidate) {
  const a=normalize(card);
  const b=normalize(candidate);
  if (!a || !b) return 0;
  if (a===b) return 30;
  if (b.startsWith(`${a} `) || b.includes(` ${a} `) || b.endsWith(` ${a}`)) return 28;
  if (a.startsWith(`${b} `) || a.includes(` ${b} `) || a.endsWith(` ${b}`)) return 24;
  if (umbrellaMatch(card,candidate)) return 22;
  const aTokens=new Set(a.split(' ').filter((token)=>token.length>=3));
  const bTokens=new Set(b.split(' ').filter((token)=>token.length>=3));
  let overlap=0;
  for (const token of aTokens) if (bTokens.has(token)) overlap+=1;
  return overlap*3;
}

function languageScore(requested,candidate) {
  const wanted=requestedLanguages(requested);
  if (!wanted.length) return 0;
  const have=languageName(candidate);
  if (!have) return 0;
  if (wanted.some((item)=>have.includes(item) || item.includes(have))) return 4;
  return -1;
}

function formatWindow(start,end,timeZone) {
  try {
    const fmt=new Intl.DateTimeFormat('en-US',{timeZone,hour:'numeric',minute:'2-digit',hour12:true});
    const zone=new Intl.DateTimeFormat('en-US',{timeZone,timeZoneName:'short'})
      .formatToParts(start).find((part)=>part.type==='timeZoneName')?.value || '';
    return `${fmt.format(start)}–${fmt.format(end)}${zone?` ${zone}`:''}`;
  } catch {
    return `${start.toISOString().slice(11,16)}–${end.toISOString().slice(11,16)} UTC`;
  }
}

function specificity(card,candidate) {
  const a=normalize(card);
  const b=normalize(candidate);
  if (!a || !b || a===b) return false;
  return b.includes(a) || umbrellaMatch(card,candidate);
}

async function resolveAoki(parts) {
  if (!Number.isFinite(parts.frequency) || Number.isNaN(parts.at.getTime())) return null;
  let snapshot;
  try { snapshot=await fetchAoki(); } catch { return null; }
  const rows=parseAoki(snapshot.text).filter((row)=>
    Math.abs(row.frequency-parts.frequency)<0.6 && aokiDayActive(row.days,parts.at) && activeTime(row.range,parts.at)
  );
  if (!rows.length) return null;

  const ranked=rows.map((row)=>({
    row,
    score:stationScore(parts.station,row.station)+languageScore(parts.language,row.language)
  })).sort((a,b)=>b.score-a.score);

  const top=ranked[0];
  if (!top) return null;
  const sameTop=ranked.filter((item)=>item.score===top.score);
  const distinct=[...new Set(sameTop.map((item)=>normalize(item.row.station)))];
  const languageCompatible=languageScore(parts.language,top.row.language)>=0;

  // Exact frequency + active UTC slot + language is still strong evidence when
  // HFCC used an umbrella/owner name that does not resemble the actual service.
  if (top.score<6 && !(rows.length===1 && languageCompatible)) return null;
  if (distinct.length>1 && top.score<20) {
    return {
      station:parts.station,frequency:parts.frequency,at:parts.at.toISOString(),
      status:'ambiguous',verified:false,
      candidates:sameTop.slice(0,5).map((item)=>item.row.station),
      message:'The current AOKI schedule has more than one plausible service on this frequency and time, so FREQBEACON will not guess.',
      sourceUrl:AOKI_PAGE,sourceLabel:'AOKI/NDXC current shortwave schedule'
    };
  }

  const chosen=top.row;
  const {start,end}=occurrence(chosen.range,parts.at);
  const moreSpecific=specificity(parts.station,chosen.station);
  const label=moreSpecific ? chosen.station : chosen.station;
  return {
    station:parts.station,frequency:parts.frequency,at:parts.at.toISOString(),
    status:'broadcast',verified:false,confidence:'schedule-match',
    program:label,
    window:formatWindow(start,end,parts.tz),
    start:start.toISOString(),end:end.toISOString(),next:null,
    message:moreSpecific
      ? 'AOKI/NDXC identifies this specific service or program on the frequency at this UTC time. Official broadcaster program data was not available for this card.'
      : 'AOKI/NDXC confirms this service on the frequency at this UTC time. A more specific broadcaster show title is not currently available.',
    sourceUrl:AOKI_PAGE,
    sourceLabel:`AOKI/NDXC current schedule${snapshot.stale?' · last known good':''}`,
    source:{id:'aoki',authority:'community-schedule',fetchedAt:snapshot.fetchedAt || null,refresh:'automatic',stale:Boolean(snapshot.stale)}
  };
}

function injectLabels(response) {
  const type=String(response.headers.get('content-type') || '');
  if (!type.includes('text/html')) return response;
  return response.text().then((html)=>{
    if (!html.includes('program-guide-source-labels.js')) {
      html=html.replace('</body>','  <script src="program-guide-source-labels.js?v=1"></script>\n</body>');
    }
    const headers=new Headers(response.headers);
    headers.set('content-type','text/html; charset=utf-8');
    headers.set('cache-control','no-store, max-age=0');
    headers.set('x-freqbeacon-aoki-fallback','v1');
    return new Response(html,{status:response.status,statusText:response.statusText,headers});
  });
}

export default {
  async fetch(request,env,ctx) {
    const url=new URL(request.url);
    if (url.pathname==='/api/program-guide') {
      let baseResponse;
      let baseData=null;
      try {
        baseResponse=await baseWorker.fetch(request,env,ctx);
        baseData=await responseJson(baseResponse);
      } catch {}
      if (baseData && ['verified','broadcast','ambiguous'].includes(baseData.status)) return baseResponse;
      const aoki=await resolveAoki(requestParts(request));
      if (aoki) return json(aoki);
      if (baseResponse) return baseResponse;
      return json(baseData || {status:'unsupported',verified:false},503);
    }

    const response=await baseWorker.fetch(request,env,ctx);
    if (request.method==='GET' && (url.pathname==='/' || url.pathname==='/index.html')) return injectLabels(response);
    return response;
  },

  async scheduled(event,env,ctx) {
    if (typeof baseWorker.scheduled==='function') baseWorker.scheduled(event,env,ctx);
    ctx?.waitUntil?.(fetchAoki({force:true}).catch(()=>null));
  }
};
