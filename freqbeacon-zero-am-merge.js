(() => {
  'use strict';

  const curated = Array.isArray(window.FREQBEACON_ZERO_AM_CATALOG)
    ? window.FREQBEACON_ZERO_AM_CATALOG
    : [];
  const fcc = Array.isArray(window.FREQBEACON_ZERO_US_AM_FCC_CATALOG)
    ? window.FREQBEACON_ZERO_US_AM_FCC_CATALOG
    : [];

  // Local/static development keeps the curated catalog if the build-time FCC
  // generator has not run. Production builds are guarded by the generator's
  // minimum-count validation, so an incomplete FCC fetch cannot silently ship.
  if (!fcc.length) return;

  const stationKey = (station) => `${Number(station?.frequencyKHz)}|${String(station?.callsign || '').trim().toUpperCase()}`;
  const curatedByKey = new Map(curated.map((station) => [stationKey(station), station]));
  const merged = [];
  let overlayCount = 0;

  for (const station of fcc) {
    const key = stationKey(station);
    const overlay = curatedByKey.get(key);
    if (!overlay) {
      merged.push(station);
      continue;
    }

    curatedByKey.delete(key);
    overlayCount += 1;
    merged.push(Object.freeze({
      ...station,
      name: overlay.name || station.name,
      categories: Object.freeze([...(overlay.categories || station.categories || ['broadcast'])]),
      description: overlay.description || station.description,
      source: `${station.source}; FREQBEACON curated programming overlay`
    }));
  }

  // Preserve any curated entries not present in the FCC build as a safety net.
  // They remain visibly sourced as curated data rather than pretending to be
  // regulator records.
  for (const station of curatedByKey.values()) merged.push(station);

  merged.sort((a, b) =>
    Number(a.frequencyKHz) - Number(b.frequencyKHz)
    || String(a.callsign || '').localeCompare(String(b.callsign || ''))
  );

  window.FREQBEACON_ZERO_AM_CATALOG = Object.freeze(merged);
  window.FREQBEACON_ZERO_AM_META = Object.freeze({
    source: 'FCC technical catalog + FREQBEACON curated programming overlays',
    fccStationCount: fcc.length,
    curatedOverlayCount: overlayCount,
    curatedFallbackCount: curatedByKey.size,
    stationCount: merged.length
  });
})();
