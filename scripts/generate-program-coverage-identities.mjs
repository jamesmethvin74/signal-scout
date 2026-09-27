import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const A26_DIR = path.resolve('data/identification/a26');
const FCC_PATH = path.resolve('freqbeacon-zero-us-am-fcc.js');
const TERRESTRIAL_PATH = path.resolve('freqbeacon-zero-global-mw-lw.js');
const TERRESTRIAL_FALLBACK_PATH = path.resolve('freqbeacon-zero-global-mw-lw-fallback.js');
const OUT_PATH = path.resolve('data/program-guide/coverage-identities.json');

const REGION_BY_COUNTRY = new Map([
  ['united states','North America'],['usa','North America'],['canada','North America'],['mexico','North America'],
  ['united kingdom','Europe'],['uk','Europe'],['ireland','Europe'],['spain','Europe'],['portugal','Europe'],
  ['france','Europe'],['germany','Europe'],['italy','Europe'],['romania','Europe'],['netherlands','Europe'],
  ['belgium','Europe'],['switzerland','Europe'],['austria','Europe'],['poland','Europe'],['czechia','Europe'],
  ['czech republic','Europe'],['slovakia','Europe'],['hungary','Europe'],['bulgaria','Europe'],['serbia','Europe'],
  ['croatia','Europe'],['greece','Europe'],['sweden','Europe'],['norway','Europe'],['denmark','Europe'],
  ['finland','Europe'],['iceland','Europe'],['estonia','Europe'],['latvia','Europe'],['lithuania','Europe'],
  ['ukraine','Eastern Europe'],['belarus','Eastern Europe'],['moldova','Eastern Europe'],['russia','Eastern Europe / Central Asia'],
  ['kazakhstan','Central Asia'],['uzbekistan','Central Asia'],['kyrgyzstan','Central Asia'],['tajikistan','Central Asia'],
  ['turkmenistan','Central Asia'],['armenia','Caucasus'],['azerbaijan','Caucasus'],['georgia','Caucasus'],
  ['turkey','Middle East'],['israel','Middle East'],['iran','Middle East'],['iraq','Middle East'],['jordan','Middle East'],
  ['lebanon','Middle East'],['saudi arabia','Middle East'],['united arab emirates','Middle East'],['uae','Middle East'],
  ['qatar','Middle East'],['oman','Middle East'],['yemen','Middle East'],['syria','Middle East'],
  ['india','South Asia'],['pakistan','South Asia'],['bangladesh','South Asia'],['sri lanka','South Asia'],
  ['nepal','South Asia'],['bhutan','South Asia'],['afghanistan','South Asia'],['maldives','South Asia'],
  ['china','East Asia'],['japan','East Asia'],['south korea','East Asia'],['korea south','East Asia'],
  ['north korea','East Asia'],['korea north','East Asia'],['taiwan','East Asia'],['mongolia','East Asia'],
  ['thailand','Southeast Asia'],['vietnam','Southeast Asia'],['viet nam','Southeast Asia'],['malaysia','Southeast Asia'],
  ['singapore','Southeast Asia'],['indonesia','Southeast Asia'],['philippines','Southeast Asia'],['myanmar','Southeast Asia'],
  ['cambodia','Southeast Asia'],['laos','Southeast Asia'],['brunei','Southeast Asia'],['timor-leste','Southeast Asia'],
  ['australia','Australia / New Zealand / Pacific'],['new zealand','Australia / New Zealand / Pacific'],
  ['papua new guinea','Australia / New Zealand / Pacific'],['solomon islands','Australia / New Zealand / Pacific'],
  ['fiji','Australia / New Zealand / Pacific'],['samoa','Australia / New Zealand / Pacific'],['tonga','Australia / New Zealand / Pacific'],
  ['south africa','Africa'],['egypt','Africa'],['morocco','Africa'],['algeria','Africa'],['tunisia','Africa'],
  ['nigeria','Africa'],['ghana','Africa'],['kenya','Africa'],['tanzania','Africa'],['uganda','Africa'],['ethiopia','Africa'],
  ['eritrea','Africa'],['sudan','Africa'],['south sudan','Africa'],['zambia','Africa'],['zimbabwe','Africa'],
  ['botswana','Africa'],['namibia','Africa'],['mozambique','Africa'],['madagascar','Africa'],['mali','Africa'],
  ['senegal','Africa'],['cameroon','Africa'],['democratic republic of the congo','Africa'],['congo','Africa'],
  ['brazil','Latin America / Caribbean'],['argentina','Latin America / Caribbean'],['chile','Latin America / Caribbean'],
  ['peru','Latin America / Caribbean'],['colombia','Latin America / Caribbean'],['venezuela','Latin America / Caribbean'],
  ['ecuador','Latin America / Caribbean'],['bolivia','Latin America / Caribbean'],['paraguay','Latin America / Caribbean'],
  ['uruguay','Latin America / Caribbean'],['cuba','Latin America / Caribbean'],['dominican republic','Latin America / Caribbean'],
  ['haiti','Latin America / Caribbean'],['jamaica','Latin America / Caribbean'],['puerto rico','Latin America / Caribbean'],
  ['guyana','Latin America / Caribbean'],['suriname','Latin America / Caribbean']
]);

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalized(value) {
  return clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function regionFor(country) {
  return REGION_BY_COUNTRY.get(normalized(country)) || 'Other / Global';
}

async function readAssignedArray(file, marker) {
  const source = await readFile(file, 'utf8');
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${marker.trim()} in ${file}`);
  const jsonStart = start + marker.length;
  const end = source.indexOf(';\n', jsonStart);
  if (end < 0) throw new Error(`Could not find JSON terminator in ${file}`);
  const parsed = JSON.parse(source.slice(jsonStart, end));
  if (!Array.isArray(parsed)) throw new Error(`Expected array in ${file}`);
  return parsed;
}

function identityKey(name, country) {
  return normalized(name) + '|' + normalized(country);
}

function addIdentity(groups, input) {
  const name = clean(input.name);
  const country = clean(input.country) || 'Unknown';
  const frequency = Number(input.frequencyKHz);
  const band = clean(input.band).toUpperCase();
  if (!name || !Number.isFinite(frequency) || !['SW','MW','LW'].includes(band)) return;

  const key = identityKey(name, country);
  if (!groups.has(key)) {
    groups.set(key, {
      stationServiceKey:name,
      displayName:name,
      country,
      region:regionFor(country),
      bands:new Set(),
      frequencies:new Set(),
      languages:new Set()
    });
  }
  const row = groups.get(key);
  row.bands.add(band);
  row.frequencies.add(Number(frequency.toFixed(3)));
  if (input.language) row.languages.add(clean(input.language));
}

async function loadShortwave(groups) {
  const manifest = JSON.parse(await readFile(path.join(A26_DIR, 'manifest.json'), 'utf8'));
  for (const shard of manifest.shards || []) {
    const payload = JSON.parse(await readFile(path.resolve('.' + shard.path), 'utf8'));
    for (const entry of payload.entries || []) {
      addIdentity(groups, {
        name:entry.callsign || entry.name,
        country:entry.country,
        band:'SW',
        frequencyKHz:entry.frequencyKHz,
        language:entry.language
      });
    }
  }
  return { season:manifest.season || null, records:Number(manifest.count || 0) };
}

async function loadFcc(groups) {
  const rows = await readAssignedArray(FCC_PATH, 'const raw = ');
  for (const row of rows) {
    addIdentity(groups, {
      name:row[1],
      country:'United States',
      band:'MW',
      frequencyKHz:row[0]
    });
  }
  return rows.length;
}

async function loadTerrestrial(groups, file) {
  const entries = await readAssignedArray(file, 'const entries = ');
  for (const entry of entries) {
    addIdentity(groups, {
      name:entry.callsign || entry.name,
      country:entry.country,
      band:entry.band,
      frequencyKHz:entry.frequencyKHz,
      language:entry.language
    });
  }
  return entries.length;
}

async function main() {
  const groups = new Map();
  const [shortwave, fccCount, terrestrialCount, fallbackCount] = await Promise.all([
    loadShortwave(groups),
    loadFcc(groups),
    loadTerrestrial(groups, TERRESTRIAL_PATH),
    loadTerrestrial(groups, TERRESTRIAL_FALLBACK_PATH)
  ]);

  const identities = [...groups.values()].map((row) => {
    const frequencies = [...row.frequencies].sort((a,b) => a - b);
    return {
      stationServiceKey:row.stationServiceKey,
      displayName:row.displayName,
      country:row.country,
      region:row.region,
      bands:[...row.bands].sort(),
      knownFrequencyCount:frequencies.length,
      frequenciesKHz:frequencies,
      languages:[...row.languages].filter(Boolean).sort()
    };
  }).sort((a,b) =>
    a.region.localeCompare(b.region)
    || a.country.localeCompare(b.country)
    || a.displayName.localeCompare(b.displayName)
  );

  if (identities.length < 1000) throw new Error(`Refusing suspicious program coverage identity inventory: only ${identities.length} identities`);

  await mkdir(path.dirname(OUT_PATH), { recursive:true });
  const payload = {
    version:1,
    generatedAt:new Date().toISOString(),
    source:'Existing FREQBEACON identification catalogs',
    inputs:{
      shortwave:{ season:shortwave.season, records:shortwave.records },
      usAm:{ records:fccCount },
      regulatorMwLw:{ records:terrestrialCount },
      fallbackMwLw:{ records:fallbackCount }
    },
    recognizedIdentityCount:identities.length,
    identities
  };
  await writeFile(OUT_PATH, JSON.stringify(payload), 'utf8');
  console.log(`FREQBEACON program coverage inventory: ${identities.length} recognized broadcaster/service identities.`);
}

main().catch((error) => {
  console.error(`FREQBEACON program coverage inventory generation failed: ${error?.stack || error}`);
  process.exitCode = 1;
});
