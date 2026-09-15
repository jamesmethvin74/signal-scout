(() => {
  'use strict';

  const current = Array.isArray(window.FREQBEACON_ZERO_AM_CATALOG)
    ? window.FREQBEACON_ZERO_AM_CATALOG
    : [];

  // Current Texas sports-AM core, verified against FCC/public station sources
  // in September 2026. This small supplement exists so receiver-aware Lookup
  // can recommend actual nearby sports radio instead of treating Sports as an
  // HF-only schedule category.
  const additions = [
    {
      type: 'station',
      frequencyKHz: 1310,
      callsign: 'KTCK',
      name: 'SportsRadio 96.7 & 1310 The Ticket',
      location: 'Dallas, Texas',
      lat: 32.94472,
      lon: -96.94,
      mode: 'AM',
      dayPowerW: 25000,
      nightPowerW: 5000,
      categories: ['sports'],
      description: 'Dallas–Fort Worth sports radio with local Cowboys, Rangers, Mavericks and Stars coverage plus national sports programming.',
      source: 'FCC AM profile + The Ticket station information'
    },
    {
      type: 'station',
      frequencyKHz: 1300,
      callsign: 'KVET',
      name: 'AM 1300 The Zone',
      location: 'Austin, Texas',
      lat: 30.375194,
      lon: -97.716389,
      mode: 'AM',
      dayPowerW: 5000,
      nightPowerW: 1000,
      categories: ['sports'],
      description: 'Austin sports radio and flagship home of the Texas Longhorns radio network.',
      source: 'FCC AM license data + Texas Athletics'
    },
    {
      type: 'station',
      frequencyKHz: 760,
      callsign: 'KTKR',
      name: 'Ticket 760',
      location: 'San Antonio, Texas',
      lat: 29.449444,
      lon: -98.309167,
      mode: 'AM',
      dayPowerW: 50000,
      nightPowerW: 1000,
      categories: ['sports'],
      description: 'San Antonio sports radio carrying local and national sports programming, including UTSA coverage.',
      source: 'FCC AM license data + Texas Association of Broadcasters'
    },
    {
      type: 'station',
      frequencyKHz: 790,
      callsign: 'KBME',
      name: 'SportsTalk 790',
      location: 'Houston, Texas',
      lat: 29.915,
      lon: -95.461667,
      mode: 'AM',
      dayPowerW: 5000,
      nightPowerW: 5000,
      categories: ['sports'],
      description: 'Houston sports radio carrying Astros, Rockets, Texas Longhorns and national sports programming.',
      source: 'FCC AM license data + SportsTalk 790 public station information'
    }
  ];

  const keyFor = (station) => `${Number(station?.frequencyKHz || 0).toFixed(3)}|${String(station?.callsign || '').toUpperCase()}`;
  const seen = new Set(current.map(keyFor));
  const merged = [...current];

  for (const station of additions) {
    if (seen.has(keyFor(station))) continue;
    merged.push(Object.freeze({
      ...station,
      categories: Object.freeze([...station.categories])
    }));
  }

  window.FREQBEACON_ZERO_AM_CATALOG = Object.freeze(merged);
})();
