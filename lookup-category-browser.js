(() => {
  'use strict';

  const shell = document.querySelector('#lookupCategoryBrowser');
  const chips = shell?.querySelector('[data-category-chips]');
  if (!shell || !chips) return;

  const STATE_BROADCASTERS = /china radio international|voice of korea|radio pyongyang|radio havana|voice of america|radio romania international|radio exterior de españa|bbc world service|rnz pacific|radio france internationale|deutsche welle|voice of turkey|kbs world|nhk world/;
  const RELIGIOUS = /relig|gospel|bible|catholic|christian|adventist|ministry|ministries|evangel/;
  const DIGITAL = /digital|ft8|rtty|packet|data|sstv|navtex|fsk|drm/;

  const CATEGORY_DEFS = Object.freeze({
    news: { label: 'News', match: (entry, text, cats) => cats.has('news') || /news|world service|current affairs/.test(text) },
    sports: { label: 'Sports', match: (entry, text, cats) => cats.has('sports') || /\bsports?\b/.test(text) },
    religious: { label: 'Religious', match: (entry, text, cats) => cats.has('religious') || RELIGIOUS.test(text) },
    propaganda: { label: 'Propaganda', match: (entry, text, cats) => cats.has('state-broadcaster') || STATE_BROADCASTERS.test(text) },
    international: { label: 'International', match: (entry, text, cats) => cats.has('international') || /international|world service/.test(text) },
    utility: { label: 'Utility', match: (entry, text, cats) => cats.has('utility') },
    'amateur-voice': { label: 'Amateur Voice', match: (entry, text, cats) => cats.has('amateur') && cats.has('voice') },
    digital: { label: 'Digital', match: (entry, text, cats) => cats.has('digital') || DIGITAL.test(text) },
    aviation: { label: 'Aviation', match: (entry, text, cats) => cats.has('aviation') },
    cb: { label: 'CB', match: (entry, text, cats) => cats.has('cb') || String(entry?.band || '').toUpperCase() === 'CB' }
  });

  let selectedKey = '';

  function entryText(entry) {
    return [entry?.name, entry?.callsign, entry?.format, entry?.description, entry?.note, entry?.country, entry?.language, entry?.mode]
      .filter(Boolean).join(' ').toLowerCase();
  }

  function catsFor(entry) {
    return new Set((entry?.categories || []).map((value) => String(value).toLowerCase()));
  }

  function categoryMatches(entry, key = selectedKey) {
    if (!key) return true;
    const def = CATEGORY_DEFS[key];
    return Boolean(def && def.match(entry, entryText(entry), catsFor(entry)));
  }

  function paintSelection() {
    chips.querySelectorAll('[data-category]').forEach((button) => {
      const selected = button.dataset.category === selectedKey;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
  }

  function setSelection(key) {
    selectedKey = CATEGORY_DEFS[key] ? key : '';
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
    clearSelection() { setSelection(''); }
  });
})();