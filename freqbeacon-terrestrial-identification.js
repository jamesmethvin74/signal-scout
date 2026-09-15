(() => {
  'use strict';
  const base = window.FREQBEACON_IDENTIFICATION_ENGINE;
  const terrestrial = [
    ...(Array.isArray(window.FREQBEACON_TERRESTRIAL_CATALOG) ? window.FREQBEACON_TERRESTRIAL_CATALOG : []),
    ...(Array.isArray(window.FREQBEACON_TERRESTRIAL_FALLBACK_CATALOG) ? window.FREQBEACON_TERRESTRIAL_FALLBACK_CATALOG : [])
  ];
  if (!base || !terrestrial.length) return;

  const localHour = (receiver, now) => {
    if (!Number.isFinite(Number(receiver?.lon))) return now.getHours();
    return (now.getUTCHours() + now.getUTCMinutes() / 60 + Number(receiver.lon) / 15 + 24) % 24;
  };
  const isNight = (receiver, now) => { const h = localHour(receiver, now); return h < 6 || h >= 18; };
  const sourceTier = (entry) => Number(entry?.sourceTier) === 1 ? 1 : 3;
  const activeTechnical = (entry, receiver, now) => {
    const night = isNight(receiver, now);
    const lat = Number(night ? entry.nightLat : entry.dayLat);
    const lon = Number(night ? entry.nightLon : entry.dayLon);
    const power = Number(night ? entry.nightPowerW : entry.dayPowerW);
    return {
      ...entry,
      lat: Number.isFinite(lat) ? lat : Number(entry.lat),
      lon: Number.isFinite(lon) ? lon : Number(entry.lon),
      _activePowerW: Number.isFinite(power) ? power : Number(entry.powerW)
    };
  };
  const rank = (entry, receiver, now) => {
    const active = activeTechnical(entry, receiver, now);
    const powerW = Number(active._activePowerW);
    if (Number.isFinite(powerW) && powerW <= 0) return null;
    const distance = base.milesBetween(receiver, active);
    const schedule = base.scheduleState(entry, now);
    const p = Number.isFinite(powerW) && powerW > 0 ? powerW : 1000;
    let score = Math.log10(Math.max(1, p)) * 90 - (Number.isFinite(distance) ? distance : 5000);
    if (sourceTier(entry) === 1) score += 500;
    else score -= 80;
    if (entry.locationApproximate) score -= 120;
    if (entry.band === 'LW') score += 80;
    if (schedule?.active === true) score += 140;
    if (schedule?.active === false) score -= 260;
    return { entry, active, distance, schedule, score };
  };

  function terrestrialExact(kHz, options = {}) {
    if (!Number.isFinite(Number(kHz)) || Number(kHz) >= 2300) return null;
    const receiver = options.receiver || base.resolveReceiver(options.receiverIdentity || '');
    const now = options.now instanceof Date ? options.now : new Date();
    const candidates = terrestrial
      .filter((e) => Math.abs(Number(e.frequencyKHz) - Number(kHz)) <= 0.6)
      .map((e) => rank(e, receiver, now))
      .filter(Boolean)
      .filter((c) => c.score >= (sourceTier(c.entry) === 1 ? -50 : 80))
      .sort((a, b) => b.score - a.score || a.distance - b.distance || sourceTier(a.entry) - sourceTier(b.entry));
    if (!candidates.length) return null;
    const best = candidates[0];
    return {
      kind: 'exact', frequencyKHz: Number(kHz), receiver,
      entry: best.entry, distance: best.distance, schedule: best.schedule,
      confidence: sourceTier(best.entry) === 1 ? 'likely' : (best.schedule?.active === false ? 'cataloged' : 'known'),
      alternatives: candidates.slice(1).map((c) => c.entry)
    };
  }

  function shouldPreferBase(baseResult, terrestrialResult) {
    if (!terrestrialResult) return true;
    if (!baseResult || baseResult.kind !== 'exact') return false;
    const e = baseResult.entry || {};
    if (e.type === 'signal' || e.type === 'service' || e.type === 'channel') return true;
    if (e.type === 'station' && e.sourceAuthority && Number(e.sourceTier) === 1) return true;
    if (e.type === 'station' && /FCC/i.test(String(e.source || ''))) return true;
    return false;
  }

  const identify = (kHz, options = {}) => {
    const existing = base.identify(kHz, options);
    const intl = terrestrialExact(kHz, options);
    return shouldPreferBase(existing, intl) ? existing : intl;
  };
  const identifyAsync = async (kHz, options = {}) => {
    if (Number(kHz) < 2300) return identify(kHz, options);
    return base.identifyAsync(kHz, options);
  };

  window.FREQBEACON_IDENTIFICATION_ENGINE = Object.freeze({ ...base, identify, identifyAsync, terrestrialExact });
})();
