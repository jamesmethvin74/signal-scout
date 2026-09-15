(() => {
  'use strict';

  const currentAm = Array.isArray(window.FREQBEACON_ZERO_AM_CATALOG)
    ? window.FREQBEACON_ZERO_AM_CATALOG
    : [];

  /*
   * Receiver-context catalog v1.
   *
   * This is deliberately a DATA contract, not recommendation logic. Every
   * contextual record carries enough geography/category/source metadata for
   * Lookup to rank it from whichever trusted SDR the listener selected.
   * Coverage is explicit so thin datasets never masquerade as global truth.
   */
  const sportsStationSeeds = [
    {
      type: 'station', frequencyKHz: 1310, callsign: 'KTCK',
      name: 'SportsRadio 96.7 & 1310 The Ticket', location: 'Dallas, Texas', country: 'United States',
      lat: 32.94472, lon: -96.94, mode: 'AM', dayPowerW: 25000, nightPowerW: 5000,
      categories: ['sports'],
      description: 'Dallas–Fort Worth sports radio with local and national sports programming.',
      source: 'FCC AM profile + station public information', sourceRegion: 'north-america'
    },
    {
      type: 'station', frequencyKHz: 1300, callsign: 'KVET',
      name: 'AM 1300 The Zone', location: 'Austin, Texas', country: 'United States',
      lat: 30.375194, lon: -97.716389, mode: 'AM', dayPowerW: 5000, nightPowerW: 1000,
      categories: ['sports'],
      description: 'Austin sports radio and Texas Longhorns flagship programming.',
      source: 'FCC AM license data + station public information', sourceRegion: 'north-america'
    },
    {
      type: 'station', frequencyKHz: 760, callsign: 'KTKR',
      name: 'Ticket 760', location: 'San Antonio, Texas', country: 'United States',
      lat: 29.449444, lon: -98.309167, mode: 'AM', dayPowerW: 50000, nightPowerW: 1000,
      categories: ['sports'],
      description: 'San Antonio sports radio carrying local and national sports programming.',
      source: 'FCC AM license data + station public information', sourceRegion: 'north-america'
    },
    {
      type: 'station', frequencyKHz: 790, callsign: 'KBME',
      name: 'SportsTalk 790', location: 'Houston, Texas', country: 'United States',
      lat: 29.915, lon: -95.461667, mode: 'AM', dayPowerW: 5000, nightPowerW: 5000,
      categories: ['sports'],
      description: 'Houston sports radio carrying local teams and national sports programming.',
      source: 'FCC AM license data + station public information', sourceRegion: 'north-america'
    }
  ];

  const aviationNetworks = [
    {
      id: 'caribbean-a', name: 'Caribbean Family A', badge: 'GULF / CARIBBEAN',
      serviceArea: 'New York Radio · Caribbean Family A', mode: 'USB',
      center: { lat: 24, lon: -76 },
      bounds: { minLat: 8, maxLat: 38, minLon: -105, maxLon: -55 },
      frequencies: [2887, 3455, 5550, 6577, 8846, 11396],
      source: 'FAA aeronautical HF family data', sourceRegion: 'north-america-caribbean'
    },
    {
      id: 'caribbean-b', name: 'Caribbean Family B', badge: 'GULF / CARIBBEAN',
      serviceArea: 'New York Radio · Caribbean Family B', mode: 'USB',
      center: { lat: 24, lon: -76 },
      bounds: { minLat: 8, maxLat: 38, minLon: -105, maxLon: -55 },
      frequencies: [5520, 6586, 8918, 11330, 13297, 17907],
      source: 'FAA aeronautical HF family data', sourceRegion: 'north-america-caribbean'
    },
    {
      id: 'north-atlantic-a', name: 'North Atlantic Family A', badge: 'NORTH ATLANTIC',
      serviceArea: 'New York Radio · North Atlantic Family A', mode: 'USB',
      center: { lat: 46, lon: -38 },
      bounds: { minLat: 34, maxLat: 65, minLon: -80, maxLon: 5 },
      frequencies: [3016, 5598, 8906, 13306, 17946, 21964],
      source: 'FAA aeronautical HF family data', sourceRegion: 'north-atlantic'
    },
    {
      id: 'north-atlantic-e', name: 'North Atlantic Family E', badge: 'NORTH ATLANTIC',
      serviceArea: 'New York Radio · North Atlantic Family E', mode: 'USB',
      center: { lat: 46, lon: -38 },
      bounds: { minLat: 34, maxLat: 65, minLon: -80, maxLon: 5 },
      frequencies: [2962, 6628, 8825, 11309, 13354, 17952],
      source: 'FAA aeronautical HF family data', sourceRegion: 'north-atlantic'
    },
    {
      id: 'central-east-pacific', name: 'Central East Pacific', badge: 'PACIFIC PATH',
      serviceArea: 'San Francisco Radio · Central East Pacific', mode: 'USB',
      center: { lat: 30, lon: -135 },
      bounds: { minLat: 5, maxLat: 55, minLon: -170, maxLon: -105 },
      frequencies: [3413, 3452, 5574, 5667, 6673, 8843, 10057, 11330, 13354],
      source: 'FAA aeronautical HF family data', sourceRegion: 'north-pacific'
    },
    {
      id: 'north-pacific', name: 'North Pacific', badge: 'PACIFIC PATH',
      serviceArea: 'San Francisco Radio · North Pacific', mode: 'USB',
      center: { lat: 45, lon: -155 },
      bounds: { minLat: 25, maxLat: 70, minLon: -180, maxLon: -105 },
      frequencies: [2932, 5628, 6655, 8915, 8951, 10048, 11330, 13273, 13339, 17946, 21925],
      source: 'FAA aeronautical HF family data', sourceRegion: 'north-pacific'
    },
    {
      id: 'central-west-pacific', name: 'Central West Pacific', badge: 'PACIFIC PATH',
      serviceArea: 'San Francisco Radio · Central West Pacific', mode: 'USB',
      center: { lat: 18, lon: 160 },
      bounds: { minLat: -5, maxLat: 45, minLon: 130, maxLon: 180 },
      frequencies: [2998, 4666, 6532, 8903, 11384, 13300, 17904, 21985],
      source: 'FAA aeronautical HF family data', sourceRegion: 'west-pacific'
    }
  ];

  const coverage = Object.freeze({
    sports: Object.freeze({
      receiverContext: 'global',
      catalogScope: 'partial',
      note: 'Receiver ranking works worldwide; current local sports-AM station metadata is strongest in the United States and will expand by country.'
    }),
    aviation: Object.freeze({
      receiverContext: 'global',
      catalogScope: 'partial',
      note: 'Receiver ranking works worldwide; mapped civil HF families currently cover North Atlantic, Caribbean and Pacific sectors, with global HFGCS fallback.'
    }),
    shortwaveBroadcast: Object.freeze({
      receiverContext: 'global',
      catalogScope: 'global-schedule',
      note: 'HFCC/EiBi A26 schedule data is ranked from the selected receiver location and current time.'
    })
  });

  const freezeStation = (station) => Object.freeze({
    ...station,
    categories: Object.freeze([...(station.categories || [])])
  });
  const freezeNetwork = (network) => Object.freeze({
    ...network,
    center: Object.freeze({ ...network.center }),
    bounds: Object.freeze({ ...network.bounds }),
    frequencies: Object.freeze([...network.frequencies])
  });

  const keyFor = (station) => `${Number(station?.frequencyKHz || 0).toFixed(3)}|${String(station?.callsign || '').toUpperCase()}`;
  const seen = new Set(currentAm.map(keyFor));
  const mergedAm = [...currentAm];
  for (const station of sportsStationSeeds) {
    if (seen.has(keyFor(station))) continue;
    mergedAm.push(freezeStation(station));
    seen.add(keyFor(station));
  }

  const frozenSportsSeeds = Object.freeze(sportsStationSeeds.map(freezeStation));
  const frozenAviation = Object.freeze(aviationNetworks.map(freezeNetwork));

  window.FREQBEACON_CONTEXT_CATALOG = Object.freeze({
    version: 1,
    coverage,
    sportsStationSeeds: frozenSportsSeeds,
    aviationNetworks: frozenAviation
  });

  // Preserve the existing Zero identification contract while allowing the
  // contextual catalog to grow independently.
  window.FREQBEACON_ZERO_AM_CATALOG = Object.freeze(mergedAm);
})();
