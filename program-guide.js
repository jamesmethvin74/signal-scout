(() => {
  const SUPPORTED = /^(?:WRMI|WBCQ)$/i;
  const cache = new Map();
  const pending = new WeakSet();
  const grid = document.getElementById('signalGrid');
  const lookupResults = document.getElementById('lookupResults');

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
    slot.classList.remove('is-loading','is-verified','is-warning');
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

  async function decorate(container) {
    if (pending.has(container) || container.querySelector('[data-program-guide]')) return;
    if (container.matches('[data-ham-card], .ham-quick-target')) return;
    const station = stationFrom(container);
    const frequency = frequencyFrom(container);
    if (!SUPPORTED.test(station) || !Number.isFinite(frequency)) return;
    pending.add(container);

    const scheduleDetail = [...container.querySelectorAll('.details .detail')].find((detail) => String(detail.childNodes?.[0]?.textContent || '').trim() === 'Schedule');
    if (scheduleDetail) {
      scheduleDetail.childNodes[0].textContent = 'Transmission';
      scheduleDetail.classList.add('collapse-summary-detail');
    }

    const slot = document.createElement('section');
    slot.className = 'program-guide-card is-loading';
    slot.dataset.programGuide = 'true';
    slot.innerHTML = '<div class="program-guide-kicker">ON NOW</div><div class="program-guide-title">Checking official program guide…</div>';
    const details = container.querySelector('.details, .lookup-tags');
    if (details) details.insertAdjacentElement('afterend', slot); else container.appendChild(slot);

    const at = targetDate(container);
    const bucket = Math.floor(at.getTime() / 300000);
    const key = `${station}|${Math.round(frequency)}|${bucket}`;
    let promise = cache.get(key);
    if (!promise) {
      const params = new URLSearchParams({ station, frequency:String(frequency), at:at.toISOString(), tz:timeZone() });
      promise = fetch(`/api/program-guide?${params}`, { headers:{ Accept:'application/json' } })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Program guide HTTP ${response.status}`);
          return response.json();
        });
      cache.set(key, promise);
    }
    try { render(slot, await promise); }
    catch { render(slot, { status:'unavailable', message:'Program guide lookup is temporarily unavailable.' }); }
  }

  function decorateAll(root = document) {
    root.querySelectorAll('.signal-card, .lookup-result').forEach((container) => decorate(container));
  }

  const style = document.createElement('style');
  style.textContent = `
    .program-guide-card{margin-top:12px;padding:12px 13px;border:1px solid rgba(37,212,230,.22);border-radius:7px;background:linear-gradient(135deg,rgba(37,212,230,.055),rgba(4,11,14,.78));}
    .program-guide-card.is-verified{border-color:rgba(97,231,134,.42);background:linear-gradient(135deg,rgba(97,231,134,.065),rgba(4,11,14,.82));}
    .program-guide-card.is-warning{border-color:rgba(239,189,92,.32);}
    .program-guide-kicker{display:flex;align-items:center;gap:7px;color:#7f98a0;font-family:var(--mono);font-size:8px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;}
    .program-guide-card.is-verified .program-guide-kicker{color:var(--green);}
    .program-live-dot{width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 10px rgba(97,231,134,.65);}
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
