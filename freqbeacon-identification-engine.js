(() => {
  'use strict';

  // Shared lookup/ranking engine for Zero and future Lookup/Explore.
  // Synchronous identify() is purely in-memory. identifyAsync() may load one
  // same-origin, build-generated A26 JSON shard when explicitly requested.
  // Nothing here touches sockets, audio, tuning, spectrum, waterfall or polling.
  const catalog = window.FREQBEACON_IDENTIFICATION_CATALOG
    || window.FREQBEACON_ZERO_IDENTIFICATION_CATALOG;
  if (!catalog) return;

  const A26_VERSION = 'a26-55076d0-v1';
  const A26_SHARDS = Object.freeze([
    { minKHz: 2300, maxKHz: 4999.999, path: '/data/identification/a26/sw-2300-4999.json' },
    { minKHz: 5000, maxKHz: 7499.999, path: '/data/identification/a26/sw-5000-7499.json' },
    { minKHz: 7500, maxKHz: 11999.999, path: '/data/identification/a26/sw-7500-11999.json' },
    { minKHz: 12000, maxKHz: 15999.999, path: '/data/identification/a26/sw-12000-15999.json' },
    { minKHz: 16000, maxKHz: 21999.999, path: '/data/identification/a26/sw-16000-21999.json' },
    { minKHz: 22000, maxKHz: 30000, path: '/data/identification/a26/sw-22000-30000.json' }
  ]);
  const shardCache = new Map();

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

  function dayState(days, now = new Date()) {
    const raw = String(days ?? '').trim();
    if (!raw || raw === '1234567' || /^daily$/i.test(raw)) return null;

    // HFCC numeric convention: 1=Monday ... 7=Sunday.
    if (/^[1-7]+$/.test(raw)) {
      const jsDay = now.getUTCDay();
      const hfccDay = jsDay === 0 ? 7 : jsDay;
      return raw.includes(String(hfccDay));
    }

    const compact = raw.replace(/\s+/g, '');
    const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const today = dayNames[now.getUTCDay()];
    if (/^(Mo-Fr)$/i.test(compact)) return !['Sa', 'Su'].includes(today);
    if (/^(Mo-Sa)$/i.test(compact)) return today !== 'Su';
    if (/^(Sa-Su|SaSu)$/i.test(compact)) return ['Sa', 'Su'].includes(today);
    if (/^(Mo|Tu|We|Th|Fr|Sa|Su)+$/i.test(compact)) {
      return compact.toLowerCase().includes(today.toLowerCase());
    }
    return null;
  }

  function scheduleState(entry, now = new Date()) {
    const start = hhmmMinutes(entry?.start);
    const end = hhmmMinutes(entry?.end);
    if (start === null || end === null) return null;
    const scheduledToday = dayState(entry?.days, now);
    if (scheduledToday === false) return { active: false, start, end, dayActive: false };
    if (start === 0 && end === 1440) return { active: true, start, end, dayActive: scheduledToday };

    const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
    const active = start <= end
      ? minute >= start && minute < end
      : minute >= start || minute < end;
    return { active, start, end, dayActive: scheduledToday };
  }

  function amRank(entry, distance, receiver, now) {
    const powerW = stationPowerW(entry, receiver, now);
    if (powerW <= 0) return -Infinity;
    const distancePenalty = Number.isFinite(distance) ? distance : 5000;
    const powerBonus = Math.log10(Math.max(1, powerW)) * 90;
    const classABonus = entry.classA ? 90 : 0;
    return powerBonus + classABonus - distancePenalty;
  }

  function stationRichness(entry) {
    let bonus = 0;
    const source = String(entry.source || '');
    if (/HFCC/.test(source) && /EiBi/.test(source)) bonus += 24;
    else if (/HFCC|EiBi/.test(source)) bonus += 12;
    if (entry.target) bonus += 5;
    if (entry.language && entry.language !== 'Unknown') bonus += 4;
    if (Number.isFinite(entry.lat) && Number.isFinite(entry.lon) && !entry.locationApproximate) bonus += 10;
    return bonus;
  }

  function stationRank(entry, distance, receiver, now) {
    const powerW = Math.max(1, stationPowerW(entry, receiver, now));
    const powerBonus = Math.log10(powerW) * 35;
    const distancePenalty = Number.isFinite(distance)
      ? Math.log10(Math.max(1, distance)) * 38
      : 80;
    const schedule = scheduleState(entry, now);
    const scheduleBonus = schedule?.active === true ? 190 : schedule?.active === false ? -90 : 0;
    return 250 + powerBonus + scheduleBonus + stationRichness(entry) - distancePenalty;
  }

  function exactRank(entry, distance, receiver, now) {
    if (entry.type === 'station' && entry.band === 'MW') return amRank(entry, distance, receiver, now);
    if (entry.type === 'station') return stationRank(entry, distance, receiver, now);
    if (entry.type === 'signal') {
      return 500 - (Number.isFinite(distance) ? Math.log10(Math.max(1, distance)) * 60 : 90);
    }
    if (entry.type === 'channel') return 480;
    if (entry.type === 'service') return 460;
    return 400;
  }

  function candidateKey(entry) {
    if (entry.type !== 'station') return `${entry.type}|${Number(entry.frequencyKHz)}|${String(entry.name || '')}`;
    const normalizedName = String(entry.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    return ['station', Number(entry.frequencyKHz), normalizedName, entry.start || '', entry.end || '', entry.mode || ''].join('|');
  }

  function mergeEntries(extraEntries = []) {
    const combined = [...exactEntries(), ...extraEntries];
    const byKey = new Map();
    for (const entry of combined) {
      const key = candidateKey(entry);
      const existing = byKey.get(key);
      if (!existing || stationRichness(entry) > stationRichness(existing)) byKey.set(key, entry);
    }
    return [...byKey.values()];
  }

  function exactMatch(kHz, receiver, now = new Date(), extraEntries = []) {
    const tolerance = kHz < 2000 ? 0.6 : 0.25;
    const candidates = mergeEntries(extraEntries)
      .filter((entry) => Number.isFinite(Number(entry.frequencyKHz)))
      .filter((entry) => Math.abs(Number(entry.frequencyKHz) - kHz) <= tolerance)
      .map((entry) => {
        const distance = milesBetween(receiver, entry);
        const schedule = scheduleState(entry, now);
        return { entry, distance, schedule, rank: exactRank(entry, distance, receiver, now) };
      })
      .filter((candidate) => {
        if (candidate.entry.type !== 'station' || candidate.entry.band !== 'MW') return Number.isFinite(candidate.rank);
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
    if (best.entry.type === 'station' && (best.entry.band === 'SW' || best.entry.band === 'LW')) {
      confidence = best.schedule?.active === true ? 'likely' : best.schedule?.active === false ? 'cataloged' : 'known';
    }
    if (best.entry.type === 'signal' && candidates.length > 1) confidence = 'likely';
    return { kind: 'exact', ...best, confidence, alternatives: candidates.slice(1) };
  }

  function rangePriority(range) {
    const categories = new Set(range.categories || []);
    if (categories.has('amateur')) return 130;
    if (categories.has('cb')) return 125;
    if (categories.has('aviation')) return 120;
    if (categories.has('maritime') || categories.has('navigation') || categories.has('beacon')) return 115;
    if (range.type === 'broadcast-band') return 110;
    if (range.type === 'service-range') return 100;
    return 0;
  }

  function rangeMatch(kHz) {
    const matches = (catalog.ranges || [])
      .filter((range) => kHz >= Number(range.startKHz) && kHz <= Number(range.endKHz))
      .sort((a, b) =>
        rangePriority(b) - rangePriority(a)
        || (Number(a.endKHz) - Number(a.startKHz)) - (Number(b.endKHz) - Number(b.startKHz))
        || String(a.name || '').localeCompare(String(b.name || ''))
      );
    return matches[0] || null;
  }

  function identifyFromEntries(kHz, options = {}, extraEntries = []) {
    const frequencyKHz = Number(kHz);
    if (!Number.isFinite(frequencyKHz) || frequencyKHz <= 0) return null;
    const receiver = options.receiver || resolveReceiver(options.receiverIdentity || '');
    const now = options.now instanceof Date ? options.now : new Date();
    const exact = exactMatch(frequencyKHz, receiver, now, extraEntries);
    if (exact) return { ...exact, frequencyKHz, receiver };
    const range = rangeMatch(frequencyKHz);
    if (range) return { kind: 'range', range, frequencyKHz, receiver };
    return { kind: 'unknown', frequencyKHz, receiver };
  }

  function identify(kHz, options = {}) {
    return identifyFromEntries(kHz, options);
  }

  function shardFor(kHz) {
    const frequencyKHz = Number(kHz);
    if (!Number.isFinite(frequencyKHz)) return null;
    return A26_SHARDS.find((shard) => frequencyKHz >= shard.minKHz && frequencyKHz <= shard.maxKHz) || null;
  }

  async function loadShard(shard) {
    if (!shard) return [];
    if (!shardCache.has(shard.path)) {
      const promise = fetch(`${shard.path}?v=${A26_VERSION}`, {
        cache: 'force-cache',
        credentials: 'same-origin'
      }).then(async (response) => {
        if (!response.ok) throw new Error(`Static A26 shard failed (${response.status})`);
        const payload = await response.json();
        if (!payload || payload.season !== 'A26' || !Array.isArray(payload.entries)) {
          throw new Error('Static A26 shard is invalid');
        }
        return payload.entries;
      }).catch((error) => {
        shardCache.delete(shard.path);
        throw error;
      });
      shardCache.set(shard.path, promise);
    }
    return shardCache.get(shard.path);
  }

  async function identifyAsync(kHz, options = {}) {
    const shard = shardFor(kHz);
    if (!shard) return identify(kHz, options);
    try {
      const entries = await loadShard(shard);
      return identifyFromEntries(kHz, options, entries);
    } catch (error) {
      console.warn('FREQBEACON static A26 identification fallback:', error);
      return identify(kHz, options);
    }
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
    identifyAsync,
    resolveReceiver,
    milesBetween,
    scheduleState,
    formatFrequency,
    formatRange
  });
})();
