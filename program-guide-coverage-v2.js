(() => {
  const LANGUAGE_RE = /English|Spanish|French|German|Portuguese|Arabic|Chinese|Japanese|Korean|Russian|Romanian|Italian|Dutch|Polish|Hindi|Urdu|Persian|Farsi|Turkish|Swahili|Hausa|Afrikaans|Amharic|Tigrinya|Thai|Vietnamese|Indonesian|Malay|Tagalog|Ukrainian|Bulgarian|Serbian|Croatian|Greek|Hebrew|Danish|Norwegian|Swedish|Finnish|Bislama/i;
  const observed = new WeakSet();
  const inFlight = new WeakSet();
  const cache = new Map();

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
      .map((tag)=>tag.textContent.trim());
    return tags.find((tag)=>LANGUAGE_RE.test(tag)) || '';
  }

  function targetDate(card) {
    const selector = card.classList.contains('lookup-result')
      ? '[data-lookup-offset].active'
      : '.time-picker [data-offset].active';
    const button = document.querySelector(selector);
    const offset = Number(button?.dataset.lookupOffset ?? button?.dataset.offset ?? 0) || 0;
    return new Date(Date.now() + offset*3600000);
  }

  function timeZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch { return 'UTC'; }
  }

  function sourceLink(data) {
    if (!data?.sourceUrl) return '';
    return `<a class="program-guide-source" href="${esc(data.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(data.sourceLabel || 'Official program guide')}</a>`;
  }

  function renderVerified(slot,data) {
    slot.classList.remove('is-loading','is-warning','is-service','is-profile','is-broadcast');
    slot.classList.add('is-verified');
    delete slot.dataset.authoritySignature;
    slot.dataset.coverageV2 = 'verified';
    slot.innerHTML = `
      <div class="program-guide-kicker"><span class="program-live-dot"></span>ON NOW · VERIFIED</div>
      <div class="program-guide-title">${esc(data.program)}</div>
      <div class="program-guide-window">${esc(data.window || '')}</div>
      ${data.next ? `<div class="program-guide-next"><b>Up next:</b> ${esc(data.next.program)}${data.next.window ? ` · ${esc(data.next.window)}` : ''}</div>` : ''}
      ${sourceLink(data)}`;
  }

  function renderBroadcast(slot,data) {
    slot.classList.remove('is-loading','is-warning','is-service','is-profile','is-verified');
    slot.classList.add('is-broadcast');
    delete slot.dataset.authoritySignature;
    slot.dataset.coverageV2 = 'broadcast';
    slot.innerHTML = `
      <div class="program-guide-kicker"><span class="program-broadcast-dot"></span>ON NOW · VERIFIED BROADCAST</div>
      <div class="program-guide-title">${esc(data.program)}</div>
      ${data.window ? `<div class="program-guide-window">${esc(data.window)}</div>` : ''}
      ${data.next ? `<div class="program-guide-next"><b>Up next:</b> ${esc(data.next.program)}${data.next.window ? ` · ${esc(data.next.window)}` : ''}</div>` : ''}
      <div class="program-guide-note">${esc(data.message || 'The broadcaster/source verifies this service or programming block; individual segments inside it may vary.')}</div>
      ${sourceLink(data)}`;
  }

  function renderAmbiguous(slot,data) {
    slot.classList.remove('is-loading','is-service','is-profile','is-verified','is-broadcast');
    slot.classList.add('is-warning');
    delete slot.dataset.authoritySignature;
    slot.dataset.coverageV2 = 'ambiguous';
    slot.innerHTML = `
      <div class="program-guide-kicker">ON NOW · PUBLISHED LISTINGS CONFLICT</div>
      <div class="program-guide-title">Exact program not verified</div>
      <div class="program-guide-window">${esc((data.candidates || []).join(' · '))}</div>
      <div class="program-guide-note">FREQBEACON will not guess when published listings overlap.</div>
      ${sourceLink(data)}`;
  }

  function isBroadcastCard(card) {
    if (card.matches('[data-ham-card], .ham-quick-target')) return false;
    const frequency = frequencyFrom(card);
    return Number.isFinite(frequency) && frequency >= 2300 && frequency <= 30000;
  }

  async function upgrade(card) {
    if (inFlight.has(card) || !isBroadcastCard(card)) return;
    const slot = card.querySelector('[data-program-guide]');
    if (!slot || slot.classList.contains('is-verified') || slot.classList.contains('is-broadcast')) return;
    const station = stationFrom(card);
    const frequency = frequencyFrom(card);
    if (!station || !Number.isFinite(frequency)) return;

    const at = targetDate(card);
    const language = languageFrom(card);
    const key = `${station}|${Math.round(frequency)}|${language}|${Math.floor(at.getTime()/60000)}`;
    if (card.dataset.coverageV2Attempt === key) return;
    card.dataset.coverageV2Attempt = key;
    inFlight.add(card);

    let promise = cache.get(key);
    if (!promise) {
      const params = new URLSearchParams({
        station, frequency:String(frequency), at:at.toISOString(), tz:timeZone(), language
      });
      promise = fetch(`/api/program-guide?${params}`,{headers:{Accept:'application/json'}})
        .then(async (response)=>response.ok ? response.json() : null)
        .catch(()=>null);
      cache.set(key,promise);
    }

    try {
      const data = await promise;
      if (data?.status==='verified' && data.program) renderVerified(slot,data);
      else if (data?.status==='broadcast' && data.program) renderBroadcast(slot,data);
      else if (data?.status==='ambiguous') renderAmbiguous(slot,data);
    } finally {
      inFlight.delete(card);
    }
  }

  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries)=>{
        for (const entry of entries) if (entry.isIntersecting) upgrade(entry.target);
      },{rootMargin:'1400px 0px'})
    : null;

  function observe(card) {
    if (observed.has(card)) return;
    observed.add(card);
    if (!isBroadcastCard(card)) return;
    if (io) io.observe(card); else upgrade(card);
  }

  function scan(root=document) {
    root.querySelectorAll('.signal-card, .lookup-result').forEach(observe);
  }

  const grid = document.getElementById('signalGrid');
  const lookup = document.getElementById('lookupResults');
  if (grid) new MutationObserver(()=>scan(grid)).observe(grid,{childList:true,subtree:true});
  if (lookup) new MutationObserver(()=>scan(lookup)).observe(lookup,{childList:true,subtree:true});
  scan();
  setTimeout(scan,500);
  setTimeout(()=>document.querySelectorAll('.signal-card, .lookup-result').forEach((card)=>{
    const rect = card.getBoundingClientRect();
    if (rect.bottom>-800 && rect.top<innerHeight+1800) upgrade(card);
  }),1200);
})();
