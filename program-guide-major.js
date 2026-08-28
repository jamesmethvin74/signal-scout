(() => {
  const TARGET = /^(?:BBC World Service|WEWN|EWTN|EWTN \/ WEWN)$/i;
  const cache = new Map();
  const inflight = new WeakSet();

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
      .replaceAll('"','&quot;').replaceAll("'",'&#039;');
  }

  function stationFrom(card) {
    return card.querySelector('.station-name')?.textContent?.trim()
      || card.querySelector('h3')?.textContent?.trim()
      || '';
  }

  function frequencyFrom(card) {
    const lookup = card.querySelector('.lookup-result-frequency')?.textContent || '';
    if (lookup) {
      const n = Number(lookup.replace(/,/g,'').match(/[0-9]+(?:\.[0-9]+)?/)?.[0]);
      if (Number.isFinite(n)) return n;
    }
    const el = card.querySelector('.frequency');
    if (!el) return null;
    const unit = el.querySelector('span')?.textContent?.toLowerCase() || '';
    const clone = el.cloneNode(true);
    clone.querySelector('span')?.remove();
    const n = Number(clone.textContent.replace(/,/g,'').trim());
    if (!Number.isFinite(n)) return null;
    return unit.includes('mhz') ? n * 1000 : n;
  }

  function languageFrom(card) {
    const tags = [...card.querySelectorAll('.tags .tag, .lookup-tags .lookup-tag')]
      .map((tag) => tag.textContent.trim());
    return tags.find((tag) => /English|Spanish|French|German|Portuguese|Arabic|Chinese|Japanese|Korean|Russian|Romanian|Italian|Dutch|Polish|Hindi|Urdu|Persian|Turkish|Swahili|Hausa|Afrikaans|Amharic/i.test(tag)) || '';
  }

  function targetDate(card) {
    const selector = card.classList.contains('lookup-result')
      ? '[data-lookup-offset].active'
      : '.time-picker [data-offset].active';
    const button = document.querySelector(selector);
    const offset = Number(button?.dataset.lookupOffset ?? button?.dataset.offset ?? 0) || 0;
    return new Date(Date.now() + offset * 3600000);
  }

  function timeZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch { return 'UTC'; }
  }

  function render(slot, data) {
    if (!slot || data?.status !== 'verified') return;
    slot.classList.remove('is-loading','is-warning','is-service','is-broadcast');
    slot.classList.add('is-verified');
    slot.innerHTML = `
      <div class="program-guide-kicker"><span class="program-live-dot"></span>ON NOW · VERIFIED</div>
      <div class="program-guide-title">${esc(data.program)}</div>
      <div class="program-guide-window">${esc(data.window || '')}</div>
      ${data.next ? `<div class="program-guide-next"><b>Up next:</b> ${esc(data.next.program)}${data.next.window ? ` · ${esc(data.next.window)}` : ''}</div>` : ''}
      ${data.sourceUrl ? `<a class="program-guide-source" href="${esc(data.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(data.sourceLabel || 'Official program guide')}</a>` : ''}`;
    slot.dataset.programGuideMajor = 'true';
  }

  async function upgrade(card) {
    const station = stationFrom(card);
    if (!TARGET.test(station) || inflight.has(card)) return;
    const slot = card.querySelector('[data-program-guide]');
    if (!slot || slot.dataset.programGuideMajor === 'true' || slot.classList.contains('is-verified')) return;
    const frequency = frequencyFrom(card);
    if (!Number.isFinite(frequency)) return;

    inflight.add(card);
    const at = targetDate(card);
    const language = languageFrom(card);
    const key = `${station}|${Math.round(frequency)}|${language}|${Math.floor(at.getTime()/60000)}`;
    let promise = cache.get(key);
    if (!promise) {
      const params = new URLSearchParams({
        station,
        frequency:String(frequency),
        at:at.toISOString(),
        tz:timeZone(),
        language
      });
      promise = fetch(`/api/program-guide?${params}`, { headers:{ Accept:'application/json' } })
        .then(async (response) => response.ok ? response.json() : null)
        .catch(() => null);
      cache.set(key, promise);
    }
    const data = await promise;
    if (data?.status === 'verified') render(slot, data);
    inflight.delete(card);
  }

  function scan(root = document) {
    root.querySelectorAll('.signal-card, .lookup-result').forEach((card) => upgrade(card));
  }

  const grid = document.getElementById('signalGrid');
  const lookup = document.getElementById('lookupResults');
  if (grid) new MutationObserver(() => requestAnimationFrame(() => scan(grid))).observe(grid, { childList:true, subtree:true });
  if (lookup) new MutationObserver(() => requestAnimationFrame(() => scan(lookup))).observe(lookup, { childList:true, subtree:true });
  scan();
  setTimeout(scan, 500);
})();
