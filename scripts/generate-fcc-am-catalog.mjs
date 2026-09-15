import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const FCC_AM_QUERY_URL = 'https://transition.fcc.gov/fcc-bin/amq?call=&filenumber=&state=&city=&freq=530&freq2=1700&type=2&facid=&class=&hours=&country=US&list=2&dist=&dlat2=&mlat2=&slat2=&NS=N&dlon2=&mlon2=&slon2=&EW=W&size=9';
const OUT_PATH = path.resolve('freqbeacon-zero-us-am-fcc.js');
const MIN_EXPECTED_STATIONS = 3000;

const STATE_NAMES = Object.freeze({
  AL:'Alabama', AK:'Alaska', AZ:'Arizona', AR:'Arkansas', CA:'California', CO:'Colorado', CT:'Connecticut', DE:'Delaware', DC:'District of Columbia', FL:'Florida', GA:'Georgia', HI:'Hawaii', ID:'Idaho', IL:'Illinois', IN:'Indiana', IA:'Iowa', KS:'Kansas', KY:'Kentucky', LA:'Louisiana', ME:'Maine', MD:'Maryland', MA:'Massachusetts', MI:'Michigan', MN:'Minnesota', MS:'Mississippi', MO:'Missouri', MT:'Montana', NE:'Nebraska', NV:'Nevada', NH:'New Hampshire', NJ:'New Jersey', NM:'New Mexico', NY:'New York', NC:'North Carolina', ND:'North Dakota', OH:'Ohio', OK:'Oklahoma', OR:'Oregon', PA:'Pennsylvania', RI:'Rhode Island', SC:'South Carolina', SD:'South Dakota', TN:'Tennessee', TX:'Texas', UT:'Utah', VT:'Vermont', VA:'Virginia', WA:'Washington', WV:'West Virginia', WI:'Wisconsin', WY:'Wyoming', PR:'Puerto Rico', VI:'U.S. Virgin Islands', GU:'Guam', AS:'American Samoa', MP:'Northern Mariana Islands'
});

function htmlText(value) {
  return String(value || '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function dms(direction, degrees, minutes, seconds) {
  const deg = Number(degrees);
  const min = Number(minutes);
  const sec = Number(seconds);
  if (![deg, min, sec].every(Number.isFinite)) return null;
  if (min < 0 || min >= 60 || sec < 0 || sec >= 60) return null;
  let value = deg + min / 60 + sec / 3600;
  if (/^[SW]$/i.test(String(direction))) value *= -1;
  return value;
}

function powerWatts(value, unit = '') {
  const text = `${String(value || '').trim()} ${String(unit || '').trim()}`.trim();
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0]);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (/\bkw\b/i.test(text)) return Math.round(numeric * 1000);
  if (/\bw\b/i.test(text) && !/\bkw\b/i.test(text)) return Math.round(numeric);
  // FCC AM Query's POWER field is expressed in kW when the unit is omitted.
  return Math.round(numeric * 1000);
}

function coordinateFromCombined(value, allowedDirections) {
  const text = String(value || '').trim().toUpperCase();
  if (!text) return null;
  const directionMatch = text.match(new RegExp(`[${allowedDirections}]`));
  if (!directionMatch) return null;
  const numbers = text.match(/\d+(?:\.\d+)?/g) || [];
  if (numbers.length < 3) return null;
  const coordinate = dms(directionMatch[0], numbers[0], numbers[1], numbers[2]);
  const maxDegrees = allowedDirections === 'NS' ? 90 : 180;
  return coordinate !== null && Math.abs(coordinate) <= maxDegrees ? coordinate : null;
}

function coordinateFromTokens(fields, allowedDirections, startIndex = 0) {
  const maxDegrees = allowedDirections === 'NS' ? 90 : 180;
  const valid = (value) => value !== null && Math.abs(value) <= maxDegrees;

  for (let i = startIndex; i < fields.length; i += 1) {
    const token = String(fields[i] || '').trim().toUpperCase();
    if (new RegExp(`^[${allowedDirections}]$`).test(token)) {
      const forward = i + 3 < fields.length
        ? dms(token, fields[i + 1], fields[i + 2], fields[i + 3])
        : null;
      const backward = i >= 3
        ? dms(token, fields[i - 3], fields[i - 2], fields[i - 1])
        : null;

      // FCC has emitted both D M S N / D M S W and N D M S / W D M S
      // layouts over time. Latitude suffix form is unambiguous when the prior
      // triplet is numeric; longitude prefix form is unambiguous when a valid
      // following triplet exists. Keep the opposite ordering as fallback.
      if (allowedDirections === 'NS') {
        if (valid(backward)) return backward;
        if (valid(forward)) return forward;
      } else {
        if (valid(forward)) return forward;
        if (valid(backward)) return backward;
      }
    }

    const combined = coordinateFromCombined(token, allowedDirections);
    if (combined !== null) return combined;
  }
  return null;
}

function compactFields(line) {
  const fields = htmlText(line).trim().split('|').map((value) => value.trim());
  while (fields[0] === '') fields.shift();
  while (fields.at(-1) === '') fields.pop();
  return fields;
}

export function parsePipeRecord(line) {
  const fields = compactFields(line);
  if (fields.length < 12) return null;

  const statusIndex = fields.findIndex((value) => String(value).trim().toUpperCase() === 'LIC');
  if (statusIndex < 5) return null;

  // Documented FCC text-export schema:
  // CALLSIGN | FREQUENCY | SERVICE | HOURSOP | CLASS | STATUS | CITY | STATE |
  // COUNTRY | FILENUM | POWER | FACID | LAT | LON | LICENSEE | APPID
  // Some historical output variants insert a frequency unit or split DMS/unit
  // values into separate pipe fields, so the parser also handles those forms.
  let call = '';
  let frequencyKHz = NaN;
  let hours = '';
  let stationClass = '';

  const serviceIndex = fields.findIndex((value, index) => index < statusIndex && String(value).trim().toUpperCase() === 'AM');
  if (serviceIndex === 2 && Number.isFinite(Number(fields[1]))) {
    call = String(fields[0] || '').toUpperCase();
    frequencyKHz = Number(fields[1]);
    hours = String(fields[3] || '').trim();
    stationClass = String(fields[4] || '').trim();
  } else if (serviceIndex === 1 && Number.isFinite(Number(fields[2]))) {
    // Defensive support for the older CALLSIGN | SERVICE | FREQUENCY shape.
    call = String(fields[0] || '').toUpperCase();
    frequencyKHz = Number(fields[2]);
    const between = fields.slice(3, statusIndex);
    hours = between.find((value) => /day|night|unlimited|critical/i.test(String(value))) || '';
    stationClass = [...between].reverse().find((value) => /^[ABCD]$/i.test(String(value).trim())) || '';
  } else {
    return null;
  }

  if (!/^[A-Z0-9-]{3,12}$/.test(call) || !Number.isFinite(frequencyKHz) || frequencyKHz < 530 || frequencyKHz > 1700) return null;

  const city = String(fields[statusIndex + 1] || '').trim();
  const state = String(fields[statusIndex + 2] || '').trim().toUpperCase();
  const country = String(fields[statusIndex + 3] || '').trim().toUpperCase();
  const fileNumber = String(fields[statusIndex + 4] || '').trim();
  if (!['US', 'USA'].includes(country)) return null;

  const powerIndex = statusIndex + 5;
  const powerUnitIndex = /^(?:k?w)$/i.test(String(fields[powerIndex + 1] || '').trim()) ? powerIndex + 1 : -1;
  const powerW = powerWatts(fields[powerIndex], powerUnitIndex > 0 ? fields[powerUnitIndex] : '');
  if (!Number.isFinite(powerW)) return null;

  const afterPower = powerUnitIndex > 0 ? powerUnitIndex + 1 : powerIndex + 1;
  let facilityId = NaN;
  let facilityIndex = -1;
  for (let i = afterPower; i < Math.min(fields.length, afterPower + 4); i += 1) {
    const value = String(fields[i] || '').trim();
    if (/^\d{1,8}$/.test(value)) {
      facilityId = Number(value);
      facilityIndex = i;
      break;
    }
  }
  if (!Number.isFinite(facilityId)) return null;

  const lat = coordinateFromTokens(fields, 'NS', facilityIndex + 1);
  const lon = coordinateFromTokens(fields, 'EW', facilityIndex + 1);
  if (lat === null || lon === null) return null;

  return {
    call,
    frequencyKHz,
    hours,
    domesticClass: stationClass,
    city,
    state,
    fileNumber,
    powerW,
    facilityId,
    lat,
    lon
  };
}

export function parseFccExport(text) {
  return htmlText(text).split(/\r?\n/).map(parsePipeRecord).filter(Boolean);
}

function titleCaseCity(value) {
  const text = String(value || '').trim();
  if (!text || /[a-z]/.test(text)) return text;
  return text.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (_, lead, letter) => lead + letter.toUpperCase());
}

export function normalizeStations(records) {
  const groups = new Map();
  for (const record of records) {
    const key = `${record.facilityId}|${record.frequencyKHz}|${record.call}`;
    if (!groups.has(key)) groups.set(key, { ...record, dayPowerW: null, nightPowerW: null, criticalPowerW: null, unlimitedPowerW: null });
    const station = groups.get(key);
    const label = record.hours.toLowerCase();
    if (label.includes('unlimited')) station.unlimitedPowerW = Math.max(station.unlimitedPowerW || 0, record.powerW);
    else if (label.includes('night')) station.nightPowerW = Math.max(station.nightPowerW || 0, record.powerW);
    else if (label.includes('critical')) station.criticalPowerW = Math.max(station.criticalPowerW || 0, record.powerW);
    else if (label.includes('day')) station.dayPowerW = Math.max(station.dayPowerW || 0, record.powerW);
  }

  return [...groups.values()].map((station) => {
    const unlimited = station.unlimitedPowerW || 0;
    const dayPowerW = unlimited || station.dayPowerW || 0;
    // Keep explicit zero for daytime-only stations so the runtime does not
    // fall back to daytime power after dark.
    const nightPowerW = unlimited || station.nightPowerW || 0;
    const stateName = STATE_NAMES[station.state] || station.state;
    const city = titleCaseCity(station.city);
    return {
      type: 'station',
      frequencyKHz: station.frequencyKHz,
      callsign: station.call,
      name: `${station.call} ${station.frequencyKHz}`,
      location: `${city}, ${stateName}`,
      country: 'United States',
      lat: station.lat,
      lon: station.lon,
      mode: 'AM',
      dayPowerW,
      nightPowerW,
      ...(station.criticalPowerW ? { criticalPowerW: station.criticalPowerW } : {}),
      categories: ['broadcast'],
      description: `FCC-licensed AM station serving ${city}, ${stateName}.`,
      classA: station.domesticClass === 'A',
      facilityId: station.facilityId,
      fileNumber: station.fileNumber,
      source: 'FCC AM Query licensed-station export'
    };
  }).sort((a, b) => a.frequencyKHz - b.frequencyKHz || a.callsign.localeCompare(b.callsign));
}

function render(stations) {
  const raw = stations.map((station) => [
    station.frequencyKHz, station.callsign, station.location, station.lat, station.lon,
    station.dayPowerW, station.nightPowerW, station.criticalPowerW || 0, station.classA ? 1 : 0,
    station.facilityId, station.fileNumber
  ]);
  return `(() => {\n  'use strict';\n  // Generated from the FCC AM Query licensed-station export. Do not hand-edit.\n  const raw = ${JSON.stringify(raw)};\n  window.FREQBEACON_ZERO_US_AM_FCC_CATALOG = Object.freeze(raw.map((row) => Object.freeze({\n    type: 'station', frequencyKHz: row[0], callsign: row[1], name: row[1] + ' ' + row[0], location: row[2], country: 'United States',\n    lat: row[3], lon: row[4], mode: 'AM', dayPowerW: row[5], nightPowerW: row[6], ...(row[7] ? { criticalPowerW: row[7] } : {}),\n    categories: Object.freeze(['broadcast']), description: 'FCC-licensed AM station serving ' + row[2] + '.', classA: Boolean(row[8]),\n    facilityId: row[9], fileNumber: row[10], source: 'FCC AM Query licensed-station export'\n  })));\n  window.FREQBEACON_ZERO_US_AM_FCC_META = Object.freeze({ source: 'FCC AM Query licensed-station export', stationCount: raw.length });\n})();\n`;
}

async function fetchFcc() {
  const response = await fetch(FCC_AM_QUERY_URL, {
    headers: { 'user-agent': 'FREQBEACON catalog builder/1.0 (+https://freqbeacon.methvindigitalworks.com)' },
    signal: AbortSignal.timeout(60000)
  });
  if (!response.ok) throw new Error(`FCC AM Query fetch failed: ${response.status} ${response.statusText}`);
  return response.text();
}

function runParserFixtures() {
  const documented = '|KBRT|740|AM|Daytime|D|LIC|COSTA MESA|CA|US|BL-TEST|50.0|34588|33|49|44.00|N|117|38|18.00|W|KIERTRON, INC.|12345|';
  const splitUnits = '|KBRT|740|AM|Nighttime|D|LIC|COSTA MESA|CA|US|BL-TEST|0.19|kW|34588|N|33|49|44.00|W|117|38|18.00|KIERTRON, INC.|12345|';
  const day = parsePipeRecord(documented);
  const night = parsePipeRecord(splitUnits);
  if (day?.facilityId !== 34588 || day.powerW !== 50000 || Math.abs(day.lat - 33.8288889) > 0.001 || Math.abs(day.lon + 117.6383333) > 0.001) {
    throw new Error('FCC AM documented-schema parser fixture failed');
  }
  if (night?.powerW !== 190) throw new Error('FCC AM split-unit parser fixture failed');
  const station = normalizeStations([day, night])[0];
  if (station.dayPowerW !== 50000 || station.nightPowerW !== 190) throw new Error('FCC AM day/night merge fixture failed');
}

async function main() {
  runParserFixtures();

  const parsed = parseFccExport(await fetchFcc());
  const stations = normalizeStations(parsed);
  if (stations.length < MIN_EXPECTED_STATIONS) {
    throw new Error(`Refusing incomplete FCC AM catalog: ${parsed.length} operating records produced only ${stations.length} licensed U.S. stations`);
  }
  const kbrt = stations.find((station) => station.callsign === 'KBRT' && station.frequencyKHz === 740);
  if (!kbrt || kbrt.dayPowerW < 10000) throw new Error('FCC AM validation failed: KBRT 740 missing or implausible');

  await writeFile(OUT_PATH, render(stations), 'utf8');
  console.log(`FREQBEACON FCC AM catalog: ${stations.length} licensed U.S. stations written; KBRT ${kbrt.dayPowerW}/${kbrt.nightPowerW} W.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
