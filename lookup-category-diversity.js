(() => {
  'use strict';

  const base = window.FREQBEACON_LOOKUP_CATEGORIES;
  const stage = document.getElementById('lookupResults');
  const count = document.getElementById('lookupResultCount');
  if (!base || !stage || !count) return;

  const BROADCAST = new Set(['news', 'sports', 'religious', 'propaganda', 'international']);

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[ch]));

  const keyFor = (value) => String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  function selectedCategory() {
    return base.selected?.() || window.FREQBEACON_LOOKUP_SELECTED_CATEGORY || '';
  }

  function diversify(key) {
    const cards = Array.from(stage.children)
      .filter((node) => node.classList?.contains('lookup-category-result'));
    if (cards.length < 2) return;

    const originalTotal = Number.parseInt(String(count.textContent || '').replace(/[^0-9]/g, ''), 10) || cards.length;
    const groups = new Map();

    for (const card of cards) {
      const name = card.querySelector('.lookup-category-result-top strong')?.textContent?.trim() || 'Broadcaster';
      const frequency = card.querySelector('.lookup-category-frequency')?.textContent?.trim() || '';
      const tune = card.querySelector('.lookup-tune')?.getAttribute('href') || '';
      const stationKey = keyFor(name);

      if (!groups.has(stationKey)) groups.set(stationKey, { name, items: [] });
      groups.get(stationKey).items.push({ card, frequency, tune });
    }

    for (const group of groups.values()) {
      const [primary, ...rest] = group.items;
      if (!primary) continue;

      const seen = new Set([primary.tune || primary.frequency]);
      const alternates = rest.filter((item) => {
        const altKey = item.tune || item.frequency;
        if (!altKey || seen.has(altKey)) return false;
        seen.add(altKey);
        return true;
      });

      if (alternates.length) {
        const copy = primary.card.querySelector('.lookup-category-copy');
        if (copy) {
          const alt = document.createElement('div');
          alt.className = 'lookup-category-alternates';
          alt.innerHTML = `
            <span class="lookup-category-alternates-label">OTHER SCHEDULED FREQUENCIES</span>
            <div class="lookup-category-alternates-list">
              ${alternates.map((item) => `<a class="lookup-category-alt" href="${esc(item.tune)}">${esc(item.frequency)}</a>`).join('')}
            </div>`;
          copy.appendChild(alt);
        }
      }

      rest.forEach((item) => item.card.remove());
    }

    const broadcasterCount = groups.size;
    count.textContent = `${broadcasterCount.toLocaleString()} broadcaster${broadcasterCount === 1 ? '' : 's'} · ${originalTotal.toLocaleString()} scheduled frequenc${originalTotal === 1 ? 'y' : 'ies'}`;
  }

  async function browse(receiver, context = {}) {
    const result = await base.browse(receiver, context);
    const key = selectedCategory();
    if (BROADCAST.has(key)) diversify(key);
    return result;
  }

  window.FREQBEACON_LOOKUP_CATEGORIES = Object.freeze({ ...base, browse });
})();
