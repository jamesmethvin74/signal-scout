import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Transport mirror of FCC technical facts. The page states it is compiled from
// the FCC database and is refreshed regularly. FREQBEACON stores only factual
// station fields (frequency, callsign, city/state, powers and coordinates).
const SOURCE_URL = 'https://mesamike.org/radio/amdb/';
const OUT_PATH = path.resolve('freqbeacon-zero-us-am-fcc.js');
const MIN_EXPECTED_STATIONS = 4000;

const STATE_NAMES = Object.freeze({
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado', CT:'Connecticut', DE:'Delaware', DC:'District of Columbia', FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming', PR:'Puerto Rico', VI:'U.S. Virgin Islands', GU:'Guam', AS:'American Samoa', MP:'Northern Mariana Islands'
});

function text(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function number(value) {
  const clean = text(value).replace(/,/g, '');
  if (!clean) return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function titleCase(value) {
  const clean = text(value);
  if (!clean || /[a-z]/.test(clean)) return clean;
  return clean.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (_, lead, letter) => lead + letter.toUpperCase());
}

export function parseSnapshot(html) {
  const rows = [];
  for (const match of String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => text(cell[1]));
    if (cells.length < 10) continue;

    const frequencyKHz = number(cells[0]);
    const callsign = text(cells[1]).toUpperCase();
    const state = text(cells[2]).toUpperCase();
    const city = titleCase(cells[3]);
    const dayPowerW = number(cells[4]);
    const nightPowerW = number(cells[5]);
    const criticalPowerW = number(cells[6]);
    const lat = number(cells[8]);
    const lon = number(cells[9]);

    if (!Number.isFinite(frequencyKHz) || frequencyKHz < 530 || frequencyKHz > 1700) continue;
    if (!/^[A-Z0-9-]{3,12}$/.test(callsign)) continue;
    if (!Number.isFinite(dayPowerW) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

    const stateName = STATE_NAMES[state] || state;
    rows.push({
      type: 'station',
      frequencyKHz,
      callsign,
      name: `${callsign} ${frequencyKHz}`,
      location: `${city}, ${stateName}`,
      country: 'United States',
      lat,
      lon,
      mode: 'AM',
      dayPowerW,
      // A blank night-power cell means no authorized nighttime operation.
      nightPowerW: Number.isFinite(nightPowerW) ? nightPowerW : 0,
      ...(Number.isFinite(criticalPowerW) && criticalPowerW > 0 ? { criticalPowerW } : {}),
      categories: ['broadcast'],
      description: `FCC-derived AM engineering record serving ${city}, ${stateName}.`,
      classA: false,
      source: 'FCC database via Mesa Mike technical snapshot'
    });
  }

  const deduped = new Map();
  for (const row of rows) deduped.set(`${row.frequencyKHz}|${row.callsign}`, row);
  return [...deduped.values()].sort((a, b) => a.frequencyKHz - b.frequencyKHz || a.callsign.localeCompare(b.callsign));
}

function sourceDate(html) {
  const match = text(html).match(/Last Updated\s+(.+?)\s+UTC/i);
  return match ? match[1] : 'unknown';
}

function render(stations, updated) {
  const raw = stations.map((station) => [
    station.frequencyKHz, station.callsign, station.location, station.lat, station.lon,
    station.dayPowerW, station.nightPowerW, station.criticalPowerW || 0
  ]);
  return `(() => {\n  'use strict';\n  // Generated FCC-derived U.S. AM technical catalog. Do not hand-edit.\n  const raw = ${JSON.stringify(raw)};\n  window.FREQBEACON_ZERO_US_AM_FCC_CATALOG = Object.freeze(raw.map((row) => Object.freeze({\n    type: 'station', frequencyKHz: row[0], callsign: row[1], name: row[1] + ' ' + row[0], location: row[2], country: 'United States',\n    lat: row[3], lon: row[4], mode: 'AM', dayPowerW: row[5], nightPowerW: row[6], ...(row[7] ? { criticalPowerW: row[7] } : {}),\n    categories: Object.freeze(['broadcast']), description: 'FCC-derived AM engineering record serving ' + row[2] + '.', classA: false,\n    source: 'FCC database via Mesa Mike technical snapshot'\n  })));\n  window.FREQBEACON_ZERO_US_AM_FCC_META = Object.freeze({\n    source: 'FCC database via Mesa Mike technical snapshot', sourceUrl: '${SOURCE_URL}', sourceUpdated: ${JSON.stringify(updated)}, stationCount: raw.length\n  });\n})();\n`;
}

async function main() {
  const fixture = `<table><tr><td>740</td><td><a>KBRT</a></td><td>CA</td><td>COSTA MESA</td><td>50000</td><td>190</td><td></td><td></td><td>33.7000</td><td>-117.8000</td><td></td><td></td></tr></table>`;
  const parsedFixture = parseSnapshot(fixture)[0];
  if (parsedFixture?.callsign !== 'KBRT' || parsedFixture.dayPowerW !== 50000 || parsedFixture.nightPowerW !== 190) {
    throw new Error('AM snapshot parser fixture failed');
  }

  const response = await fetch(SOURCE_URL, {
    headers: { 'user-agent': 'FREQBEACON catalog builder/1.0 (+https://freqbeacon.methvindigitalworks.com)' },
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`AM snapshot fetch failed: ${response.status} ${response.statusText}`);
  const html = await response.text();
  const stations = parseSnapshot(html);

  if (stations.length < MIN_EXPECTED_STATIONS) {
    throw new Error(`Refusing incomplete U.S. AM catalog: only ${stations.length} stations parsed`);
  }
  const kbrt = stations.find((station) => station.callsign === 'KBRT' && station.frequencyKHz === 740);
  if (!kbrt || kbrt.dayPowerW < 10000 || !Number.isFinite(kbrt.lat) || !Number.isFinite(kbrt.lon)) {
    throw new Error('U.S. AM validation failed: KBRT 740 missing or implausible');
  }

  const updated = sourceDate(html);
  await writeFile(OUT_PATH, render(stations, updated), 'utf8');
  console.log(`FREQBEACON U.S. AM catalog: ${stations.length} stations written; source ${updated}; KBRT ${kbrt.dayPowerW}/${kbrt.nightPowerW} W.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
