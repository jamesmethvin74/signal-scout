(() => {
  'use strict';

  const catalog = window.FREQBEACON_IDENTIFICATION_CATALOG || window.FREQBEACON_ZERO_IDENTIFICATION_CATALOG;
  const engine = window.FREQBEACON_IDENTIFICATION_ENGINE;
  const shell = document.querySelector('#lookupCategoryBrowser');
  const chips = shell?.querySelector('[data-category-chips]');
  const panel = shell?.querySelector('[data-category-panel]');
  const title = shell?.querySelector('[data-category-title]');
  const summary = shell?.querySelector('[data-category-summary]');
  const list = shell?.querySelector('[data-category-list]');
  const more = shell?.querySelector('[data-category-more]');
  const status = shell?.querySelector('[data-category-status]');
  const input = document.querySelector('#lookupFrequency');
  const form = document.querySelector('#lookupForm');
  if (!catalog || !engine || !shell || !chips || !panel || !list || !input || !form) return;

  const LOCATION_STORAGE_KEY = 'signalScout:location:v1';
  const SHARDS = [
    '/data/identification/a26/sw-2300-4999.json',
    '/data/identification/a26/sw-5000-7499.json',
    '/data/identification/a26/sw-7500-11999.json',
    '/data/identification/a26/sw-12000-15999.json',
    '/data/identification/a26/sw-16000-21999.json',
    '/data/identification/a26/sw-22000-30000.json'
  ];

  const CATEGORY_DEFS = {
    sports: {
      label: 'Sports',
      description: 'Sports talk and broadcasters with sports programming in the stored catalog.',
      broadcast: true,
      match: (entry, text, cats) => cats.has('sports') || /\bsports?\b/.test(text)
    },
    religious: {
      label: 'Religion',
      description: 'Religious broadcasters, ministries and faith-based programming.',
      broadcast: true,
      match: (entry, text, cats) => cats.has('religious') || /relig|gospel|bible|catholic|christian|adventist|ministry|ministries|evangel/.test(text)
    },
    propaganda: {
      label: 'State / propaganda',
      description: 'State-funded international voices and stations commonly explored for government messaging or propaganda monitoring.',
      broadcast: true,
      match: (entry, text, cats) => cats.has('state-broadcaster') || /china radio international|voice of korea|radio pyongyang|radio havana|voice of america|radio romania international|radio exterior de españa|bbc world service|rnz pacific|radio france internationale|deutsche welle|voice of turkey|kbs world|nhk world/.test(text)
    },
    news: {
      label: 'News & world affairs',
      description: 'News, world-service and international current-affairs broadcasting.',
      broadcast: true,
      match: (entry, text, cats) => cats.has('news') || /news|world service|world affairs|current affairs/.test(text)
    },
    international: {
      label: 'International DX',
      description: 'International shortwave broadcasters and long-haul listening targets.',
      broadcast: true,
      match: (entry, text, cats) => cats.has('international') || /international|world service/.test(text)
    },
    time: {
      label: 'Time signals',
      description: 'WWV, WWVH, CHU and LF time/frequency standards.',
      match: (entry, text, cats) => cats.has('time-signal') || cats.has('standard-frequency')
    },
    military: {
      label: 'Military / aviation',
      description: 'Known HFGCS and aviation utility channels in the stored guide.',
      match: (entry, text, cats) => cats.has('military') || cats.has('aviation')
    },
    maritime: {
      label: 'Maritime',
      description: 'NAVTEX, calling, distress and maritime utility frequencies.',
      match: (entry, text, cats) => cats.has('maritime')
    },
    local: {
      label: 'AM / local',
      description: 'Stored medium-wave broadcast stations, ranked toward your saved listening location.',
      match: (entry, text, cats) => String(entry.band || '').toUpperCase() === 'MW' || cats.has('medium-wave')
    },
    cb: {
      label: 'CB',
      description: 'All forty U.S. Citizens Band channels, including Channel 19.',
      match: (entry, text, cats) => cats.has('cb') || String(entry.band || '').toUpperCase() === 'CB'
    }
  };

  let generatedEntries = null;
  let selectedKey = '';
  let selectedMatches = [];
  let displayLimit = 18;

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function savedLocation() {
    try {
      const payload = JSON.parse(localStorage.getItem(LOCATION_STORAGE_KEY) || 'null');
      const lat = Number(payload?.lat);
      const lon = Number(payload?.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    } catch {
      return null;
    }
  }

  function milesBetween(a, b) {
    if (!a || !b) return Infinity;
    const lat2 = Number(b.lat);
    const lon2 = Number(b.lon);
    if (!Number.isFinite(lat2) || !Number.isFinite(lon2) || (lat2 === 0 && lon2 === 0)) return Infinity;
    const r = Math.PI / 180;
    const dLat = (lat2 - a.lat) * r;
    const dLon = (lon2 - a.lon) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 3958.8 * 2 * Math.asin(Math.sqrt(h));
  }

  function entryFrequency(entry) {
    const value = Number(entry?.frequencyKHz ?? entry?.frequency);
    return Number.isFinite(value) ? value : NaN;
  }

  function entryText(entry) {
    return [entry?.name, entry?.callsign, entry?.format, entry?.description, entry?.note, entry?.country, entry?.language]
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
    if (/news|world service/.test(text)) cats.add('news');
    if (/relig|gospel|bible|catholic|christian|adventist|ministry|ministries|evangel/.test(text)) cats.add('religious');
    if (/\bsports?\b/.test(text)) cats.add('sports');
    if (/china radio international|voice of korea|radio pyongyang|radio havana|voice of america|radio romania international|radio exterior de españa|bbc world service|rnz pacific|radio france internationale|deutsche welle|voice of turkey|kbs world|nhk world/.test(text)) cats.add('state-broadcaster');
    return [...cats];
  }

  async function loadGeneratedEntries() {
    if (generatedEntries) return generatedEntries;
    status.textContent = 'Loading stored A26 broadcast catalog…';
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

  function utcDayAllowed(entry, date) {
    const days = String(entry?.days || '').trim();
    if (!days || /daily/i.test(days)) return true;
    const jsDay = date.getUTCDay();
    const hfccDay = jsDay === 0 ? '1' : String(jsDay + 1);
    if (/^[1-7]+$/.test(days)) return days.includes(hfccDay);
    const names = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const current = names[jsDay];
    if (/Mo-Fr/i.test(days)) return jsDay >= 1 && jsDay <= 5;
    if (/Mo-Sa/i.test(days)) return jsDay >= 1 && jsDay <= 6;
    if (/Sa-Su/i.test(days)) return jsDay === 0 || jsDay === 6;
    return days.includes(current);
  }

  function scheduleState(entry, now = new Date()) {
    if (!entry?.start || !entry?.end) return null;
    const toMinutes = (value) => {
      const text = String(value).padStart(4, '0');
      const hh = Number(text.slice(0, 2));
      const mm = Number(text.slice(2, 4));
      return (hh === 24 ? 1440 : hh * 60 + mm);
    };
    const start = toMinutes(entry.start);
    const end = toMinutes(entry.end);
    const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (![start, end, minute].every(Number.isFinite)) return null;
    if (start === end || (start === 0 && end === 1440)) return utcDayAllowed(entry, now);
    if (end > start) return utcDayAllowed(entry, now) && minute >= start && minute < end;
    if (minute >= start) return utcDayAllowed(entry, now);
    if (minute < end) {
      const prior = new Date(now.getTime() - 86400000);
      return utcDayAllowed(entry, prior);
    }
    return false;
  }

  function dedupe(entries) {
    const map = new Map();
    for (const entry of entries) {
      const frequency = entryFrequency(entry);
      if (!Number.isFinite(frequency)) continue;
      const key = [frequency.toFixed(3), String(entry.name || entry.callsign || ''), String(entry.start || ''), String(entry.end || '')].join('|').toLowerCase();
      if (!map.has(key)) map.set(key, entry);
    }
    return [...map.values()];
  }

  function currentLookupDate() {
    const active = document.querySelector('[data-offset].active');
    const hours = Number(active?.dataset?.offset || 0);
    return new Date(Date.now() + hours * 3600000);
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
    return `/zero?frequency=${encodeURIComponent(frequency.toFixed(3))}&mode=${encodeURIComponent(inferredMode(entry, frequency))}&from=lookup-category`;
  }

  function scheduleLabel(entry, active) {
    if (active === true) return 'ON SCHEDULE';
    if (active === false && entry.start && entry.end) return 'SCHEDULED';
    if (entry.type === 'channel' || entry.type === 'service' || entry.type === 'signal') return 'KNOWN CHANNEL';
    return 'STORED';
  }

  function resultHtml(entry, now, location) {
    const frequency = entryFrequency(entry);
    const active = scheduleState(entry, now);
    const distance = milesBetween(location, entry);
    const place = entry.transmitter || entry.location || entry.country || '';
    const sub = [place, entry.language, entry.mode].filter(Boolean).join(' · ');
    const distanceText = Number.isFinite(distance) ? ` · ${entry.locationApproximate ? '≈' : ''}${Math.round(distance).toLocaleString()} mi` : '';
    return `<article class="lookup-category-result ${active === true ? 'is-active' : ''}">
      <button type="button" class="lookup-category-identify" data-category-identify="${escapeHtml(String(frequency))}" aria-label="Identify ${escapeHtml(entry.name || 'this frequency')}">
        <span class="lookup-category-frequency">${escapeHtml(engine.formatFrequency(frequency))}</span>
        <span class="lookup-category-copy"><strong>${escapeHtml(entry.name || entry.callsign || 'Known signal')}</strong><small>${escapeHtml(sub || entry.description || 'Stored FREQBEACON catalog entry')}${escapeHtml(distanceText)}</small></span>
        <em>${escapeHtml(scheduleLabel(entry, active))}</em>
      </button>
      <a class="lookup-category-tune" href="${escapeHtml(tuneHref(entry))}">TUNE</a>
    </article>`;
  }

  function renderMatches() {
    const def = CATEGORY_DEFS[selectedKey];
    if (!def) return;
    const now = currentLookupDate();
    const location = savedLocation();
    const visible = selectedMatches.slice(0, displayLimit);
    list.innerHTML = visible.map((entry) => resultHtml(entry, now, location)).join('');
    summary.textContent = selectedMatches.length
      ? `${selectedMatches.length.toLocaleString()} stored match${selectedMatches.length === 1 ? '' : 'es'} · ${visible.length < selectedMatches.length ? `showing ${visible.length}` : 'all shown'}`
      : 'No stored matches in this category yet.';
    more.hidden = visible.length >= selectedMatches.length;
    status.textContent = selectedMatches.length ? 'Tap a result to identify it, or Tune to open it in Zero.' : 'Try another category.';
  }

  async function selectCategory(key) {
    const def = CATEGORY_DEFS[key];
    if (!def) return;
    selectedKey = key;
    displayLimit = 18;
    chips.querySelectorAll('[data-category]').forEach((button) => {
      const selected = button.dataset.category === key;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    panel.hidden = false;
    title.textContent = def.label;
    summary.textContent = def.description;
    list.innerHTML = '<div class="lookup-category-loading"><i></i><span>Checking stored frequencies…</span></div>';
    more.hidden = true;
    status.textContent = 'Checking the local FREQBEACON catalog…';

    const base = Array.isArray(catalog.stations) ? catalog.stations : (Array.isArray(catalog.entries) ? catalog.entries : []);
    let entries = [...base];
    if (def.broadcast) {
      try {
        entries.push(...await loadGeneratedEntries());
      } catch (error) {
        console.warn('FREQBEACON category A26 expansion failed:', error);
      }
    }

    const location = savedLocation();
    const now = currentLookupDate();
    selectedMatches = dedupe(entries.filter((entry) => {
      const cats = catsFor(entry);
      return def.match(entry, entryText(entry), cats);
    })).sort((a, b) => {
      const activeA = scheduleState(a, now) === true ? 1 : 0;
      const activeB = scheduleState(b, now) === true ? 1 : 0;
      if (activeA !== activeB) return activeB - activeA;
      const distanceA = milesBetween(location, a);
      const distanceB = milesBetween(location, b);
      if (distanceA !== distanceB) return distanceA - distanceB;
      return entryFrequency(a) - entryFrequency(b);
    });
    renderMatches();
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  chips.addEventListener('click', (event) => {
    const button = event.target.closest('[data-category]');
    if (button) selectCategory(button.dataset.category);
  });

  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-category-identify]');
    if (!button) return;
    input.value = button.dataset.categoryIdentify || '';
    form.requestSubmit();
    document.querySelector('#lookupStage')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  more.addEventListener('click', () => {
    displayLimit += 18;
    renderMatches();
  });
})();
