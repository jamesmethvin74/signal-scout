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
    utility: { label: 'Utility', match: (entry, text, cats) => cats.has('utility') },
    'amateur-voice': { label: 'Amateur Voice', ham: true, match: (entry, text, cats) => cats.has('amateur') && cats.has('voice') },
    digital: { label: 'Digital', ham: true, match: (entry, text, cats) => cats.has('digital') || DIGITAL.test(text) },
    aviation: { label: 'Aviation', match: (entry, text, cats) => cats.has('aviation') },
    cb: { label: 'CB', match: (entry, text, cats) => cats.has('cb') || String(entry.band || '').toUpperCase() === 'CB' }
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
          source: 'FREQBEACON ham-bands.js quick tune'
        });
      }
    }
    return entries;
  }

  function entryFrequency(entry) {
    const value = Number(entry?.frequencyKHz ?? entry?.frequency);
    return Number.isFinite(value) ? value : NaN;
  }

  function dedupe(entries) {
    const seen = new Set();
    return entries.filter((entry) => {
      const frequency = entryFrequency(entry);
      if (!Number.isFinite(frequency)) return false;
      const key = `${frequency.toFixed(3)}|${String(entry.name || entry.callsign || '').toLowerCase()}|${entry.start || ''}|${entry.end || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function scheduleActive(entry) {
    return engine.scheduleState?.(entry, new Date())?.active === true;
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

  function tuneHref(entry) {
    const frequency = entryFrequency(entry);
    return `/zero?frequency=${encodeURIComponent(frequency.toFixed(3))}&mode=${encodeURIComponent(inferredMode(entry, frequency))}&from=lookup`;
  }

  function categoryMatches(entry, key = selectedKey) {
    const def = CATEGORY_DEFS[key];
    return Boolean(def && def.match(entry, entryText(entry), catsFor(entry)));
  }

  function card(entry) {
    const frequency = entryFrequency(entry);
    const place = entry.transmitter || entry.location || entry.country || '';
    const details = [entry.language, entry.mode, place].filter(Boolean).join(' · ');
    const state = scheduleActive(entry) ? 'ON NOW' : (entry.start && entry.end ? 'SCHEDULED' : 'KNOWN');
    return `<article class="lookup-category-result">
      <div class="lookup-category-copy">
        <strong>${esc(entry.name || entry.callsign || 'Known signal')}</strong>
        <small>${esc(details || entry.description || 'FREQBEACON catalog entry')} · ${esc(state)}</small>
        <span class="lookup-category-frequency">${esc(engine.formatFrequency(frequency))}</span>
      </div>
      <a class="lookup-tune" href="${esc(tuneHref(entry))}">TUNE</a>
    </article>`;
  }

  function renderCategory() {
    const def = CATEGORY_DEFS[selectedKey];
    if (!def) return;
    const visible = selectedEntries.slice(0, displayLimit);
    count.textContent = `${selectedEntries.length.toLocaleString()} result${selectedEntries.length === 1 ? '' : 's'} · ${def.label}`;
    stage.innerHTML = visible.length
      ? `${visible.map(card).join('')}${visible.length < selectedEntries.length ? '<button class="lookup-category-more" type="button" data-category-more>SHOW MORE</button>' : ''}`
      : '<div class="lookup-empty"><strong>No stored matches yet.</strong><p>Try another category or enter a frequency above.</p></div>';
    stage.querySelector('[data-category-more]')?.addEventListener('click', () => {
      displayLimit += 12;
      renderCategory();
    });
  }

  async function selectCategory(key) {
    const def = CATEGORY_DEFS[key];
    if (!def) return;
    selectedKey = key;
    displayLimit = 12;
    window.FREQBEACON_LOOKUP_SELECTED_CATEGORY = key;
    chips.querySelectorAll('[data-category]').forEach((button) => {
      const selected = button.dataset.category === key;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    if (status) {
      status.className = 'lookup-status is-working';
      status.textContent = `Loading ${def.label} matches…`;
    }
    count.textContent = def.label;
    stage.innerHTML = '<div class="lookup-loading">CHECKING THE FREQBEACON CATALOG…</div>';

    const base = Array.isArray(catalog.entries) ? catalog.entries : (Array.isArray(catalog.stations) ? catalog.stations : []);
    let entries = [...base];
    if (def.ham) entries.push(...hamQuickEntries());
    if (def.broadcast) {
      try { entries.push(...await loadGeneratedEntries()); }
      catch (error) { console.warn('FREQBEACON category catalog expansion failed:', error); }
    }

    selectedEntries = dedupe(entries.filter((entry) => categoryMatches(entry, key))).sort((a,b) => {
      const activeDelta = Number(scheduleActive(b)) - Number(scheduleActive(a));
      if (activeDelta) return activeDelta;
      return entryFrequency(a) - entryFrequency(b) || String(a.name || '').localeCompare(String(b.name || ''));
    });
    renderCategory();
    if (status) {
      status.className = 'lookup-status';
      status.textContent = selectedEntries.length ? `${def.label}: showing real stored catalog matches.` : `${def.label}: no stored matches yet.`;
    }
    document.querySelector('#lookupResultsTitle')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  chips.addEventListener('click', (event) => {
    const button = event.target.closest('[data-category]');
    if (button) selectCategory(button.dataset.category);
  });

  window.FREQBEACON_LOOKUP_CATEGORIES = Object.freeze({
    defs: CATEGORY_DEFS,
    matches: categoryMatches,
    selected: () => selectedKey,
    clearSelection() {
      selectedKey = '';
      window.FREQBEACON_LOOKUP_SELECTED_CATEGORY = '';
      chips.querySelectorAll('[data-category]').forEach((button) => {
        button.classList.remove('active');
        button.setAttribute('aria-pressed', 'false');
      });
    }
  });
})();
