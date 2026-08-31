(() => {
  const SCHEDULE_URL = 'https://raw.githubusercontent.com/Roger-Need/StationFinder/main/Frequency%20Lists/Merged/A26%20merged_schedule.csv';
  const COUNTRIES_URL = 'https://raw.githubusercontent.com/google/dspl/master/samples/google/canonical/countries.csv';
  const ALLOWED_SOURCES = new Set(['HFCC', 'EiBi']);
  const stations = window.SIGNAL_SCOUT_STATIONS || (window.SIGNAL_SCOUT_STATIONS = []);
  const seedShortwave = stations.filter((station) => station.band === 'SW');
  const mediumWave = stations.filter((station) => station.band !== 'SW');

  window.SIGNAL_SCOUT_DATA_STATE = {
    loading: true,
    loaded: false,
    source: 'HFCC + EiBi A26',
    count: seedShortwave.length,
    error: null
  };

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
    ['radio new zealand international', 'RNZ Pacific'],
    ['radio new zealand', 'RNZ Pacific']
  ]);

  const UTILITY_RE = /\b(?:navy|naval|coast guard|uscg|radiofax|\bfax\b|hfdl|volmet|aeronautical|marine weather|maritime safety|rtty|teletype|sub comms|submarine)\b/i;

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
    if (lines.length < 2) throw new Error('Full schedule file is empty');
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
      if (name && Number.isFinite(lat) && Number.isFinite(lon)) {
        byName.set(normalize(name), { lat, lon });
      }
    }
    return byName;
  }

  function countryAliases(name) {
    const clean = normalize(name);
    const aliases = {
      'united states of america': 'united states',
      'usa': 'united states',
      'u s a': 'united states',
      'uk': 'united kingdom',
      'great britain': 'united kingdom',
      'russian federation': 'russia',
      'south korea': 'korea south',
      'north korea': 'korea north',
      'viet nam': 'vietnam',
      'czech republic': 'czechia',
      'swaziland': 'eswatini',
      'ivory coast': 'cote d ivoire'
    };
    return aliases[clean] || clean;
  }

  function centroidFor(row, countries) {
    const candidates = [row.txCountry, row.origin]
      .map(countryAliases)
      .filter(Boolean);
    for (const candidate of candidates) {
      if (countries.has(candidate)) return countries.get(candidate);
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
      normalize(row.origin || row.txCountry),
      normalize(row.mode || 'AM')
    ].join('|');
  }

  function chooseDisplayRow(rows) {
    return rows.find((row) => row.source === 'EiBi') ||
      rows.find((row) => row.source === 'HFCC') || rows[0];
  }

  function chooseTechnicalRow(rows) {
    return rows.find((row) => row.source === 'HFCC' && (row.power || row.site || row.txCountry)) ||
      rows.find((row) => row.source === 'HFCC') || rows[0];
  }

  function seedMatch(frequencyKHz, displayName) {
    const normalizedName = normalize(displayName);
    return seedShortwave.find((seed) => {
      if (Math.abs(Number(seed.frequency) - frequencyKHz) > 0.01) return false;
      const seedName = normalize(seed.name);
      return !normalizedName || normalizedName.includes(seedName) || seedName.includes(normalizedName);
    }) || seedShortwave.find((seed) => Math.abs(Number(seed.frequency) - frequencyKHz) <= 0.01);
  }

  function formatType(mode, stationName) {
    const upperMode = String(mode || 'AM').toUpperCase();
    if (upperMode.includes('DRM')) return 'DRM digital broadcast';
    if (/bbc|radio romania|radio exterior|radio new zealand|rnz|voice of|china radio|nhk|nippon hoso/i.test(stationName)) {
      return 'International broadcast';
    }
    if (/adventist|eternal word|wewn|relig|gospel|bible|ministry|ministries/i.test(stationName)) {
      return 'Religious / international';
    }
    return upperMode === 'AM' ? 'Shortwave broadcast' : `${upperMode} broadcast`;
  }

  function buildStations(rows, countries) {
    const groups = new Map();
    rows.filter(isBroadcastCandidate).forEach((row) => {
      const key = groupKey(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });

    const built = [];
    for (const groupedRows of groups.values()) {
      const display = chooseDisplayRow(groupedRows);
      const technical = chooseTechnicalRow(groupedRows);
      const frequencyKHz = technical.frequencyHz / 1000;
      const displayName = friendlyStation(display.station || technical.station);
      const exact = seedMatch(frequencyKHz, displayName);
      const centroid = centroidFor(technical, countries) || centroidFor(display, countries);
      const location = exact && Number.isFinite(exact.lat) && Number.isFinite(exact.lon)
        ? { lat: exact.lat, lon: exact.lon, approximate: false }
        : centroid
          ? { lat: centroid.lat, lon: centroid.lon, approximate: true }
          : { lat: 0, lon: 0, approximate: true };
      const language = decodeLanguage(
        (groupedRows.find((row) => row.source === 'HFCC' && row.language && row.language.length > 2) || display).language,
        (groupedRows.find((row) => row.source === 'HFCC' && row.language && row.language.length > 2) || display).source
      );
      const sources = [...new Set(groupedRows.map((row) => row.source))].join(' + ');
      const transmitter = exact?.transmitter || technical.site || display.site || technical.txCountry || display.txCountry || technical.origin || display.origin || 'Site not listed';
      const txCountry = exact?.country || technical.txCountry || display.txCountry || technical.origin || display.origin || 'Unknown';
      const target = display.target || technical.target;
      const power = Number(technical.power);
      const azimuth = Number(technical.azimuth);

      built.push({
        band: 'SW',
        frequency: frequencyKHz,
        start: String(display.on || technical.on).padStart(4, '0'),
        end: String(display.off || technical.off).padStart(4, '0'),
        name: displayName,
        country: txCountry,
        language,
        format: formatType(technical.mode || display.mode, displayName),
        transmitter,
        lat: location.lat,
        lon: location.lon,
        locationApproximate: location.approximate,
        power: Number.isFinite(power) && power > 0 ? power : 10,
        beam: Number.isFinite(azimuth) ? azimuth : 0,
        days: technical.days || display.days || '1234567',
        target: target || '',
        origin: display.origin || technical.origin || '',
        source: sources,
        note: target
          ? `A26 schedule · target: ${target} · source: ${sources}`
          : `A26 schedule · source: ${sources}`
      });
    }

    return built.sort((a, b) => a.frequency - b.frequency || a.start.localeCompare(b.start));
  }

  function fixApproximateDistanceLabels() {
    const full = window.SIGNAL_SCOUT_FULL_SW || [];
    const byKey = new Map(full.map((station) => [`${station.frequency.toFixed(3)}|${normalize(station.name)}`, station]));
    document.querySelectorAll('.signal-card').forEach((card) => {
      const freqEl = card.querySelector('.frequency');
      const unit = freqEl?.querySelector('span')?.textContent?.trim();
      const valueNode = freqEl ? [...freqEl.childNodes].find((node) => node.nodeType === Node.TEXT_NODE) : null;
      const value = Number(String(valueNode?.textContent || '').replace(/,/g, '').trim());
      const name = card.querySelector('.station-name')?.textContent?.trim() || '';
      if (!Number.isFinite(value) || unit !== 'MHz') return;
      const station = byKey.get(`${(value * 1000).toFixed(3)}|${normalize(name)}`);
      if (!station?.locationApproximate) return;
      const distanceDetail = [...card.querySelectorAll('.detail')].find((detail) => detail.childNodes[0]?.textContent?.trim() === 'Distance');
      const valueEl = distanceDetail?.querySelector('b');
      if (valueEl && !valueEl.textContent.startsWith('≈')) {
        valueEl.textContent = `≈${valueEl.textContent}`;
        valueEl.title = 'Approximate distance using the transmitter-country centroid; exact site coordinates are not available for this schedule entry yet.';
      }
    });
  }

  async function loadFullData() {
    const sourceNote = document.querySelector('.source-note');
    if (sourceNote) sourceNote.textContent = 'Loading full A26 HFCC + EiBi shortwave schedules…';

    try {
      const [scheduleResponse, countriesResponse] = await Promise.all([
        fetch(SCHEDULE_URL, { cache: 'default' }),
        fetch(COUNTRIES_URL, { cache: 'default' })
      ]);
      if (!scheduleResponse.ok) throw new Error(`Schedule fetch failed (${scheduleResponse.status})`);
      if (!countriesResponse.ok) throw new Error(`Country-location fetch failed (${countriesResponse.status})`);

      const [scheduleText, countriesText] = await Promise.all([
        scheduleResponse.text(),
        countriesResponse.text()
      ]);
      const fullShortwave = buildStations(parseSchedule(scheduleText), parseCountries(countriesText));
      if (fullShortwave.length < 500) throw new Error(`Only ${fullShortwave.length} schedule entries were parsed`);

      stations.splice(0, stations.length, ...fullShortwave, ...mediumWave);
      window.SIGNAL_SCOUT_FULL_SW = fullShortwave;
      window.SIGNAL_SCOUT_DATA_STATE = {
        loading: false,
        loaded: true,
        source: 'HFCC + EiBi A26',
        count: fullShortwave.length,
        error: null
      };

      if (sourceNote) {
        sourceNote.textContent = `Full A26 shortwave schedule loaded: ${fullShortwave.length.toLocaleString()} normalized HFCC/EiBi transmission entries, plus the current medium-wave starter set. Reception distances marked ≈ use a transmitter-country centroid until exact site coordinates are enriched.`;
      }

      document.getElementById('languageFilter')?.dispatchEvent(new Event('change', { bubbles: true }));
      window.setTimeout(fixApproximateDistanceLabels, 0);
    } catch (error) {
      window.SIGNAL_SCOUT_DATA_STATE = {
        loading: false,
        loaded: false,
        source: 'starter fallback',
        count: seedShortwave.length,
        error: String(error?.message || error)
      };
      if (sourceNote) {
        sourceNote.textContent = `Full schedule could not be loaded; using the built-in starter data. ${window.SIGNAL_SCOUT_DATA_STATE.error}`;
      }
      console.error('Signal Scout full-data load failed:', error);
    }
  }

  const grid = document.getElementById('signalGrid');
  if (grid) new MutationObserver(() => window.setTimeout(fixApproximateDistanceLabels, 0)).observe(grid, { childList: true, subtree: true });

  window.SIGNAL_SCOUT_DATA_READY = loadFullData();
})();
