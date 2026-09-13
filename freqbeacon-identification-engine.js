(() => {
  'use strict';

  // Pure local lookup/ranking engine shared by Zero and future Lookup/Explore.
  // No DOM reads, sockets, network calls, schedule fetches, polling or tuning.
  const catalog = window.FREQBEACON_IDENTIFICATION_CATALOG
    || window.FREQBEACON_ZERO_IDENTIFICATION_CATALOG;
  if (!catalog) return;

  const exactEntries = () => catalog.entries || catalog.stations || [];

  function resolveReceiver(identity) {
    const text = String(identity || '').trim();
    const upper = text.toUpperCase();
    const known = (catalog.receivers || []).find((receiver) =>
      upper.includes(String(receiver.match || '').toUpperCase())
    );
    return known ? { ...known, identity: text } : { identity: text };
  }

  function milesBetween(a, b) {
    if (![a?.lat, a?.lon, b?.lat, b?.lon].every(Number.isFinite)) return Infinity;
    const radians = Math.PI / 180;
    const dLat = (b.lat - a.lat) * radians;
    const dLon = (b.lon - a.lon) * radians;
    const x = Math.sin(dLat / 2) ** 2
      + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2;
    return 2 * 3958.8 * Math.asin(Math.sqrt(x));
  }

  function receiverLocalHour(receiver, now = new Date()) {
    if (!Number.isFinite(receiver?.lon)) return now.getHours();
    const utcHour = now.getUTCHours() + now.getUTCMinutes() / 60;
    return (utcHour + receiver.lon / 15 + 24) % 24;
  }

  function stationPowerW(entry, receiver, now = new Date()) {
    if (Number.isFinite(Number(entry.powerW))) return Number(entry.powerW);
    const localHour = receiverLocalHour(receiver, now);
    const night = localHour < 6 || localHour >= 18;
    const primary = night ? Number(entry.nightPowerW) : Number(entry.dayPowerW);
    if (Number.isFinite(primary)) return primary;
    const fallback = night ? Number(entry.dayPowerW) : Number(entry.nightPowerW);
    return Number.isFinite(fallback) ? fallback : 1000;
  }

  function hhmmMinutes(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    const clean = raw.replace(/[^0-9]/g, '').padStart(4, '0');
    if (!clean || clean.length > 4) return null;
    const hours = Number(clean.slice(0, 2));
    const minutes = Number(clean.slice(2));
    if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes > 59 || hours > 24) return null;
    if (hours === 24 && minutes !== 0) return null;
    return hours * 60 + minutes;
  }

  function scheduleState(entry, now = new Date()) {
    const start = hhmmMinutes(entry?.start);
    const end = hhmmMinutes(entry?.end);
    if (start === null || end === null) return null;
    if (start === 0 && end === 1440) return { active: true, start, end };

    const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
    const active = start <= end
      ? minute >= start && minute < end
      : minute >= start || minute < end;
    return { active, start, end };
  }

  function amRank(entry, distance, receiver, now) {
    const powerW = stationPowerW(entry, receiver, now);
    if (powerW <= 0) return -Infinity;
    const distancePenalty = Number.isFinite(distance) ? distance : 5000;
    const powerBonus = Math.log10(Math.max(1, powerW)) * 90;
    const classABonus = entry.classA ? 90 : 0;
    return powerBonus + classABonus - distancePenalty;
  }

  function hfStationRank(entry, distance, receiver, now) {
    const powerW = Math.max(1, stationPowerW(entry, receiver, now));
    const powerBonus = Math.log10(powerW) * 35;
    const distancePenalty = Number.isFinite(distance)
      ? Math.log10(Math.max(1, distance)) * 38
      : 80;
    const schedule = scheduleState(entry, now);
    const scheduleBonus = schedule?.active === true ? 150 : schedule?.active === false ? -30 : 0;
    return 250 + powerBonus + scheduleBonus - distancePenalty;
  }

  function exactRank(entry, distance, receiver, now) {
    if (entry.type === 'station' && entry.band === 'MW') {
      return amRank(entry, distance, receiver, now);
    }
    if (entry.type === 'station') {
      return hfStationRank(entry, distance, receiver, now);
    }
    if (entry.type === 'signal') {
      return 500 - (Number.isFinite(distance) ? Math.log10(Math.max(1, distance)) * 60 : 90);
    }
    if (entry.type === 'channel') return 480;
    if (entry.type === 'service') return 460;
    return 400;
  }

  function exactMatch(kHz, receiver, now = new Date()) {
    const tolerance = kHz < 2000 ? 0.6 : 0.25;
    const candidates = exactEntries()
      .filter((entry) => Number.isFinite(Number(entry.frequencyKHz)))
      .filter((entry) => Math.abs(Number(entry.frequencyKHz) - kHz) <= tolerance)
      .map((entry) => {
        const distance = milesBetween(receiver, entry);
        const schedule = scheduleState(entry, now);
        return {
          entry,
          distance,
          schedule,
          rank: exactRank(entry, distance, receiver, now)
        };
      })
      .filter((candidate) => {
        if (candidate.entry.type !== 'station' || candidate.entry.band !== 'MW') return Number.isFinite(candidate.rank);
        // Preserve the existing AM plausibility floor: an incomplete catalog
        // must not confidently label a weak distant same-frequency station.
        return Number.isFinite(candidate.rank) && candidate.rank >= -175;
      })
      .sort((a, b) =>
        b.rank - a.rank
        || a.distance - b.distance
        || String(a.entry.name || '').localeCompare(String(b.entry.name || ''))
      );

    if (!candidates.length) return null;
    const best = candidates[0];
    let confidence = 'known';
    if (best.entry.type === 'station' && best.entry.band === 'MW') confidence = 'likely';
    if (best.entry.type === 'station' && best.entry.band === 'SW') {
      confidence = best.schedule?.active === false ? 'known' : 'likely';
    }
    if (best.entry.type === 'signal' && candidates.length > 1) confidence = 'likely';

    return {
      kind: 'exact',
      ...best,
      confidence,
      alternatives: candidates.slice(1)
    };
  }

  function rangeMatch(kHz) {
    const matches = (catalog.ranges || [])
      .filter((range) => kHz >= Number(range.startKHz) && kHz <= Number(range.endKHz))
      .sort((a, b) =>
        (Number(a.endKHz) - Number(a.startKHz))
        - (Number(b.endKHz) - Number(b.startKHz))
        || String(a.name || '').localeCompare(String(b.name || ''))
      );
    return matches[0] || null;
  }

  function identify(kHz, options = {}) {
    const frequencyKHz = Number(kHz);
    if (!Number.isFinite(frequencyKHz) || frequencyKHz <= 0) return null;
    const receiver = options.receiver || resolveReceiver(options.receiverIdentity || '');
    const now = options.now instanceof Date ? options.now : new Date();
    const exact = exactMatch(frequencyKHz, receiver, now);
    if (exact) return { ...exact, frequencyKHz, receiver };

    const range = rangeMatch(frequencyKHz);
    if (range) return { kind: 'range', range, frequencyKHz, receiver };
    return { kind: 'unknown', frequencyKHz, receiver };
  }

  function formatFrequency(kHz) {
    const value = Number(kHz);
    if (!Number.isFinite(value)) return 'Unknown frequency';
    if (value < 1000) {
      const decimals = Math.abs(value - Math.round(value)) < 0.001 ? 0 : 1;
      return `${value.toFixed(decimals)} kHz`;
    }
    const decimals = Math.abs(value - Math.round(value)) < 0.001 ? 3 : 4;
    return `${(value / 1000).toFixed(decimals)} MHz`;
  }

  function formatRange(range) {
    return `${formatFrequency(Number(range.startKHz))}–${formatFrequency(Number(range.endKHz))}`;
  }

  window.FREQBEACON_IDENTIFICATION_ENGINE = Object.freeze({
    identify,
    resolveReceiver,
    milesBetween,
    scheduleState,
    formatFrequency,
    formatRange
  });
})();
