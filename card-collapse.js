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
