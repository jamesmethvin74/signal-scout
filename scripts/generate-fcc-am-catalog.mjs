import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SNAPSHOT_COMMIT = '847a35644f5a7c9ba49b0d9b5af96e178eaaf2e0';
const SNAPSHOT_URL = `https://raw.githubusercontent.com/kami-roga/Smalltalk25/${SNAPSHOT_COMMIT}/!Radio/radio-copy.csv`;
const OUT_PATH = path.resolve('freqbeacon-zero-us-am-fcc.js');
const MIN_EXPECTED_STATIONS = 3000;

const STATE_NAMES = Object.freeze({
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado', CT:'Connecticut', DE:'Delaware', DC:'District of Columbia', FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming', PR:'Puerto Rico', VI:'U.S. Virgin Islands', GU:'Guam', AS:'American Samoa', MP:'Northern Mariana Islands'
});

function cleanText(value) {
  return String(value ?? '').trim();
}

function titleCaseCity(value) {
  const text = cleanText(value);
  if (!text || /[a-z]/.test(text)) return text;
  return text.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (_, lead, letter) => lead + letter.toUpperCase());
}

function numberOrNull(value) {
  const text = cleanText(value);
  if (!text) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

export function parseSnapshot(text) {
  const lines = String(text || '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error('U.S. AM snapshot is empty');

  const headers = lines[0].split('\t').map((header) => header.trim().toUpperCase());
  const idx = Object.fromEntries(headers.map((header, index) => [header, index]));
  const required = ['FREQ', 'CALLSIGN', 'STATE', 'CITY', 'PWR-D', 'PWR-N', 'PWR-C', 'LATITUDE', 'LONGITUDE', 'STATUS'];
  for (const name of required) {
    if (!Number.isInteger(idx[name])) throw new Error(`U.S. AM snapshot missing ${name} column`);
  }

  return lines.slice(1).map((line) => {
    const cols = line.split('\t');
    const get = (name) => cleanText(cols[idx[name]]);
    const frequencyKHz = Number(get('FREQ'));
    const callsign = get('CALLSIGN').toUpperCase();
    const state = get('STATE').toUpperCase();
    const city = get('CITY');
    const lat = Number(get('LATITUDE'));
    const lon = Number(get('LONGITUDE'));
    const status = get('STATUS');

    if (!Number.isFinite(frequencyKHz) || frequencyKHz < 530 || frequencyKHz > 1700) return null;
    if (!/^[A-Z0-9-]{3,12}$/.test(callsign)) return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

    return {
      frequencyKHz,
      callsign,
      state,
      city,
      dayPowerW: numberOrNull(get('PWR-D')),
      nightPowerW: numberOrNull(get('PWR-N')),
      criticalPowerW: numberOrNull(get('PWR-C')),
      lat,
      lon,
      status
    };
  }).filter(Boolean);
}

export function normalizeStations(records) {
  const groups = new Map();

  for (const row of records) {
    const key = `${row.frequencyKHz}|${row.callsign}`;
    if (!groups.has(key)) {
      groups.set(key, {
        ...row,
        dayPowerW: null,
        nightPowerW: null,
        criticalPowerW: null,
        statuses: new Set()
      });
    }

    const station = groups.get(key);
    if (Number.isFinite(row.dayPowerW)) station.dayPowerW = Math.max(station.dayPowerW ?? 0, row.dayPowerW);
    if (Number.isFinite(row.nightPowerW)) station.nightPowerW = Math.max(station.nightPowerW ?? 0, row.nightPowerW);
    if (Number.isFinite(row.criticalPowerW)) station.criticalPowerW = Math.max(station.criticalPowerW ?? 0, row.criticalPowerW);
    if (row.status) station.statuses.add(row.status);

    // Prefer the latest row's non-empty identity/geography when duplicate
    // technical rows exist for the same station/frequency.
    if (row.city) station.city = row.city;
    if (row.state) station.state = row.state;
    if (Number.isFinite(row.lat)) station.lat = row.lat;
    if (Number.isFinite(row.lon)) station.lon = row.lon;
  }

  return [...groups.values()]
    .map((station) => {
      const status = [...station.statuses].filter(Boolean).join(' / ');
      const explicitlySilent = /\bsilent\b/i.test(status);
      const stateName = STATE_NAMES[station.state] || station.state;
      const city = titleCaseCity(station.city);
      const dayPowerW = explicitlySilent ? 0 : (station.dayPowerW ?? 0);
      const nightPowerW = explicitlySilent ? 0 : (station.nightPowerW ?? 0);
      const criticalPowerW = explicitlySilent ? 0 : (station.criticalPowerW ?? 0);

      return {
        type: 'station',
        frequencyKHz: station.frequencyKHz,
        callsign: station.callsign,
        name: `${station.callsign} ${station.frequencyKHz}`,
        location: `${city}, ${stateName}`,
        country: 'United States',
        lat: station.lat,
        lon: station.lon,
        mode: 'AM',
        dayPowerW,
        nightPowerW,
        ...(criticalPowerW ? { criticalPowerW } : {}),
        categories: ['broadcast'],
        description: `FCC-derived AM engineering record serving ${city}, ${stateName}.`,
        status: status || 'Licensed',
        source: `FCC-derived U.S. AM engineering snapshot; pinned GitHub mirror ${SNAPSHOT_COMMIT.slice(0, 12)}`
      };
    })
    .filter((station) => station.dayPowerW > 0 || station.nightPowerW > 0 || station.criticalPowerW > 0)
    .sort((a, b) => a.frequencyKHz - b.frequencyKHz || a.callsign.localeCompare(b.callsign));
}

function render(stations) {
  const raw = stations.map((station) => [
    station.frequencyKHz,
    station.callsign,
    station.location,
    station.lat,
    station.lon,
    station.dayPowerW,
    station.nightPowerW,
    station.criticalPowerW || 0,
    station.status
  ]);

  return `(() => {\n  'use strict';\n  // Generated from a pinned FCC-derived U.S. AM engineering snapshot. Do not hand-edit.\n  const raw = ${JSON.stringify(raw)};\n  window.FREQBEACON_ZERO_US_AM_FCC_CATALOG = Object.freeze(raw.map((row) => Object.freeze({\n    type: 'station', frequencyKHz: row[0], callsign: row[1], name: row[1] + ' ' + row[0], location: row[2], country: 'United States',\n    lat: row[3], lon: row[4], mode: 'AM', dayPowerW: row[5], nightPowerW: row[6], ...(row[7] ? { criticalPowerW: row[7] } : {}),\n    categories: Object.freeze(['broadcast']), description: 'FCC-derived AM engineering record serving ' + row[2] + '.', status: row[8] || 'Licensed',\n    source: 'FCC-derived U.S. AM engineering snapshot; pinned GitHub mirror ${SNAPSHOT_COMMIT.slice(0, 12)}'\n  })));\n  window.FREQBEACON_ZERO_US_AM_FCC_META = Object.freeze({\n    source: 'FCC-derived U.S. AM engineering snapshot',\n    snapshotCommit: '${SNAPSHOT_COMMIT}',\n    stationCount: raw.length\n  });\n})();\n`;
}

async function fetchSnapshot() {
  const response = await fetch(SNAPSHOT_URL, {
    headers: { 'user-agent': 'FREQBEACON catalog builder/1.0 (+https://freqbeacon.methvindigitalworks.com)' },
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`Pinned U.S. AM snapshot fetch failed: ${response.status} ${response.statusText}`);
  return response.text();
}

function runParserFixtures() {
  const fixture = [
    'FREQ\tCALLSIGN\tSTATE\tCITY\tPWR-D\tPWR-N\tPWR-C\tLATITUDE\tLONGITUDE\tSTATUS',
    '740\tKBRT\tCA\tCOSTA MESA\t50000\t190\t\t33.8289\t-117.6383\t',
    '560\tTEST\tAR\tCONWAY\t1000\t\t\t35.0887\t-92.4421\tSilent',
    '1000\tDUPL\tTX\tDALLAS\t5000\t\t\t32.8\t-96.8\t',
    '1000\tDUPL\tTX\tDALLAS\t\t1000\t\t32.8\t-96.8\t'
  ].join('\n');

  const stations = normalizeStations(parseSnapshot(fixture));
  const kbrt = stations.find((station) => station.callsign === 'KBRT');
  const dupl = stations.find((station) => station.callsign === 'DUPL');
  const silent = stations.find((station) => station.callsign === 'TEST');

  if (!kbrt || kbrt.dayPowerW !== 50000 || kbrt.nightPowerW !== 190) throw new Error('U.S. AM KBRT parser fixture failed');
  if (!dupl || dupl.dayPowerW !== 5000 || dupl.nightPowerW !== 1000) throw new Error('U.S. AM duplicate-row merge fixture failed');
  if (silent) throw new Error('U.S. AM silent-station filter fixture failed');
}

async function main() {
  runParserFixtures();

  const stations = normalizeStations(parseSnapshot(await fetchSnapshot()));
  if (stations.length < MIN_EXPECTED_STATIONS) {
    throw new Error(`Refusing incomplete U.S. AM catalog: only ${stations.length} stations parsed`);
  }

  const kbrt = stations.find((station) => station.callsign === 'KBRT' && station.frequencyKHz === 740);
  if (!kbrt || kbrt.dayPowerW !== 50000 || kbrt.nightPowerW !== 190) {
    throw new Error('U.S. AM validation failed: KBRT 740 missing or implausible');
  }

  await writeFile(OUT_PATH, render(stations), 'utf8');
  console.log(`FREQBEACON U.S. AM catalog: ${stations.length} stations written; KBRT ${kbrt.dayPowerW}/${kbrt.nightPowerW} W.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
