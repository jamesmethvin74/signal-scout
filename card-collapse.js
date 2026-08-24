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

  function receptionMeterClass(score) {
    if (score >= 80) return 'meter-excellent';
    if (score >= 62) return 'meter-good';
    if (score >= 42) return 'meter-possible';
    return 'meter-long';
  }

  function decorateReceptionMeter(card) {
    const meter = card.querySelector('.score-meter');
    const scoreText = card.querySelector('.score small')?.textContent || '';
    const score = Number(scoreText.split('/')[0]);
    if (!meter || !Number.isFinite(score)) return;

    meter.classList.remove('meter-excellent', 'meter-good', 'meter-possible', 'meter-long');
    meter.classList.add(receptionMeterClass(score));
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
      background: repeating-linear-gradient(90deg, #14262c 0 5px, transparent 5px 7px) !important;
      border-color: #254047 !important;
    }

    .score-meter i {
      display: block;
      height: 100%;
      border-radius: 0 !important;
      background: repeating-linear-gradient(90deg, currentColor 0 5px, transparent 5px 7px) !important;
      filter: drop-shadow(0 0 2px currentColor);
    }

    .score-meter.meter-excellent i { color: #61e786; }
    .score-meter.meter-good i { color: #c7df5a; }
    .score-meter.meter-possible i { color: #efbd5c; }
    .score-meter.meter-long i { color: #ff7077; }

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
