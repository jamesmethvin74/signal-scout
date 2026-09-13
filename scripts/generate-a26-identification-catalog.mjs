import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const A26_COMMIT = '55076d0767a2ba4a6d46a71d98c66db624749797';
const COUNTRIES_COMMIT = 'db79dad685276dbf98ca44b875d1481bc240c5c1';
const SCHEDULE_URL = `https://raw.githubusercontent.com/Roger-Need/StationFinder/${A26_COMMIT}/Frequency%20Lists/Merged/A26%20merged_schedule.csv`;
const COUNTRIES_URL = `https://raw.githubusercontent.com/google/dspl/${COUNTRIES_COMMIT}/samples/google/canonical/countries.csv`;
const OUT_DIR = path.resolve('data/identification/a26');
const ALLOWED_SOURCES = new Set(['HFCC', 'EiBi']);
const UTILITY_RE = /\b(?:navy|naval|coast guard|uscg|radiofax|\bfax\b|hfdl|volmet|aeronautical|marine weather|maritime safety|rtty|teletype|sub comms|submarine)\b/i;

const SHARDS = [
  { id: '2300-4999', minKHz: 2300, maxKHz: 4999.999 },
  { id: '5000-7499', minKHz: 5000, maxKHz: 7499.999 },
  { id: '7500-11999', minKHz: 7500, maxKHz: 11999.999 },
  { id: '12000-15999', minKHz: 12000, maxKHz: 15999.999 },
  { id: '16000-21999', minKHz: 16000, maxKHz: 21999.999 },
  { id: '22000-30000', minKHz: 22000, maxKHz: 30000 }
];

const EIBI_LANGUAGES = {
  E: 'English', S: 'Spanish', F: 'French', G: 'German', R: 'Russian',
  P: 'Portuguese', A: 'Arabic', C: 'Chinese', J: 'Japanese', K: 'Korean',
  I: 'Italian', D: 'Dutch', PL: 'Polish', RO: 'Romanian', H: 'Hungarian',
  CZ: 'Czech', SK: 'Slovak', B: 'Bengali', HI: 'Hindi', UR: 'Urdu',
  PE: 'Persian', TU: 'Turkish', SW: 'Swahili', HA: 'Hausa', AF: 'Afrikaans',
  AM: 'Amharic', TI: 'Tigrinya', TH: 'Thai', VN: 'Vietnamese', IN: 'Indonesian',
  MS: 'Malay', TL: 'Tagalog', UK: 'Ukrainian', BU: 'Bulgarian', SR: 'Serbian',
  HR: 'Croatian', GR: 'Greek', HE: 'Hebrew', DA: 'Danish', NO: 'Norwegian',
  SV: 'Swedish', FI: 'Finnish'
};

const STATION_ALIASES = new Map([
  ['allan h. weiner', 'WBCQ'],
  ['wnqm, inc.', 'WWCR'],
  ['radio miami international', 'WRMI'],
  ['eternal word television network', 'WEWN'],
  ['british broadcasting corporation', 'BBC World Service'],
  ['bbc worldservice', 'BBC World Service'],
  ['bbc world service', 'BBC World Service'],
  ['radio new zealand international', 'RNZ Pacific'],
  ['radio new zealand', 'RNZ Pacific'],
  ['radio romania international', 'Radio Romania International'],
  ['china radio international', 'China Radio International']
]);

function parseCsvLine(line) {
  const out = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      out.push(value);
      value = '';
    } else {
      value += ch;
    }
  }
  out.push(value);
  return out;
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function friendlyStation(name) {
  const clean = String(name || '').trim();
  return STATION_ALIASES.get(clean.toLowerCase()) || clean;
}

function decodeLanguage(language, source) {
  const clean = String(language || '').trim();
  if (!clean) return 'Unknown';
  if (source === 'EiBi') return EIBI_LANGUAGES[clean] || clean;
  return clean;
}

function parseSchedule(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error('A26 schedule is empty');
  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  const idx = Object.fromEntries(headers.map((header, i) => [header, i]));
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const get = (name) => String(cols[idx[name]] ?? '').trim();
    return {
      frequencyHz: Number(get('Frequency')),
      mode: get('M') || get('Mode') || 'AM',
      station: get('Station'),
      on: get('On'),
      off: get('Off'),
      language: get('Language'),
      site: get('Site'),
      txCountry: get('TX Country'),
      days: get('Days'),
      target: get('Target'),
      power: get('Power'),
      azimuth: get('Azimuth'),
      origin: get('Origin'),
      source: get('Source')
    };
  });
}

function parseCountries(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const headers = parseCsvLine(lines[0]);
  const idx = Object.fromEntries(headers.map((header, i) => [header.trim(), i]));
  const byName = new Map();
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const name = String(cols[idx.name] || '').trim();
    const lat = Number(cols[idx.latitude]);
    const lon = Number(cols[idx.longitude]);
    if (name && Number.isFinite(lat) && Number.isFinite(lon)) byName.set(normalize(name), { lat, lon });
  }
  return byName;
}

function countryAlias(name) {
  const clean = normalize(name);
  const aliases = {
    'united states of america': 'united states',
    usa: 'united states',
    'u s a': 'united states',
    uk: 'united kingdom',
    'great britain': 'united kingdom',
    'russian federation': 'russia',
    'south korea': 'korea south',
    'north korea': 'korea north',
    'viet nam': 'vietnam',
    'czech republic': 'czechia',
    swaziland: 'eswatini',
    'ivory coast': 'cote d ivoire'
  };
  return aliases[clean] || clean;
}

function centroidFor(row, countries) {
  for (const value of [row.txCountry, row.origin]) {
    const key = countryAlias(value);
    if (key && countries.has(key)) return countries.get(key);
  }
  return null;
}

function isBroadcastCandidate(row) {
  if (!ALLOWED_SOURCES.has(row.source)) return false;
  if (!Number.isFinite(row.frequencyHz) || row.frequencyHz < 2300000 || row.frequencyHz > 30000000) return false;
  if (!row.station || !row.on || !row.off) return false;
  if (UTILITY_RE.test(row.station)) return false;
  if (row.source === 'EiBi' && String(row.language || '').startsWith('-')) return false;
  return true;
}

function groupKey(row) {
  return [
    Math.round(row.frequencyHz),
    row.on,
    row.off,
    countryAlias(row.origin || row.txCountry),
    normalize(row.mode || 'AM')
  ].join('|');
}

function chooseDisplayRow(rows) {
  return rows.find((row) => row.source === 'EiBi') || rows.find((row) => row.source === 'HFCC') || rows[0];
}

function chooseTechnicalRow(rows) {
  return rows.find((row) => row.source === 'HFCC' && (row.power || row.site || row.txCountry))
    || rows.find((row) => row.source === 'HFCC')
    || rows[0];
}

function formatType(mode, stationName) {
  const upperMode = String(mode || 'AM').toUpperCase();
  if (upperMode.includes('DRM')) return 'DRM digital broadcast';
  if (/bbc|radio romania|radio exterior|radio new zealand|rnz|voice of|china radio|nhk|nippon hoso/i.test(stationName)) return 'International broadcast';
  if (/adventist|eternal word|wewn|relig|gospel|bible|ministry|ministries|overcomer/i.test(stationName)) return 'Religious / international';
  return upperMode === 'AM' ? 'Shortwave broadcast' : `${upperMode} broadcast`;
}

function categoriesFor(name, format) {
  const text = `${name} ${format}`.toLowerCase();
  const categories = ['shortwave', 'broadcast'];
  if (/international|world service|worldservice|pacific|radio exterior|radio romania|china radio|voice of|usagm|nhk|kbs world/.test(text)) categories.push('international');
  if (/news|world service|worldservice|usagm|voice of america|radio free|radio liberty/.test(text)) categories.push('news');
  if (/adventist|eternal word|wewn|relig|gospel|bible|ministry|ministries|overcomer|vatican/.test(text)) categories.push('religious');
  if (/sport/.test(text)) categories.push('sports');
  if (/bbc world|radio romania international|rnz pacific|radio exterior|china radio international|voice of america|radio france internationale|deutsche welle/.test(text)) categories.push('state-broadcaster');
  return [...new Set(categories)];
}

function buildEntries(rows, countries) {
  const groups = new Map();
  rows.filter(isBroadcastCandidate).forEach((row) => {
    const key = groupKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });

  const entries = [];
  for (const groupedRows of groups.values()) {
    const display = chooseDisplayRow(groupedRows);
    const technical = chooseTechnicalRow(groupedRows);
    const frequencyKHz = technical.frequencyHz / 1000;
    const name = friendlyStation(display.station || technical.station);
    const coordinate = centroidFor(technical, countries) || centroidFor(display, countries);
    const languageRow = groupedRows.find((row) => row.source === 'HFCC' && row.language && row.language.length > 2) || display;
    const language = decodeLanguage(languageRow.language, languageRow.source);
    const sources = [...new Set(groupedRows.map((row) => row.source))].sort();
    const transmitter = technical.site || display.site || technical.txCountry || display.txCountry || technical.origin || display.origin || 'Site not listed';
    const country = technical.txCountry || display.txCountry || technical.origin || display.origin || 'Unknown';
    const powerKW = Number(technical.power);
    const mode = String(technical.mode || display.mode || 'AM').toUpperCase();
    const format = formatType(mode, name);
    const target = display.target || technical.target || '';
    const callsign = /^[A-Z0-9]{3,6}$/.test(name) ? name : '';

    entries.push({
      type: 'station',
      band: 'SW',
      frequencyKHz,
      ...(callsign ? { callsign } : {}),
      name,
      country,
      transmitter,
      ...(coordinate ? { lat: coordinate.lat, lon: coordinate.lon, locationApproximate: true } : {}),
      mode,
      language,
      categories: categoriesFor(name, format),
      description: target ? `${format}. Target: ${target}.` : `${format}.`,
      ...(Number.isFinite(powerKW) && powerKW > 0 ? { powerW: powerKW * 1000 } : {}),
      start: String(display.on || technical.on).padStart(4, '0'),
      end: String(display.off || technical.off).padStart(4, '0'),
      days: technical.days || display.days || '1234567',
      target,
      origin: display.origin || technical.origin || '',
      source: sources.join(' + '),
      season: 'A26',
      sourceCommit: A26_COMMIT
    });
  }

  return entries.sort((a, b) => a.frequencyKHz - b.frequencyKHz || a.start.localeCompare(b.start) || a.name.localeCompare(b.name));
}

async function fetchText(url, label) {
  const response = await fetch(url, { headers: { 'user-agent': 'FREQBEACON-static-catalog-builder/1.0' } });
  if (!response.ok) throw new Error(`${label} fetch failed: ${response.status} ${response.statusText}`);
  return response.text();
}

async function main() {
  const [scheduleText, countriesText] = await Promise.all([
    fetchText(SCHEDULE_URL, 'A26 schedule'),
    fetchText(COUNTRIES_URL, 'country centroids')
  ]);

  const parsedRows = parseSchedule(scheduleText);
  const entries = buildEntries(parsedRows, parseCountries(countriesText));
  if (entries.length < 500) throw new Error(`Refusing to publish incomplete A26 catalog: only ${entries.length} normalized entries`);

  await mkdir(OUT_DIR, { recursive: true });
  const shardManifest = [];
  let written = 0;

  for (const shard of SHARDS) {
    const shardEntries = entries.filter((entry) => entry.frequencyKHz >= shard.minKHz && entry.frequencyKHz <= shard.maxKHz);
    const payload = {
      version: 1,
      season: 'A26',
      sourceCommit: A26_COMMIT,
      minKHz: shard.minKHz,
      maxKHz: shard.maxKHz,
      count: shardEntries.length,
      entries: shardEntries
    };
    const fileName = `sw-${shard.id}.json`;
    await writeFile(path.join(OUT_DIR, fileName), JSON.stringify(payload), 'utf8');
    shardManifest.push({ id: shard.id, path: `/data/identification/a26/${fileName}`, minKHz: shard.minKHz, maxKHz: shard.maxKHz, count: shardEntries.length });
    written += shardEntries.length;
  }

  if (written !== entries.length) throw new Error(`Shard count mismatch: ${written} of ${entries.length} entries written`);

  const manifest = {
    version: 1,
    season: 'A26',
    source: 'HFCC + EiBi A26 merged schedule',
    sourceRepository: 'Roger-Need/StationFinder',
    sourceCommit: A26_COMMIT,
    countryCoordinateSource: 'google/dspl samples/google/canonical/countries.csv',
    countryCoordinateCommit: COUNTRIES_COMMIT,
    coordinates: 'Transmitter-country centroids unless a curated runtime station entry supplies a precise site coordinate.',
    count: entries.length,
    shards: shardManifest
  };
  await writeFile(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`FREQBEACON A26 catalog: ${entries.length} normalized HFCC/EiBi entries written across ${SHARDS.length} static shards.`);
  for (const shard of shardManifest) console.log(`  ${shard.id}: ${shard.count}`);
}

main().catch((error) => {
  console.error(`FREQBEACON A26 catalog generation failed: ${error?.stack || error}`);
  process.exitCode = 1;
});
