(() => {
  function detailLabel(detail) {
    const first = detail?.childNodes?.[0];
    return String(first?.textContent || '').trim().toLowerCase();
  }

  function markSummaryDetails(card) {
    card.querySelectorAll('.details .detail').forEach((detail) => {
      const label = detailLabel(detail);
      detail.classList.toggle('collapse-summary-detail', label === 'band' || label === 'schedule');
    });
  }

  function addTransmitterSummary(card) {
    if (card.querySelector('[data-transmitter-summary]')) return;

    const transmitterDetail = [...card.querySelectorAll('.details .detail')]
      .find((detail) => detailLabel(detail) === 'transmitter');
    const transmitter = transmitterDetail?.querySelector('b')?.textContent?.trim();
    if (!transmitter) return;

    const country = card.querySelector('.tags .tag:not([data-band-label])')?.textContent?.trim() || '';
    const transmitterLower = transmitter.toLowerCase();
    const countryLower = country.toLowerCase();
    const location = country && transmitterLower !== countryLower && !transmitterLower.includes(countryLower)
      ? `${transmitter}, ${country}`
      : transmitter;

    const line = document.createElement('div');
    line.className = 'station-description transmitter-summary';
    line.dataset.transmitterSummary = 'true';
    line.textContent = `Transmitter: ${location}`;

    const description = card.querySelector('.station-description');
    const stationName = card.querySelector('.station-name');
    if (description) description.insertAdjacentElement('afterend', line);
    else if (stationName) stationName.insertAdjacentElement('afterend', line);
  }

  function decorateReceptionMeter(card) {
    const meter = card.querySelector('.score-meter');
    const scoreText = card.querySelector('.score small')?.textContent || '';
    const score = Number(scoreText.split('/')[0]);
    if (!meter || !Number.isFinite(score)) return;

    const clampedScore = Math.max(0, Math.min(100, score));
    meter.style.setProperty('--score-position', `${clampedScore}%`);
    meter.setAttribute('role', 'meter');
    meter.setAttribute('aria-valuemin', '0');
    meter.setAttribute('aria-valuemax', '100');
    meter.setAttribute('aria-valuenow', String(score));
    meter.setAttribute('aria-label', `Reception score ${score} out of 100`);
  }

  function setExpanded(card, expanded) {
    card.classList.toggle('card-expanded', expanded);
    card.classList.toggle('card-collapsed', !expanded);
    const button = card.querySelector('[data-card-toggle]');
    if (button) {
      button.setAttribute('aria-expanded', String(expanded));
      button.innerHTML = expanded
        ? '<span>Less details</span><span aria-hidden="true">⌃</span>'
        : '<span>More details</span><span aria-hidden="true">⌄</span>';
    }
  }

  function decorateCard(card) {
    if (!card.classList.contains('signal-card')) return;
    markSummaryDetails(card);
    addTransmitterSummary(card);
    decorateReceptionMeter(card);

    if (!card.querySelector('[data-card-toggle]')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'card-toggle';
      button.dataset.cardToggle = 'true';
      button.setAttribute('aria-expanded', 'false');
      button.innerHTML = '<span>More details</span><span aria-hidden="true">⌄</span>';
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        setExpanded(card, !card.classList.contains('card-expanded'));
      });
      card.appendChild(button);
    }

    if (!card.classList.contains('card-expanded') && !card.classList.contains('card-collapsed')) {
      setExpanded(card, false);
    }
  }

  function decorateCards() {
    document.querySelectorAll('.signal-card').forEach(decorateCard);
  }

  const style = document.createElement('style');
  style.id = 'signal-scout-collapse-styles';
  style.textContent = `
    .transmitter-summary {
      margin-top: 2px;
      color: #b7c8da;
    }

    .score-meter {
      --score-position: 50%;
      position: relative !important;
      width: 96px !important;
      height: 12px !important;
      overflow: visible !important;
      margin-top: 10px !important;
      margin-bottom: 7px !important;
      border: 1px solid #31464b !important;
      border-radius: 2px !important;
      padding: 1px !important;
      background:
        repeating-linear-gradient(90deg, transparent 0 5px, #05090c 5px 7px),
        linear-gradient(90deg,
          #f0444f 0%,
          #f0444f 38%,
          #f2dc3f 38%,
          #f2dc3f 62%,
          #55d52d 62%,
          #55d52d 100%) !important;
      box-shadow: inset 0 0 8px rgba(0,0,0,.38);
    }

    .score-meter i {
      display: none !important;
    }

    .score-meter::before,
    .score-meter::after {
      content: '';
      position: absolute;
      left: var(--score-position);
      z-index: 2;
      width: 0;
      height: 0;
      transform: translateX(-50%);
      filter: drop-shadow(0 0 2px rgba(255,255,255,.25));
      pointer-events: none;
    }

    .score-meter::before {
      top: -8px;
      border-left: 4px solid transparent;
      border-right: 4px solid transparent;
      border-top: 6px solid #d8e2e4;
    }

    .score-meter::after {
      bottom: -8px;
      border-left: 4px solid transparent;
      border-right: 4px solid transparent;
      border-bottom: 6px solid #d8e2e4;
    }

    .card-toggle {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-top: 12px;
      padding: 9px 2px 2px;
      border: 0;
      border-top: 1px solid rgba(255,255,255,.07);
      color: #9fdff7;
      background: transparent;
      font-size: 12px;
      font-weight: 850;
      text-align: left;
    }
    .card-toggle span:last-child { font-size: 16px; line-height: 1; }

    .signal-card.card-collapsed .details .detail:not(.collapse-summary-detail) { display: none; }
    .signal-card.card-collapsed .antenna-guide,
    .signal-card.card-collapsed .station-about,
    .signal-card.card-collapsed .why { display: none !important; }

    .signal-card.card-collapsed .details {
      grid-template-columns: repeat(2, minmax(0,1fr));
      margin-top: 10px;
      padding-top: 10px;
    }

    .signal-card.card-collapsed { min-height: 0; }
    .signal-card.card-expanded .details .detail { display: block; }

    @media (max-width: 420px) {
      .signal-card.card-collapsed .details { grid-template-columns: 1fr 1fr; }
    }
  `;
  document.head.appendChild(style);

  const grid = document.getElementById('signalGrid');
  if (!grid) return;
  new MutationObserver(() => window.requestAnimationFrame(decorateCards)).observe(grid, { childList: true, subtree: true });
  decorateCards();
})();

(() => {
  if (!document.querySelector('link[data-arctic-picker]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'arctic-picker.css?v=1';
    link.dataset.arcticPicker = 'true';
    document.head.appendChild(link);
  }

  if (!document.querySelector('script[data-arctic-picker]')) {
    const script = document.createElement('script');
    script.src = 'arctic-picker.js?v=1';
    script.dataset.arcticPicker = 'true';
    document.body.appendChild(script);
  }
})();
