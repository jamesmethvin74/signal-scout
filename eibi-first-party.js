// EiBi daily shortwave schedule cache. This module fetches ONLY the publisher's
// files, server-side, and verifies its current README reuse terms before ingest.
const ORIGIN = 'http://www.eibispace.de/dx/';
const README = ORIGIN + 'README.TXT';
const MAX_BYTES = 5_000_000;
const MIN_ROWS = 2_000;
const RETRY_MS = 3 * 60 * 60 * 1000;
const FRESH_MS = 24 * 60 * 60 * 1000;
const KEEP_MS = 72 * 60 * 60 * 1000;

export function lastSundayUTC(year, month) {
  const last = new Date(Date.UTC(year, month + 1, 0));
  return last.getUTCDate() - last.getUTCDay();
}

export function eibiSeason(at = new Date()) {
  const year = at.getUTCFullYear();
  const month = at.getUTCMonth();
  const day = at.getUTCDate();
  const summer = (month > 2 && month < 9)
    || (month === 2 && day >= lastSundayUTC(year, 2))
    || (month === 9 && day < lastSundayUTC(year, 9));
  const seasonYear = !summer && month < 2 ? year - 1 : year;
  return (summer ? 'a' : 'b') + String(seasonYear).slice(-2);
}

export function termsAllowUse(readme) {
  const s = String(readme || '').toLowerCase().replace(/\s+/g, ' ');
  return s.includes('frequency lists')
    && /free of charge|absolutely free/.test(s)
    && /download/.test(s)
    && /copy/.test(s)
    && /distribut/.test(s)
    && /third.party software/.test(s);
}

function parseCsvLine(line) {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (char === ';' && !quoted) { fields.push(value.trim()); value = ''; }
    else value += char;
  }
  fields.push(value.trim());
  return fields;
}

export function parseEiBi(csv) {
  if (typeof csv !== 'string' || csv.length > MAX_BYTES) throw new Error('EiBi source exceeded size limit');
  const entries = [];
  for (const line of csv.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line || !line.includes(';')) continue;
    const row = parseCsvLine(line);
    if (row.length < 7) continue;
    const freq = Number(row[0].replace(',', '.'));
    const time = /^([0-2]\d[0-5]\d)-([0-2]\d[0-5]\d)$/.exec(row[1]);
    if (!Number.isFinite(freq) || freq < 2300 || freq > 30000 || !time) continue;
    const start = time[1], end = time[2];
    if (Number(start.slice(0, 2)) > 23 || Number(end.slice(0, 2)) > 24
      || (end.startsWith('24') && end !== '2400')) continue;
    const name = String(row[4] || '').trim();
    if (!name || name.length > 160) continue;
    const lang = String(row[5] || '').trim();
    entries.push({
      frequencyKHz: freq, start, end,
      days: String(row[2] || '').trim().slice(0, 40),
      itu: String(row[3] || '').trim().slice(0, 12),
      name,
      language: lang.slice(0, 20),
      target: String(row[6] || '').trim().slice(0, 40),
      remarks: String(row.slice(7).join(';') || '').trim().slice(0, 120),
      type: lang.startsWith('-') ? 'service' : 'station'
    });
  }
  return entries;
}

function hhmm(s) { return Number(s.slice(0, 2)) * 60 + Number(s.slice(2)); }
const DAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
function activeDay(raw, date) {
  const days = String(raw || '').trim();
  if (!days || days === '1234567' || days === 'Mo-Su' || days === 'MoSu') return true;
  const today = date.getUTCDay(); // 0=Sunday
  if (/^[1-7]+$/.test(days)) return days.includes(String(today === 0 ? 7 : today)); // EiBi 1=Mon
  if (/^(irr|var|alt|irregular|daily\?)$/i.test(days)) return null;
  const d = days.replace(/\s+/g, '');
  const t = DAY_ABBR[today];
  if (/^(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:[,\/]?(?:Mo|Tu|We|Th|Fr|Sa|Su))*$/i.test(d)) {
    return d.toLowerCase().includes(t.toLowerCase());
  }
  const match = /^(Mo|Tu|We|Th|Fr|Sa|Su)-(Mo|Tu|We|Th|Fr|Sa|Su)$/i.exec(d);
  if (match) {
    const a = DAY_ABBR.findIndex(x => x.toLowerCase() === match[1].toLowerCase());
    const b = DAY_ABBR.findIndex(x => x.toLowerCase() === match[2].toLowerCase());
    return a <= b ? today >= a && today <= b : today >= a || today <= b;
  }
  return null; // unknown date/weekday notation is NOT assumed daily
}

export function scheduleActive(entry, at = new Date()) {
  const min = at.getUTCHours() * 60 + at.getUTCMinutes();
  const start = hhmm(entry.start), end = hhmm(entry.end);
  const yesterday = new Date(at.getTime() - 86400000);
  let date = at;
  let inWindow;
  if (end === 1440) inWindow = min >= start;
  else if (start < end) inWindow = min >= start && min < end;
  else if (start > end) {
    inWindow = min >= start || min < end;
    if (min < end) date = yesterday;
  } else inWindow = true; // equal times denote continuous transmission
  if (!inWindow) return false;
  return activeDay(entry.days, date);
}

async function schema(db) {
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS freqbeacon_eibi_meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS freqbeacon_eibi_frequency (snapshot TEXT NOT NULL, frequency REAL NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(snapshot, frequency))'),
    db.prepare('CREATE INDEX IF NOT EXISTS freqbeacon_eibi_freq_idx ON freqbeacon_eibi_frequency(snapshot, frequency)')
  ]);
}
async function metaValue(db, name) {
  const result = await db.prepare('SELECT value FROM freqbeacon_eibi_meta WHERE name = ?').bind(name).first();
  return result?.value || null;
}
async function writeMeta(db, name, value) {
  await db.prepare('INSERT INTO freqbeacon_eibi_meta(name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').bind(name, String(value)).run();
}
async function publisherText(url, maxBytes) {
  const r = await fetch(url, {headers: {accept:'text/plain,text/csv,*/*'}, redirect:'follow',
    signal: AbortSignal.timeout(15000)});
  if (!r.ok) throw new Error('EiBi publisher HTTP ' + r.status);
  const size = Number(r.headers.get('content-length'));
  if (size > maxBytes) throw new Error('EiBi source too large');
  const data = await r.text();
  if (data.length > maxBytes) throw new Error('EiBi source too large');
  return data;
}
async function checksum(text) {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(data), b => b.toString(16).padStart(2, '0')).join('');
}
function frequencyGroups(rows) {
  const result = new Map();
  for (const row of rows) {
    const list = result.get(row.frequencyKHz) || [];
    list.push(row);
    result.set(row.frequencyKHz, list);
  }
  return [...result].sort((a, b) => a[0] - b[0]);
}

// Run no more than daily on success; on failure, back off for >=3h.
// All writes stage under a new snapshot; the active pointer flips last.
export async function refreshEiBiIfDue(env, now = new Date()) {
  const db = env?.RECEIVER_HEALTH_DB;
  if (!db) return {status:'no-database'};
  await schema(db);
  const season = eibiSeason(now);
  const priorRaw = await metaValue(db, 'active');
  const prior = priorRaw ? JSON.parse(priorRaw) : null;
  if (prior && prior.season === season.toUpperCase() && now.getTime() - prior.updatedAt < FRESH_MS) {
    return {status:'fresh', ...prior};
  }
  // Atomic attempt lease blocks duplicate updates from concurrent HTTP requests.
  const lease = await db.prepare(
    "INSERT INTO freqbeacon_eibi_meta(name,value) VALUES('attempt',?) ON CONFLICT(name) DO UPDATE SET value=excluded.value WHERE CAST(freqbeacon_eibi_meta.value AS INTEGER) < ?"
  ).bind(String(now.getTime()), String(now.getTime() - RETRY_MS)).run();
  if (!lease.meta?.changes) return {status:'backoff'};

  try {
    const readme = await publisherText(README, 350000);
    if (!termsAllowUse(readme)) throw new Error('Publisher README did not verify third-party reuse permission');
    const csvUrl = ORIGIN + 'sked-' + season + '.csv';
    const csv = await publisherText(csvUrl, MAX_BYTES);
    const rows = parseEiBi(csv);
    const groups = frequencyGroups(rows);
    if (rows.length < MIN_ROWS || groups.length < 300) {
      throw new Error('Incomplete EiBi ' + season + ' data: ' + rows.length + ' rows on ' + groups.length + ' frequencies');
    }
    const hash = await checksum(csv);
    const snapshot = season + '-' + hash.slice(0, 20);
    // Upsert the staging snapshot in small batches to respect D1 binding limits.
    for (let offset = 0; offset < groups.length; offset += 35) {
      const chunk = groups.slice(offset, offset + 35);
      const placeholders = chunk.map(() => '(?,?,?)').join(',');
      const values = chunk.flatMap(([frequency, entries]) => [snapshot, frequency, JSON.stringify(entries)]);
      await db.prepare('INSERT OR REPLACE INTO freqbeacon_eibi_frequency(snapshot,frequency,payload) VALUES ' + placeholders)
        .bind(...values).run();
    }
    const details = {
      season: season.toUpperCase(), snapshot, updatedAt: now.getTime(), rowCount: rows.length,
      frequencyCount: groups.length, sha256: hash, source: csvUrl, terms: README,
      attribution:'EiBi shortwave schedules by Eike Bierwirth'
    };
    await writeMeta(db, 'active', JSON.stringify(details));
    await db.prepare('DELETE FROM freqbeacon_eibi_frequency WHERE snapshot <> ?').bind(snapshot).run();
    return {status:'updated', ...details};
  } catch (error) {
    // Never replace last known-good data with an error, HTML, or a partial file.
    console.warn('FREQBEACON EiBi refresh skipped:', String(error?.message || error));
    return {status:'failed', reason:String(error?.message || error)};
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {status,
    headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
      'x-content-type-options':'nosniff'}});
}

export async function eibiResponse(request, env) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({status:'error'},405);
  const url = new URL(request.url);
  const db = env?.RECEIVER_HEALTH_DB;
  if (!db) return json({status:'unavailable',reason:'cache not configured'},503);
  await schema(db);
  const raw = await metaValue(db, 'active');
  const info = raw ? JSON.parse(raw) : null;
  const now = new Date();
  const current = info?.season === eibiSeason(now).toUpperCase()
    && now.getTime() - info.updatedAt < KEEP_MS;
  if (url.pathname === '/api/eibi/status') return json({
    status:current?'ready':'unavailable',season:info?.season||null,updatedAt:info?.updatedAt||null,
    rowCount:info?.rowCount||0,source:info?.source||null,attribution:info?.attribution||null,
    currentSeason:eibiSeason(now).toUpperCase()
  });
  const frequency = Number(url.searchParams.get('frequency'));
  const atText = url.searchParams.get('at');
  const at = atText ? new Date(atText) : now;
  if (!Number.isFinite(frequency) || frequency < 2300 || frequency > 30000
    || !Number.isFinite(at.getTime()) || Math.abs(at.getTime()-now.getTime()) > 45*86400000) {
    return json({status:'error',message:'Invalid EiBi frequency/time'},400);
  }
  if (!current) return json({status:'unavailable',frequencyKHz:frequency,matches:[]});
  const result = await db.prepare('SELECT payload FROM freqbeacon_eibi_frequency WHERE snapshot = ? AND frequency BETWEEN ? AND ? LIMIT 12')
    .bind(info.snapshot, frequency - 2.5, frequency + 2.5).all();
  const matches = (result.results || []).flatMap(r => JSON.parse(r.payload)).map(e => ({
    ...e,active:scheduleActive(e,at)
  })).sort((a,b) =>
    Math.abs(a.frequencyKHz-frequency)-Math.abs(b.frequencyKHz-frequency)
    || (b.active===true?1:b.active===false?-1:0) - (a.active===true?1:a.active===false?-1:0)
  ).slice(0,60);
  return json({status:'ok',season:info.season,updatedAt:info.updatedAt,
    attribution:info.attribution,frequencyKHz:frequency,matches});
}