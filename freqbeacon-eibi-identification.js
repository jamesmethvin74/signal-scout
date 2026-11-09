(() => {
  'use strict';
  // EiBi is a server-cached schedule candidate source, NOT receiver RF proof.
  // Never fetch EiBi directly from the listener's browser.
  const engine = window.FREQBEACON_IDENTIFICATION_ENGINE;
  if (!engine || typeof engine.identifyAsync !== 'function') return;
  const originalAsync = engine.identifyAsync.bind(engine);

  function station(row, season) {
    const utility = row.type === 'service';
    const name = String(row.name || '').trim();
    return {
      type: utility ? 'service' : 'station',
      band: 'SW', frequencyKHz: Number(row.frequencyKHz),
      name, mode: utility ? 'Varies' : 'AM',
      country: row.itu || '', location: row.itu ? 'Origin: ' + row.itu : '',
      language: row.language || '', start: row.start, end: row.end, days: row.days,
      target: row.target || '',
      categories: utility ? ['shortwave','utility'] : ['shortwave','broadcast','international'],
      description: 'EiBi ' + season + ' schedule: ' + row.start + '–' + row.end
        + ' UTC' + (row.days ? ' (' + row.days + ')' : '')
        + (row.target ? '. Target: ' + row.target : '')
        + (row.remarks ? '. Transmitter/remarks: ' + row.remarks : '')
        + '. Scheduled service, not confirmation of live RF reception or an exact program.',
      source: 'EiBi ' + season + ' — Eike Bierwirth (eibispace.de)',
      scheduleSource: 'eibi', season
    };
  }

  async function identifyAsync(kHz, options = {}) {
    const frequency = Number(kHz);
    if (!Number.isFinite(frequency) || frequency < 2300 || frequency > 30000) {
      return originalAsync(kHz, options);
    }
    try {
      const at = options.now instanceof Date ? options.now : new Date();
      const url = '/api/eibi/identify?frequency=' + encodeURIComponent(frequency.toFixed(3))
        + '&at=' + encodeURIComponent(at.toISOString());
      const response = await fetch(url, {credentials:'same-origin', cache:'no-store',
        signal:AbortSignal.timeout(5500)});
      if (response.ok) {
        const data = await response.json();
        if (data?.status === 'ok' && Array.isArray(data.matches)) {
          const current = data.matches.filter(row => row.active === true);
          // Never mark an unknown-day or future schedule as ON NOW.
          if (current.length) {
            const exact = current.filter(row => Math.abs(Number(row.frequencyKHz)-frequency) <= 2.5);
            if (exact.length) {
              const candidate = exact[0];
              const entry = station(candidate, data.season);
              const other = exact.slice(1, 7).map(r => ({
                entry: station(r, data.season),
                distance: Infinity,
                schedule: {active:true,start:r.start,end:r.end}
              }));
              return {
                kind:'exact', frequencyKHz:frequency, entry, alternatives:other,
                receiver:options.receiver || engine.resolveReceiver(options.receiverIdentity || ''),
                distance: Infinity, schedule:{active:true,start:candidate.start,end:candidate.end},
                confidence:'known', provenance:'EiBi', scheduleUpdatedAt:data.updatedAt
              };
            }
          }
        }
      }
    } catch (error) {
      console.warn('FREQBEACON EiBi daily schedule unavailable; keeping existing identification:', error?.message || error);
    }
    return originalAsync(kHz, options);
  }

  window.FREQBEACON_IDENTIFICATION_ENGINE = Object.freeze({...engine, identifyAsync});
})();