(() => {
  'use strict';

  // Shared, local-only identification catalog for FREQBEACON Zero and future
  // Lookup/Explore surfaces. Zero never loads full-data.js, so no HFCC/EiBi
  // network request occurs while listening. Instead we reuse FREQBEACON's
  // static SW seed schedule (stations.js), AM snapshot, and ham-band guide.
  const amStations = Array.isArray(window.FREQBEACON_ZERO_AM_CATALOG)
    ? window.FREQBEACON_ZERO_AM_CATALOG
    : [];
  const stationSeeds = Array.isArray(window.SIGNAL_SCOUT_STATIONS)
    ? window.SIGNAL_SCOUT_STATIONS
    : [];
  const hamBands = Array.isArray(window.SIGNAL_SCOUT_HAM_BANDS)
    ? window.SIGNAL_SCOUT_HAM_BANDS
    : [];

  const freezeEntry = (entry) => Object.freeze({
    ...entry,
    categories: Object.freeze([...(entry.categories || [])])
  });

  const mappedAm = amStations.map((station) => freezeEntry({
    ...station,
    band: 'MW',
    source: station.source || 'FREQBEACON static AM catalog'
  }));

  const mappedShortwave = stationSeeds
    .filter((station) => station.band === 'SW')
    .map((station) => freezeEntry({
      type: 'station',
      band: 'SW',
      frequencyKHz: Number(station.frequency),
      callsign: /^[A-Z0-9]{3,6}$/.test(String(station.name || '')) ? station.name : '',
      name: station.name,
      location: station.transmitter,
      country: station.country,
      transmitter: station.transmitter,
      lat: Number(station.lat),
      lon: Number(station.lon),
      mode: /DRM/i.test(String(station.format || '')) ? 'DRM' : 'AM',
      language: station.language,
      categories: [
        'shortwave',
        'broadcast',
        ...(/relig/i.test(String(station.format || '')) ? ['religious'] : []),
        ...(/news|world service|international/i.test(`${station.format || ''} ${station.name || ''}`) ? ['international'] : [])
      ],
      description: station.note || station.format || 'Shortwave broadcast service.',
      powerW: Number.isFinite(Number(station.power)) ? Number(station.power) * 1000 : undefined,
      start: station.start,
      end: station.end,
      days: station.days,
      target: station.target || '',
      format: station.format || '',
      source: 'FREQBEACON stations.js static SW schedule seed'
    }));

  const fixedSignals = [];
  const pushSignal = (frequencyKHz, name, fields = {}) => fixedSignals.push(freezeEntry({
    type: 'signal',
    frequencyKHz,
    name,
    categories: ['utility'],
    ...fields
  }));

  // Standard-frequency/time stations. Multiple transmitters may share a
  // frequency; the lookup engine ranks them from the active SDR receiver.
  [2500, 5000, 10000, 15000, 20000, 25000].forEach((frequencyKHz) => pushSignal(
    frequencyKHz,
    'WWV',
    {
      callsign: 'WWV',
      location: 'Fort Collins, Colorado',
      country: 'United States',
      transmitter: 'Fort Collins, Colorado',
      lat: 40.6781,
      lon: -105.0469,
      mode: 'AM',
      categories: ['time-signal', 'utility', 'standard-frequency'],
      description: 'NIST standard time and frequency broadcast with precise timing tones, announcements and propagation information.',
      source: 'NIST standard-frequency service'
    }
  ));
  [2500, 5000, 10000, 15000].forEach((frequencyKHz) => pushSignal(
    frequencyKHz,
    'WWVH',
    {
      callsign: 'WWVH',
      location: 'Kekaha, Hawaii',
      country: 'United States',
      transmitter: 'Kekaha, Hawaii',
      lat: 21.9893,
      lon: -159.7646,
      mode: 'AM',
      categories: ['time-signal', 'utility', 'standard-frequency'],
      description: 'NIST Pacific standard time and frequency broadcast sharing several channels with WWV.',
      source: 'NIST standard-frequency service'
    }
  ));
  [3330, 7850, 14670].forEach((frequencyKHz) => pushSignal(
    frequencyKHz,
    'CHU',
    {
      callsign: 'CHU',
      location: 'Ottawa, Ontario',
      country: 'Canada',
      transmitter: 'Ottawa, Ontario',
      lat: 45.2944,
      lon: -75.7578,
      mode: 'AM / USB',
      categories: ['time-signal', 'utility', 'standard-frequency'],
      description: 'Canadian time-signal station transmitting continuous UTC time announcements and timing codes.',
      source: 'National Research Council Canada time service'
    }
  ));
  pushSignal(60, 'WWVB', {
    callsign: 'WWVB',
    location: 'Fort Collins, Colorado',
    country: 'United States',
    transmitter: 'Fort Collins, Colorado',
    lat: 40.6781,
    lon: -105.0469,
    mode: 'Time code',
    categories: ['longwave', 'time-signal', 'utility'],
    description: 'NIST 60 kHz standard-frequency and time-code transmission used by radio-controlled clocks across North America.',
    source: 'NIST LF time service'
  });
  pushSignal(60, 'MSF', {
    callsign: 'MSF',
    location: 'Anthorn, England',
    country: 'United Kingdom',
    transmitter: 'Anthorn, England',
    lat: 54.9111,
    lon: -3.2783,
    mode: 'Time code',
    categories: ['longwave', 'time-signal', 'utility'],
    description: 'United Kingdom 60 kHz time-code service transmitted from Anthorn.',
    source: 'UK national time service'
  });
  pushSignal(77.5, 'DCF77', {
    callsign: 'DCF77',
    location: 'Mainflingen, Germany',
    country: 'Germany',
    transmitter: 'Mainflingen, Germany',
    lat: 50.0156,
    lon: 9.0106,
    mode: 'Time code',
    categories: ['longwave', 'time-signal', 'utility'],
    description: 'German 77.5 kHz standard-frequency and time-code service used by radio-controlled clocks across Europe.',
    source: 'German national time service'
  });

  const knownServices = [
    [490, 'NAVTEX 490 kHz', 'Maritime safety information', 'FSK', ['maritime', 'utility', 'digital'], 'National-language NAVTEX channel used for navigational and meteorological safety information.'],
    [518, 'NAVTEX 518 kHz', 'International maritime safety', 'FSK', ['maritime', 'utility', 'digital'], 'International NAVTEX channel carrying maritime safety, navigation and weather messages.'],
    [2182, '2182 kHz Maritime Calling / Distress', 'Maritime service', 'USB / AM', ['maritime', 'utility', 'safety'], 'International maritime radiotelephony calling, distress and safety frequency.'],
    [4724, 'USAF HFGCS', 'High Frequency Global Communications System', 'USB', ['aviation', 'utility', 'military'], 'Known HFGCS channel used by U.S. military aircraft and ground stations for long-range HF communications.'],
    [6739, 'USAF HFGCS', 'High Frequency Global Communications System', 'USB', ['aviation', 'utility', 'military'], 'Known HFGCS channel used by U.S. military aircraft and ground stations for long-range HF communications.'],
    [8992, 'USAF HFGCS', 'High Frequency Global Communications System', 'USB', ['aviation', 'utility', 'military'], 'Major HFGCS channel where long-range military aviation traffic and Emergency Action Messages may be heard.'],
    [11175, 'USAF HFGCS', 'High Frequency Global Communications System', 'USB', ['aviation', 'utility', 'military'], 'One of the best-known HFGCS channels for long-range U.S. military aviation and command communications.'],
    [13200, 'USAF HFGCS', 'High Frequency Global Communications System', 'USB', ['aviation', 'utility', 'military'], 'Known HFGCS channel used by U.S. military aircraft and ground stations for long-range HF communications.'],
    [15016, 'USAF HFGCS', 'High Frequency Global Communications System', 'USB', ['aviation', 'utility', 'military'], 'Known HFGCS channel used by U.S. military aircraft and ground stations for long-range HF communications.']
  ].map((row) => freezeEntry({
    type: 'service',
    frequencyKHz: row[0],
    name: row[1],
    shortName: row[2],
    mode: row[3],
    categories: row[4],
    description: row[5],
    source: 'FREQBEACON documented fixed-service guide'
  }));

  const cbFrequencies = [
    26965, 26975, 26985, 27005, 27015, 27025, 27035, 27055, 27065, 27075,
    27085, 27105, 27115, 27125, 27135, 27155, 27165, 27175, 27185, 27205,
    27215, 27225, 27255, 27235, 27245, 27265, 27275, 27285, 27295, 27305,
    27315, 27325, 27335, 27345, 27355, 27365, 27375, 27385, 27395, 27405
  ];
  const cbChannels = cbFrequencies.map((frequencyKHz, index) => {
    const channel = index + 1;
    return freezeEntry({
      type: 'channel',
      band: 'CB',
      frequencyKHz,
      callsign: `CB ${channel}`,
      name: `CB Channel ${channel}`,
      mode: 'AM / SSB / FM',
      categories: ['cb', 'voice'],
      description: channel === 19
        ? 'U.S. Citizens Band Channel 19, widely used for highway and trucking traffic.'
        : `U.S. Citizens Band Channel ${channel}.`,
      source: 'U.S. 40-channel CB frequency plan'
    });
  });

  const rawRanges = [
    ['band', 30, 300, 'Longwave', 'LW', 'AM / CW / Digital', 'longwave|utility', 'Low-frequency spectrum used for time standards, navigation beacons, utility signals and some broadcasting outside North America.'],
    ['service-range', 190, 535, 'Aeronautical NDB / Beacon Region', 'NDB', 'AM / CW ident', 'aviation|navigation|beacon', 'Legacy and regional non-directional aeronautical beacons may be heard in this part of the LF/MF spectrum; many individual beacons have been decommissioned.'],
    ['band', 520, 1710, 'Medium Wave / AM Broadcast', 'AM BC', 'AM', 'broadcast', 'Traditional AM broadcasting. Local stations dominate by day; distant stations can travel much farther after dark.'],
    ['broadcast-band', 2300, 2495, '120 Meter Shortwave Broadcast Band', '120m SW', 'AM / DRM', 'shortwave|broadcast|international', 'Tropical-band shortwave broadcasting and regional international services.'],
    ['broadcast-band', 3200, 3400, '90 Meter Shortwave Broadcast Band', '90m SW', 'AM / DRM', 'shortwave|broadcast|international', 'Tropical-band shortwave broadcasting, especially useful after dark.'],
    ['broadcast-band', 3900, 4000, '75 Meter Shortwave Broadcast Band', '75m SW', 'AM / DRM', 'shortwave|broadcast|international', 'Shortwave broadcasting allocation shared regionally with other HF activity.'],
    ['broadcast-band', 4750, 5060, '60 Meter Shortwave Broadcast Band', '60m SW', 'AM / DRM', 'shortwave|broadcast|international', 'Tropical-band broadcasting and regional shortwave services.'],
    ['broadcast-band', 5900, 6200, '49 Meter Shortwave Broadcast Band', '49m SW', 'AM / DRM', 'shortwave|broadcast|international', 'One of the most-used nighttime international broadcast bands.'],
    ['broadcast-band', 7200, 7450, '41 Meter Shortwave Broadcast Band', '41m SW', 'AM / DRM', 'shortwave|broadcast|international', 'International shortwave broadcasting; overlaps amateur allocations in some regions.'],
    ['broadcast-band', 9400, 9900, '31 Meter Shortwave Broadcast Band', '31m SW', 'AM / DRM', 'shortwave|broadcast|international', 'Major international broadcast band with strong evening and nighttime activity.'],
    ['broadcast-band', 11600, 12100, '25 Meter Shortwave Broadcast Band', '25m SW', 'AM / DRM', 'shortwave|broadcast|international', 'Major daytime and transitional international broadcast band.'],
    ['broadcast-band', 13570, 13870, '22 Meter Shortwave Broadcast Band', '22m SW', 'AM / DRM', 'shortwave|broadcast|international', 'International broadcast band often useful during daylight and early evening.'],
    ['broadcast-band', 15100, 15830, '19 Meter Shortwave Broadcast Band', '19m SW', 'AM / DRM', 'shortwave|broadcast|international', 'Busy higher-HF international broadcast band, strongest when daytime propagation supports it.'],
    ['broadcast-band', 17480, 17900, '16 Meter Shortwave Broadcast Band', '16m SW', 'AM / DRM', 'shortwave|broadcast|international', 'Daytime international shortwave broadcasting band.'],
    ['broadcast-band', 18900, 19020, '15 Meter Shortwave Broadcast Band', '15m SW', 'AM / DRM', 'shortwave|broadcast|international', 'Smaller high-frequency international broadcast allocation.'],
    ['broadcast-band', 21450, 21850, '13 Meter Shortwave Broadcast Band', '13m SW', 'AM / DRM', 'shortwave|broadcast|international', 'High-frequency international broadcasting, most useful during strong daytime propagation.'],
    ['broadcast-band', 25600, 26100, '11 Meter Shortwave Broadcast Band', '11m SW', 'AM / DRM', 'shortwave|broadcast|international', 'Highest traditional international shortwave broadcast band.'],
    ['aviation-range', 2850, 3155, 'HF Aeronautical Route Communications', 'HF AIR', 'USB', 'aviation|utility|voice', 'International aeronautical mobile route communications window.'],
    ['aviation-range', 3400, 3500, 'HF Aeronautical Route Communications', 'HF AIR', 'USB', 'aviation|utility|voice', 'International aeronautical mobile route communications window.'],
    ['aviation-range', 4650, 4750, 'HF Aeronautical Route Communications', 'HF AIR', 'USB', 'aviation|utility|voice', 'International aeronautical mobile route communications window.'],
    ['aviation-range', 5450, 5730, 'HF Aeronautical Route Communications', 'HF AIR', 'USB', 'aviation|utility|voice', 'International aeronautical mobile route communications window.'],
    ['aviation-range', 6525, 6765, 'HF Aeronautical Route Communications', 'HF AIR', 'USB', 'aviation|utility|voice', 'International aeronautical mobile route communications window.'],
    ['aviation-range', 8815, 9040, 'HF Aeronautical / Utility Communications', 'HF AIR', 'USB', 'aviation|utility|voice', 'Long-distance aeronautical and related utility communications window.'],
    ['aviation-range', 10005, 10100, 'HF Aeronautical Route Communications', 'HF AIR', 'USB', 'aviation|utility|voice', 'International aeronautical mobile route communications window.'],
    ['aviation-range', 13200, 13360, 'HF Aeronautical Route Communications', 'HF AIR', 'USB', 'aviation|utility|voice', 'International aeronautical mobile route communications window.'],
    ['aviation-range', 15010, 15100, 'HF Aeronautical Route Communications', 'HF AIR', 'USB', 'aviation|utility|voice', 'International aeronautical mobile route communications window.'],
    ['aviation-range', 17900, 18030, 'HF Aeronautical Route Communications', 'HF AIR', 'USB', 'aviation|utility|voice', 'International aeronautical mobile route communications window.'],
    ['aviation-range', 21870, 22000, 'HF Aeronautical Route Communications', 'HF AIR', 'USB', 'aviation|utility|voice', 'International aeronautical mobile route communications window.'],
    ['service-range', 26965, 27405, 'Citizens Band Radio', 'CB', 'AM / SSB / FM', 'cb|voice', 'The 40-channel U.S. Citizens Band. Exact channel frequencies are identified individually.'],
    ['band', 2300, 26100, 'Shortwave / HF', 'Shortwave', 'AM / SSB / CW / Digital', 'shortwave|broadcast|utility', 'High-frequency radio carrying international broadcasting, amateur, aviation, maritime, military and utility signals around the world.']
  ];

  const staticRanges = rawRanges.map((row) => freezeEntry({
    type: row[0],
    startKHz: row[1],
    endKHz: row[2],
    name: row[3],
    shortName: row[4],
    mode: row[5],
    categories: String(row[6] || '').split('|').filter(Boolean),
    description: row[7],
    source: 'FREQBEACON service/band guide'
  }));

  const hamRanges = hamBands.map((band) => freezeEntry({
    type: 'band',
    startKHz: Number(band.minMHz) * 1000,
    endKHz: Number(band.maxMHz) * 1000,
    name: `${band.name} Amateur Band`,
    shortName: band.short,
    mode: String(band.modes || '').replace(/ · /g, ' / '),
    categories: ['amateur', ...(/SSB|AM/i.test(String(band.modes || '')) ? ['voice'] : []), ...(/digital/i.test(String(band.modes || '')) ? ['digital'] : [])],
    description: band.note || band.character || 'Amateur radio allocation.',
    source: 'FREQBEACON ham-bands.js'
  }));

  const catalog = Object.freeze({
    version: 3,
    generatedFrom: Object.freeze([
      'freqbeacon-zero-am-catalog.js',
      'stations.js static SW schedule seed',
      'ham-bands.js',
      'FREQBEACON fixed-service guide'
    ]),
    receivers: Object.freeze([
      Object.freeze({
        match: 'N2YO',
        name: 'N2YO',
        location: 'Chantilly, Virginia',
        lat: 38.8943,
        lon: -77.4311
      })
    ]),
    stations: Object.freeze([...mappedAm, ...mappedShortwave, ...fixedSignals, ...knownServices, ...cbChannels]),
    ranges: Object.freeze([...hamRanges, ...staticRanges])
  });

  window.FREQBEACON_IDENTIFICATION_CATALOG = catalog;
  // Compatibility alias for the existing Zero UI.
  window.FREQBEACON_ZERO_IDENTIFICATION_CATALOG = catalog;
})();
