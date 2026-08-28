(() => {
  const EXACT_GUIDES = /^(?:WRMI|WBCQ|RNZ Pacific|Radio New Zealand International|RNZI|Radio Exterior de España|Radio Exterior de Espana|Radio Romania International)$/i;
  const cache = new Map();
  const pending = new WeakSet();
  const queued = new WeakSet();
  const grid = document.getElementById('signalGrid');
  const lookupResults = document.getElementById('lookupResults');

  const SERVICE_NAMES = new Map([
    ['BBC WORLD SERVICE', 'BBC World Service'],
    ['RADIO ROMANIA INTERNATIONAL', 'Radio Romania International'],
    ['RNZ PACIFIC', 'RNZ Pacific'],
    ['RADIO NEW ZEALAND INTERNATIONAL', 'RNZ Pacific'],
    ['RNZI', 'RNZ Pacific'],
    ['RADIO EXTERIOR DE ESPAÑA', 'Radio Exterior de España'],
    ['RADIO EXTERIOR DE ESPANA', 'Radio Exterior de España'],
    ['CHINA RADIO INTERNATIONAL', 'China Radio International'],
    ['WEWN', 'EWTN / WEWN'],
    ['WWCR', 'WWCR'],
    ['SOLOMON ISLANDS BROADCASTING', 'Solomon Islands Broadcasting / SIBC'],
    ['WRMI', 'WRMI'],
    ['WBCQ', 'WBCQ']
  ]);

  function esc(value) {
    return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  }

  function frequencyFrom(container) {
    const lookup = container.querySelector('.lookup-result-frequency')?.textContent || '';
    if (lookup) {
      const n = Number(lookup.replace(/,/g, '').match(/[0-9]+(?:\.[0-9]+)?/)?.[0]);
      if (Number.isFinite(n)) return n;
    }
    const el = container.querySelector('.frequency');
    if (!el) return null;
    const unit = el.querySelector('span')?.textContent?.toLowerCase() || '';
    const clone = el.cloneNode(true);
    clone.querySelector('span')?.remove();
    const n = Number(clone.textContent.replace(/,/g, '').trim());
    if (!Number.isFinite(n)) return null;
    return unit.includes('mhz') ? n * 1000 : n;
  }

  function stationFrom(container) {
    return container.querySelector('.station-name')?.textContent?.trim()
      || container.querySelector('h3')?.textContent?.trim()
      || '';
  }

  function tagsFrom(container) {
    return [...container.querySelectorAll('.tags .tag, .lookup-tags .lookup-tag')]
      .map((tag) => tag.textContent.trim())
      .filter(Boolean);
  }

  function languageFrom(container) {
    const tags = tagsFrom(container);
    const likely = tags.find((tag) => /English|Spanish|French|German|Portuguese|Arabic|Chinese|Japanese|Korean|Russian|Romanian|Italian|Dutch|Polish|Hindi|Urdu|Persian|Turkish|Swahili|Hausa|Afrikaans|Amharic|Thai|Vietnamese|Indonesian|Malay|Tagalog|Ukrainian|Bulgarian|Serbian|Croatian|Greek|Hebrew|Danish|Norwegian|Swedish|Finnish/i.test(tag));
    return likely || '';
  }

  function serviceIdentity(container, station) {
    const clean = String(station || '').trim();
    const upper = clean.toUpperCase();
    const base = SERVICE_NAMES.get(upper) || clean || 'Broadcast service';
    const language = languageFrom(container);
    const languageSuffix = language && !/unknown/i.test(language) ? ` · ${language}` : '';
    return {
      title: `${base}${languageSuffix}`,
      note: 'Exact show title is not available from an integrated broadcaster guide yet.'
    };
  }

  function targetDate(container) {
    const selector = container.classList.contains('lookup-result') ? '[data-lookup-offset].active' : '.time-picker [data-offset].active';
    const button = document.querySelector(selector);
    const offset = Number(button?.dataset.lookupOffset ?? button?.dataset.offset ?? 0) || 0;
    return new Date(Date.now() + offset * 3600000);
  }

  function timeZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch { return 'UTC'; }
  }

  function sourceLink(data) {
    if (!data.sourceUrl) return '';
    const label = data.sourceLabel || 'Official program guide';
    return `<a class="program-guide-source" href="${esc(data.sourceUrl)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
  }

  function render(slot, data) {
    slot.classList.remove('is-loading','is-verified','is-broadcast','is-warning','is-service');
    if (data.status === 'verified') {
      slot.classList.add('is-verified');
      slot.innerHTML = `
        <div class="program-guide-kicker"><span class="program-live-dot"></span>ON NOW · VERIFIED</div>
        <div class="program-guide-title">${esc(data.program)}</div>
        <div class="program-guide-window">${esc(data.window || '')}</div>
        ${data.next ? `<div class="program-guide-next"><b>Up next:</b> ${esc(data.next.program)}${data.next.window ? ` · ${esc(data.next.window)}` : ''}</div>` : ''}
        ${sourceLink(data)}`;
      return;
    }
    if (data.status === 'broadcast') {
      slot.classList.add('is-broadcast');
      slot.innerHTML = `
        <div class="program-guide-kicker"><span class="program-broadcast-dot"></span>ON NOW · VERIFIED BROADCAST</div>
        <div class="program-guide-title">${esc(data.program)}</div>
        <div class="program-guide-window">${esc(data.window || '')}</div>
        <div class="program-guide-note">The broadcaster verifies this language/service block; individual segments inside it may vary.</div>
        ${sourceLink(data)}`;
      return;
    }
    if (data.status === 'service') {
      slot.classList.add('is-service');
      slot.innerHTML = `
        <div class="program-guide-kicker"><span class="program-service-dot"></span>ON NOW · SERVICE IDENTIFIED</div>
        <div class="program-guide-title">${esc(data.program || 'Broadcast service')}</div>
        <div class="program-guide-note">${esc(data.message || 'Exact show title is not yet available.')}</div>`;
      return;
    }
    slot.classList.add('is-warning');
    if (data.status === 'ambiguous') {
      slot.innerHTML = `
        <div class="program-guide-kicker">ON NOW · PUBLISHED LISTINGS CONFLICT</div>
        <div class="program-guide-title">Exact program not verified</div>
        <div class="program-guide-window">${esc((data.candidates || []).join(' · '))}</div>
        <div class="program-guide-note">FreqBeacon will not guess when official listings overlap.</div>
        ${sourceLink(data)}`;
      return;
    }
    slot.innerHTML = `
      <div class="program-guide-kicker">ON NOW</div>
      <div class="program-guide-title">Exact program not verified</div>
      <div class="program-guide-note">${esc(data.message || 'A program-level guide is not available for this transmission block.')}</div>
      ${data.next ? `<div class="program-guide-next"><b>Next verified listing:</b> ${esc(data.next.program)}${data.next.window ? ` · ${esc(data.next.window)}` : ''}</div>` : ''}
      ${sourceLink(data)}`;
  }

  function isBroadcastCard(container) {
    if (container.matches('[data-ham-card], .ham-quick-target')) return false;
    if (container.classList.contains('lookup-result')) return true;
    const frequency = container.querySelector('.frequency');
    const unit = frequency?.querySelector('span')?.textContent?.trim().toLowerCase() || '';
    return unit.includes('mhz');
  }

  function renameSchedule(container) {
    const scheduleDetail = [...container.querySelectorAll('.details .detail')].find((detail) => String(detail.childNodes?.[0]?.textContent || '').trim() === 'Schedule');
    if (!scheduleDetail) return;
    scheduleDetail.childNodes[0].textContent = 'Transmission';
    scheduleDetail.classList.add('collapse-summary-detail');
  }

  async function fetchGuide(params) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`/api/program-guide?${params}`, {
        headers:{ Accept:'application/json' },
        signal:controller.signal
      });
      if (!response.ok) throw new Error(`Program guide HTTP ${response.status}`);
      return await response.json();
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function decorate(container) {
    if (pending.has(container) || container.querySelector('[data-program-guide]') || !isBroadcastCard(container)) return;
    const station = stationFrom(container);
    const frequency = frequencyFrom(container);
    if (!station || !Number.isFinite(frequency)) return;
    pending.add(container);
    renameSchedule(container);

    const slot = document.createElement('section');
    slot.className = 'program-guide-card is-loading';
    slot.dataset.programGuide = 'true';
    slot.innerHTML = '<div class="program-guide-kicker">ON NOW</div><div class="program-guide-title">Identifying current program…</div>';
    const details = container.querySelector('.details, .lookup-tags');
    if (details) details.insertAdjacentElement('afterend', slot); else container.appendChild(slot);

    if (!EXACT_GUIDES.test(station)) {
      const service = serviceIdentity(container, station);
      render(slot, { status:'service', program:service.title, message:service.note });
      return;
    }

    const at = targetDate(container);
    const language = languageFrom(container);
    const bucket = Math.floor(at.getTime() / 60000);
    const key = `${station}|${Math.round(frequency)}|${language}|${bucket}`;
    let promise = cache.get(key);
    if (!promise) {
      const params = new URLSearchParams({
        station,
        frequency:String(frequency),
        at:at.toISOString(),
        tz:timeZone(),
        language
      });
      promise = fetchGuide(params);
      cache.set(key, promise);
    }
    try {
      const result = await promise;
      if (result.status === 'unverified' || result.status === 'unavailable' || result.status === 'unsupported') {
        const service = serviceIdentity(container, station);
        render(slot, {
          status:'service',
          program:service.title,
          message:result.message || service.note
        });
      } else {
        render(slot, result);
      }
    } catch {
      const service = serviceIdentity(container, station);
      render(slot, { status:'service', program:service.title, message:'Program guide lookup is temporarily unavailable.' });
    }
  }

  const guideObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver((entries, observer) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          queued.delete(entry.target);
          decorate(entry.target);
        }
      }, { rootMargin:'700px 0px' })
    : null;

  function queueDecorate(container) {
    if (pending.has(container) || container.querySelector('[data-program-guide]')) return;
    if (container.classList.contains('lookup-result') || !guideObserver) {
      decorate(container);
      return;
    }
    if (queued.has(container)) return;
    queued.add(container);
    guideObserver.observe(container);
  }

  function decorateAll(root = document) {
    root.querySelectorAll('.signal-card, .lookup-result').forEach((container) => queueDecorate(container));
  }

  const style = document.createElement('style');
  style.textContent = `
    .program-guide-card{margin-top:12px;padding:12px 13px;border:1px solid rgba(37,212,230,.22);border-radius:7px;background:linear-gradient(135deg,rgba(37,212,230,.055),rgba(4,11,14,.78));}
    .program-guide-card.is-verified{border-color:rgba(97,231,134,.42);background:linear-gradient(135deg,rgba(97,231,134,.065),rgba(4,11,14,.82));}
    .program-guide-card.is-broadcast{border-color:rgba(88,196,255,.40);background:linear-gradient(135deg,rgba(88,196,255,.065),rgba(4,11,14,.82));}
    .program-guide-card.is-service{border-color:rgba(37,212,230,.28);background:linear-gradient(135deg,rgba(37,212,230,.045),rgba(4,11,14,.82));}
    .program-guide-card.is-warning{border-color:rgba(239,189,92,.32);}
    .program-guide-kicker{display:flex;align-items:center;gap:7px;color:#7f98a0;font-family:var(--mono);font-size:8px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;}
    .program-guide-card.is-verified .program-guide-kicker{color:var(--green);}
    .program-guide-card.is-broadcast .program-guide-kicker{color:#7bcfff;}
    .program-guide-card.is-service .program-guide-kicker{color:#86aeb8;}
    .program-live-dot,.program-service-dot,.program-broadcast-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;}
    .program-live-dot{background:var(--green);box-shadow:0 0 10px rgba(97,231,134,.65);}
    .program-broadcast-dot{background:#7bcfff;box-shadow:0 0 9px rgba(123,207,255,.48);}
    .program-service-dot{background:#7a9aa2;}
    .program-guide-title{margin-top:5px;color:#eef6f7;font-size:15px;font-weight:900;line-height:1.2;}
    .program-guide-window{margin-top:3px;color:#a9bdc2;font-family:var(--mono);font-size:10px;}
    .program-guide-next,.program-guide-note{margin-top:7px;color:#8fa3a9;font-size:10px;line-height:1.45;}
    .program-guide-next b{color:#bed0d4;}
    .program-guide-source{display:inline-block;margin-top:7px;color:var(--accent);font-family:var(--mono);font-size:8px;font-weight:800;letter-spacing:.04em;text-decoration:none;}
    .program-guide-card.is-loading{opacity:.72;}
    @media(max-width:430px){.program-guide-card{padding:10px 11px}.program-guide-title{font-size:14px}}
  `;
  document.head.appendChild(style);

  if (grid) new MutationObserver(() => requestAnimationFrame(() => decorateAll(grid))).observe(grid,{childList:true,subtree:true});
  if (lookupResults) new MutationObserver(() => requestAnimationFrame(() => decorateAll(lookupResults))).observe(lookupResults,{childList:true,subtree:true});
  decorateAll();
})();
