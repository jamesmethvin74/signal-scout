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
  let value = deg + min / 60 + sec / 3600;
  if (/^[SW]$/i.test(String(direction))) value *= -1;
  return value;
}

function watts(value, unit) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return /kw/i.test(String(unit)) ? Math.round(numeric * 1000) : Math.round(numeric);
}

export function parsePipeRecord(line) {
  const clean = htmlText(line).trim();
  if (!clean.includes('|')) return null;
  const fields = clean.split('|').map((value) => value.trim());
  while (fields[0] === '') fields.shift();
  while (fields.at(-1) === '') fields.pop();

  const amIndex = fields.findIndex((value) => value.toUpperCase() === 'AM');
  if (amIndex < 1) return null;
  const call = String(fields[amIndex - 1] || '').toUpperCase();
  const frequencyKHz = Number(fields[amIndex + 1]);
  if (!/^[A-Z0-9-]{3,12}$/.test(call) || !Number.isFinite(frequencyKHz) || frequencyKHz < 530 || frequencyKHz > 1700) return null;

  const statusIndex = fields.findIndex((value, index) => index > amIndex && value.toUpperCase() === 'LIC');
  if (statusIndex < 0 || statusIndex + 15 >= fields.length) return null;

  const hours = String(fields[amIndex + 4] || '').trim();
  const domesticClass = String(fields[amIndex + 5] || '').trim();
  const region2Class = String(fields[amIndex + 6] || '').trim();
  const city = String(fields[statusIndex + 1] || '').trim();
  const state = String(fields[statusIndex + 2] || '').trim().toUpperCase();
  const country = String(fields[statusIndex + 3] || '').trim().toUpperCase();
  const fileNumber = String(fields[statusIndex + 4] || '').trim();
  const powerW = watts(fields[statusIndex + 5], fields[statusIndex + 6]);
  const facilityId = Number(fields[statusIndex + 7]);
  const lat = dms(fields[statusIndex + 8], fields[statusIndex + 9], fields[statusIndex + 10], fields[statusIndex + 11]);
  const lon = dms(fields[statusIndex + 12], fields[statusIndex + 13], fields[statusIndex + 14], fields[statusIndex + 15]);

  if (!['US', 'USA'].includes(country) || !Number.isFinite(facilityId) || !Number.isFinite(powerW) || lat === null || lon === null) return null;
  return { call, frequencyKHz, hours, domesticClass, region2Class, city, state, fileNumber, powerW, facilityId, lat, lon };
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
      classA: station.domesticClass === 'A' || station.region2Class === 'A',
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

async function main() {
  // Parser fixture mirrors FCC list=2 pipe-delimited field order.
  const fixture = '|KBRT|AM|740|kHz|DA2|Daytime|D|D|LIC|COSTA MESA|CA|US|BL-TEST|50.0|kW|34588|N|33|49|44.00|W|117|38|18.00|3|Pacific|KIERTRON, INC.|';
  if (parsePipeRecord(fixture)?.facilityId !== 34588) throw new Error('FCC AM parser fixture failed');

  const stations = normalizeStations(parseFccExport(await fetchFcc()));
  if (stations.length < MIN_EXPECTED_STATIONS) throw new Error(`Refusing incomplete FCC AM catalog: only ${stations.length} licensed U.S. stations parsed`);
  const kbrt = stations.find((station) => station.callsign === 'KBRT' && station.frequencyKHz === 740);
  if (!kbrt || kbrt.dayPowerW < 10000) throw new Error('FCC AM validation failed: KBRT 740 missing or implausible');

  await writeFile(OUT_PATH, render(stations), 'utf8');
  console.log(`FREQBEACON FCC AM catalog: ${stations.length} licensed U.S. stations written; KBRT ${kbrt.dayPowerW}/${kbrt.nightPowerW} W.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
