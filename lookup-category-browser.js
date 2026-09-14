(() => {
  'use strict';

  const catalog = window.FREQBEACON_IDENTIFICATION_CATALOG || window.FREQBEACON_ZERO_IDENTIFICATION_CATALOG;
  const engine = window.FREQBEACON_IDENTIFICATION_ENGINE;
  const hamBands = Array.isArray(window.SIGNAL_SCOUT_HAM_BANDS) ? window.SIGNAL_SCOUT_HAM_BANDS : [];
  const shell = document.querySelector('#lookupCategoryBrowser');
  const chips = shell?.querySelector('[data-category-chips]');
  const stage = document.querySelector('#lookupResults');
  const count = document.querySelector('#lookupResultCount');
  const status = document.querySelector('#lookupStatus');
  const resultsTitle = document.querySelector('#lookupResultsTitle');
  if (!catalog || !engine || !shell || !chips || !stage || !count) return;

  const SHARDS = [
    '/data/identification/a26/sw-2300-4999.json',
    '/data/identification/a26/sw-5000-7499.json',
    '/data/identification/a26/sw-7500-11999.json',
    '/data/identification/a26/sw-12000-15999.json',
    '/data/identification/a26/sw-16000-21999.json',
    '/data/identification/a26/sw-22000-30000.json'
  ];

  const STATE_BROADCASTERS = /china radio international|voice of korea|radio pyongyang|radio havana|voice of america|radio romania international|radio exterior de españa|bbc world service|rnz pacific|radio france internationale|deutsche welle|voice of turkey|kbs world|nhk world/;
  const RELIGIOUS = /relig|gospel|bible|catholic|christian|adventist|ministry|ministries|evangel/;
  const DIGITAL = /digital|ft8|rtty|packet|data|sstv|navtex|fsk|drm/;

  const CATEGORY_DEFS = Object.freeze({
    news: { label: 'News', broadcast: true, match: (entry, text, cats) => cats.has('news') || /news|world service|current affairs/.test(text) },
    sports: { label: 'Sports', broadcast: true, match: (entry, text, cats) => cats.has('sports') || /\bsports?\b/.test(text) },
    religious: { label: 'Religious', broadcast: true, match: (entry, text, cats) => cats.has('religious') || RELIGIOUS.test(text) },
    propaganda: { label: 'Propaganda', broadcast: true, match: (entry, text, cats) => cats.has('state-broadcaster') || STATE_BROADCASTERS.test(text) },
    international: { label: 'International', broadcast: true, match: (entry, text, cats) => cats.has('international') || /international|world service/.test(text) },
    utility: { label: 'Utility', activity: true, match: (entry, text, cats) => cats.has('utility') },
    'amateur-voice': { label: 'Amateur Voice', activity: true, ham: true, match: (entry, text, cats) => cats.has('amateur') && cats.has('voice') },
    digital: { label: 'Digital', activity: true, ham: true, match: (entry, text, cats) => cats.has('digital') || DIGITAL.test(text) },
    aviation: { label: 'Aviation', activity: true, match: (entry, text, cats) => cats.has('aviation') },
    cb: { label: 'CB', activity: true, match: (entry, text, cats) => cats.has('cb') || String(entry?.band || '').toUpperCase() === 'CB' }
  });

  let generatedEntries = null;
  let selectedKey = '';
  let selectedEntries = [];
  let displayLimit = 12;

  function esc(value) {
    return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  }

  function entryText(entry) {
    return [entry?.name, entry?.callsign, entry?.format, entry?.description, entry?.note, entry?.country, entry?.language, entry?.mode]
      .filter(Boolean).join(' ').toLowerCase();
  }

  function catsFor(entry) {
    return new Set((entry?.categories || []).map((value) => String(value).toLowerCase()));
  }

  function generatedCategories(entry) {
    const text = entryText(entry);
    const cats = new Set((entry.categories || []).map((value) => String(value).toLowerCase()));
    cats.add('shortwave');
    cats.add('broadcast');
    if (/international|world service|radio exterior|radio romania|china radio|voice of|rnz|bbc/.test(text)) cats.add('international');
    if (/news|world service|current affairs/.test(text)) cats.add('news');
    if (RELIGIOUS.test(text)) cats.add('religious');
    if (/\bsports?\b/.test(text)) cats.add('sports');
    if (STATE_BROADCASTERS.test(text)) cats.add('state-broadcaster');
    if (DIGITAL.test(text)) cats.add('digital');
    return [...cats];
  }

  async function loadGeneratedEntries() {
    if (generatedEntries) return generatedEntries;
    const responses = await Promise.allSettled(SHARDS.map(async (url) => {
      const response = await fetch(url, { cache: 'force-cache', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`${response.status}`);
      const payload = await response.json();
      return Array.isArray(payload?.entries) ? payload.entries : [];
    }));
    generatedEntries = responses.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
      .map((entry) => ({ ...entry, type: entry.type || 'station', categories: generatedCategories(entry) }));
    return generatedEntries;
  }

  function hamQuickEntries() {
    const entries = [];
    for (const band of hamBands) {
      const modes = String(band.modes || '').toLowerCase();
      for (const tune of (Array.isArray(band.quickTunes) ? band.quickTunes : [])) {
        const label = String(tune.label || 'Activity');
        const text = `${label} ${modes}`.toLowerCase();
        const digital = DIGITAL.test(label.toLowerCase());
        const nonVoice = /\bcw\b|beacon/.test(label.toLowerCase()) || digital;
        const voice = /ssb|\bam\b|\busb\b|\blsb\b|phone|voice/.test(text) && !nonVoice;
        const categories = ['amateur', ...(voice ? ['voice'] : []), ...(digital ? ['digital'] : [])];
        if (!voice && !digital) continue;
        entries.push({
          type: 'channel',
          band: 'HAM',
          frequencyKHz: Number(tune.frequencyMHz) * 1000,
          name: `${band.short} · ${label}`,
          mode: String(tune.mode || 'usb').toUpperCase(),
          categories,
          description: band.note || band.character || 'Amateur radio activity target.',
          source: 'FREQBEACON ham quick tune'
        });
      }
    }
    return entries;
  }

  function entryFrequency(entry) {
    const value = Number(entry?.frequencyKHz ?? entry?.frequency);
    return Number.isFinite(value) ? value : NaN;
  }

  function categoryMatches(entry, key = selectedKey) {
    if (!key) return true;
    const def = CATEGORY_DEFS[key];
    return Boolean(def && def.match(entry, entryText(entry), catsFor(entry)));
  }

  function dedupe(entries) {
    const seen = new Set();
    return entries.filter((entry) => {
      const frequency = entryFrequency(entry);
      if (!Number.isFinite(frequency) || frequency < 30 || frequency > 30000) return false;
      const key = `${frequency.toFixed(3)}|${String(entry.name || entry.callsign || '').toLowerCase()}|${entry.start || ''}|${entry.end || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function inferredMode(entry, frequencyKHz) {
    const mode = String(entry?.mode || '').toLowerCase();
    if (mode.includes('usb')) return 'usb';
    if (mode.includes('lsb')) return 'lsb';
    if (mode.includes('nbfm') || mode === 'fm') return 'nbfm';
    if (mode.includes('cw') && !mode.includes('am')) return 'cw';
    const cats = catsFor(entry);
    if (cats.has('amateur')) return frequencyKHz < 10000 ? 'lsb' : 'usb';
    return 'am';
  }

  function scheduleState(entry, now) {
    try { return engine.scheduleState?.(entry, now) || null; }
    catch { return null; }
  }

  function receiverDistance(entry, receiver) {
    if (!Number.isFinite(Number(entry?.lat)) || !Number.isFinite(Number(entry?.lon))) return Infinity;
    try {
      return engine.milesBetween?.(
        { lat: Number(receiver.lat), lon: Number(receiver.lon) },
        { lat: Number(entry.lat), lon: Number(entry.lon) }
      ) ?? Infinity;
    } catch {
      return Infinity;
    }
  }

  function candidateScore(entry, receiver, now, def) {
    const frequency = entryFrequency(entry);
    const schedule = scheduleState(entry, now);
    const distance = receiverDistance(entry, receiver);
    let score = 0;

    if (schedule?.active === true) score += 1200;
    else if (schedule?.active === false && def.broadcast) score -= 1800;
    else if (entry.type === 'station') score += 180;
    else score += 120;

    if (Number.isFinite(distance)) {
      const mwLike = String(entry.band || '').toUpperCase() === 'MW' || frequency < 2000;
      if (mwLike) {
        if (distance > 2200) score -= 1000;
        score += Math.max(-500, 520 - distance * .42);
      } else {
        score += Math.max(-150, 210 - Math.log10(Math.max(1, distance)) * 62);
      }
    }

    if (entry.type === 'signal' || entry.type === 'channel' || entry.type === 'service') score += 90;
    if (entry.language && entry.language !== 'Unknown') score += 15;
    if (entry.target) score += 12;
    return { score, schedule, distance };
  }

  function tuneHref(entry) {
    const frequency = entryFrequency(entry);
    return `/zero?frequency=${encodeURIComponent(frequency.toFixed(3))}&mode=${encodeURIComponent(inferredMode(entry, frequency))}&from=lookup-category`;
  }

  function activityLabel(item, def) {
    if (item.schedule?.active === true) return 'ON NOW';
    if (def.activity) return 'KNOWN ACTIVITY';
    return 'LIKELY';
  }

  function card(item, receiver, def) {
    const entry = item.entry;
    const frequency = entryFrequency(entry);
    const place = entry.transmitter || entry.location || entry.country || '';
    const distance = Number.isFinite(item.distance) ? `${Math.round(item.distance).toLocaleString()} mi from receiver` : '';
    const details = [entry.language, entry.mode, place, distance].filter(Boolean).join(' · ');
    const label = activityLabel(item, def);
    return `<article class="lookup-category-result">
      <div class="lookup-category-copy">
        <div class="lookup-category-result-top">
          <strong>${esc(entry.name || entry.callsign || 'Known signal')}</strong>
          <span class="lookup-status-pill ${label === 'ON NOW' ? 'is-now' : ''}"><i aria-hidden="true"></i>${esc(label)}</span>
        </div>
        <span class="lookup-category-frequency">${esc(engine.formatFrequency(frequency))}</span>
        <small>${esc(details || entry.description || 'FREQBEACON catalog entry')}</small>
      </div>
      <a class="lookup-tune" href="${esc(tuneHref(entry))}">TUNE ON RADIO</a>
    </article>`;
  }

  function paintSelection() {
    chips.querySelectorAll('[data-category]').forEach((button) => {
      const selected = button.dataset.category === selectedKey;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  async function browse(receiver, context = {}) {
    const def = CATEGORY_DEFS[selectedKey];
    if (!def || !receiver || !Number.isFinite(Number(receiver.lat)) || !Number.isFinite(Number(receiver.lon))) return false;

    displayLimit = Math.max(12, displayLimit);
    if (resultsTitle) resultsTitle.textContent = `${def.label.toUpperCase()} ON THIS RECEIVER`;
    count.textContent = def.label;
    stage.innerHTML = '<div class="lookup-loading">BUILDING RECEIVER-AWARE FREQUENCY LIST…</div>';
    if (status) {
      status.className = 'lookup-status is-working';
      status.textContent = `Finding ${def.label.toLowerCase()} frequencies for ${receiver.location}…`;
    }

    const base = Array.isArray(catalog.entries) ? catalog.entries : (Array.isArray(catalog.stations) ? catalog.stations : []);
    let entries = [...base];
    if (def.ham) entries.push(...hamQuickEntries());
    if (def.broadcast) {
      try { entries.push(...await loadGeneratedEntries()); }
      catch (error) { console.warn('FREQBEACON category catalog expansion failed:', error); }
    }

    const now = new Date();
    selectedEntries = dedupe(entries.filter((entry) => categoryMatches(entry, selectedKey)))
      .map((entry) => ({ entry, ...candidateScore(entry, receiver, now, def) }))
      .filter((item) => def.broadcast ? item.schedule?.active !== false : true)
      .filter((item) => item.score > -600)
      .sort((a, b) => b.score - a.score || a.distance - b.distance || entryFrequency(a.entry) - entryFrequency(b.entry));

    renderCategory(receiver, def);
    if (status) {
      status.className = 'lookup-status';
      status.textContent = def.broadcast
        ? `${def.label} · on-now and receiver-ranked frequencies for ${receiver.name}`
        : `${def.label} · known activity frequencies to try on ${receiver.name}`;
    }
    return true;
  }

  function renderCategory(receiver, def = CATEGORY_DEFS[selectedKey]) {
    if (!def) return;
    const visible = selectedEntries.slice(0, displayLimit);
    count.textContent = `${selectedEntries.length.toLocaleString()} ${def.label} frequenc${selectedEntries.length === 1 ? 'y' : 'ies'}`;
    stage.innerHTML = visible.length
      ? `${visible.map((item) => card(item, receiver, def)).join('')}${visible.length < selectedEntries.length ? '<button class="lookup-category-more" type="button" data-category-more>SHOW MORE</button>' : ''}`
      : `<div class="lookup-empty"><strong>No ${esc(def.label)} frequencies found.</strong><p>FREQBEACON does not currently have a receiver-relevant ${esc(def.label.toLowerCase())} candidate for ${esc(receiver.location)}.</p></div>`;
    stage.querySelector('[data-category-more]')?.addEventListener('click', () => {
      displayLimit += 12;
      renderCategory(receiver, def);
    });
  }

  function setSelection(key) {
    selectedKey = CATEGORY_DEFS[key] ? key : '';
    displayLimit = 12;
    window.FREQBEACON_LOOKUP_SELECTED_CATEGORY = selectedKey;
    paintSelection();
    window.dispatchEvent(new CustomEvent('freqbeacon:lookup-filter-change', {
      detail: { category: selectedKey }
    }));
  }

  chips.addEventListener('click', (event) => {
    const button = event.target.closest('[data-category]');
    if (!button) return;
    const key = button.dataset.category || '';
    setSelection(selectedKey === key ? '' : key);
  });

  window.FREQBEACON_LOOKUP_CATEGORIES = Object.freeze({
    defs: CATEGORY_DEFS,
    matches: categoryMatches,
    selected: () => selectedKey,
    browse,
    clearSelection() { setSelection(''); }
  });
})();