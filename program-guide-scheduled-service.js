(() => {
  const LANGUAGE_RE = /English|Spanish|French|German|Portuguese|Arabic|Chinese|Japanese|Korean|Russian|Romanian|Italian|Dutch|Polish|Hindi|Urdu|Persian|Farsi|Turkish|Swahili|Hausa|Afrikaans|Amharic|Tigrinya|Thai|Vietnamese|Indonesian|Malay|Tagalog|Ukrainian|Bulgarian|Serbian|Croatian|Greek|Hebrew|Danish|Norwegian|Swedish|Finnish|Bislama/i;
  let queued = false;

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
      .replaceAll('"','&quot;').replaceAll("'",'&#039;');
  }

  function stationFrom(card) {
    return card.querySelector('.station-name')?.textContent?.trim()
      || card.querySelector('h3')?.textContent?.trim()
      || 'Broadcast service';
  }

  function tagsFrom(card) {
    return [...card.querySelectorAll('.tags .tag, .lookup-tags .lookup-tag')]
      .map((tag) => tag.textContent.trim())
      .filter(Boolean);
  }

  function languageFrom(card) {
    return tagsFrom(card).find((tag) => LANGUAGE_RE.test(tag)) || '';
  }

  function detailValue(card, label) {
    const wanted = String(label).toLowerCase();
    const detail = [...card.querySelectorAll('.details .detail, .lookup-details .lookup-detail, .detail')]
      .find((item) => {
        const firstText = [...item.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent.trim())
          .find(Boolean) || '';
        return firstText.toLowerCase() === wanted;
      });
    return detail?.querySelector('b')?.innerText?.trim() || '';
  }

  function transmitterFrom(card) {
    return detailValue(card, 'Transmitter');
  }

  function scheduleFrom(card) {
    const value = detailValue(card, 'Schedule');
    if (!value) return { local:'', utc:'' };
    const lines = value.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const utcIndex = lines.findIndex((line) => /\bUTC\b/i.test(line));
    if (utcIndex >= 0) {
      return {
        local: lines.slice(0, utcIndex).join(' · '),
        utc: lines.slice(utcIndex).join(' · ')
      };
    }
    return { local:value, utc:'' };
  }

  function frequencyFrom(card) {
    const lookup = card.querySelector('.lookup-result-frequency')?.textContent?.trim();
    if (lookup) return lookup;
    const el = card.querySelector('.frequency');
    if (!el) return '';
    const clone = el.cloneNode(true);
    const unit = clone.querySelector('span')?.textContent?.trim() || '';
    clone.querySelector('span')?.remove();
    const value = clone.textContent.trim();
    return `${value}${unit ? ` ${unit}` : ''}`;
  }

  function sourceFrom(card) {
    const text = card.querySelector('.station-description')?.textContent?.trim() || '';
    const match = text.match(/source:\s*([^·]+)/i);
    return match?.[1]?.trim() || '';
  }

  function existingContext(slot) {
    const note = slot.querySelector('.program-guide-note')?.textContent?.trim() || '';
    if (!note || /has not resolved a named show|exact show title|exact program/i.test(note)) return '';
    return note;
  }

  function shouldPreserve(slot) {
    if (!slot) return true;
    if (slot.classList.contains('is-verified') || slot.classList.contains('is-broadcast')) return true;
    const text = slot.textContent || '';
    return /PUBLISHED LISTINGS CONFLICT|official listings overlap|will not guess/i.test(text);
  }

  function render(card) {
    const slot = card.querySelector('[data-program-guide]');
    if (!slot || shouldPreserve(slot)) return;

    const text = slot.textContent || '';
    if (!slot.classList.contains('is-profile') && !/PROGRAMMING PROFILE/i.test(text)) return;

    const station = stationFrom(card);
    const language = languageFrom(card);
    const transmitter = transmitterFrom(card);
    const schedule = scheduleFrom(card);
    const frequency = frequencyFrom(card);
    const source = sourceFrom(card);
    const context = existingContext(slot);

    const cleanLanguage = language && !/unknown/i.test(language) ? language : '';
    const title = `${station}${cleanLanguage ? ` — ${cleanLanguage} service` : ''}`;
    const carrier = [frequency ? `on ${frequency}` : '', transmitter ? `from ${transmitter}` : '']
      .filter(Boolean).join(' ');
    const evidence = source ? `Schedule source: ${source}.` : '';
    const note = `This service is scheduled on this carrier now${carrier ? `, ${carrier}` : ''}. FREQBEACON has not resolved a trustworthy named show for this exact carrier and minute yet.`;
    const signature = [title,schedule.local,schedule.utc,carrier,source].join('|');

    if (slot.dataset.scheduledServiceSignature === signature && /SCHEDULED SERVICE/i.test(slot.textContent || '')) return;

    slot.classList.remove('is-loading','is-warning','is-service');
    slot.classList.add('is-service','is-profile','is-scheduled-service');
    slot.dataset.scheduledServiceSignature = signature;
    // Intentionally retain authoritySignature. The older profile authority then
    // considers its fallback satisfied, while later exact resolvers can still
    // replace this card with VERIFIED / VERIFIED BROADCAST.
    slot.innerHTML = `
      <div class="program-guide-kicker"><span class="program-profile-dot"></span>ON NOW · SCHEDULED SERVICE</div>
      <div class="program-guide-title">${esc(title)}</div>
      ${schedule.local ? `<div class="program-guide-window">${esc(schedule.local)}</div>` : ''}
      ${schedule.utc ? `<div class="program-guide-window program-guide-window-utc">${esc(schedule.utc)}</div>` : ''}
      <div class="program-guide-note">${esc(note)}</div>
      ${context ? `<div class="program-guide-note program-guide-service-context">${esc(context)}</div>` : ''}
      ${evidence ? `<div class="program-guide-source-static">${esc(evidence)}</div>` : ''}`;
  }

  function scan() {
    queued = false;
    document.querySelectorAll('.signal-card, .lookup-result').forEach(render);
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(scan);
  }

  const style = document.createElement('style');
  style.textContent = `
    .program-guide-card.is-scheduled-service .program-guide-kicker{color:#8ccbd5;}
    .program-guide-card.is-scheduled-service .program-guide-window-utc{margin-top:3px;color:#8fa4bc;font-size:.88em;}
    .program-guide-card.is-scheduled-service .program-guide-service-context{margin-top:10px;padding-top:10px;border-top:1px solid rgba(86,167,185,.16);}
    .program-guide-source-static{margin-top:10px;color:#7fb6c7;font-family:var(--mono,monospace);font-size:.78em;letter-spacing:.04em;}
  `;
  document.head.appendChild(style);

  new MutationObserver(queue).observe(document.body,{
    subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class']
  });
  queue();
  setTimeout(queue,600);
  setTimeout(queue,1600);
  setTimeout(queue,3600);
})();
