(() => {
  const NOMINAL_SW_BANDS = [120, 90, 75, 60, 49, 41, 31, 25, 22, 19, 16, 15, 13, 11];

  function nearestShortwaveBand(frequencyKHz) {
    const wavelengthMeters = 300000 / frequencyKHz;
    return NOMINAL_SW_BANDS.reduce((nearest, band) =>
      Math.abs(band - wavelengthMeters) < Math.abs(nearest - wavelengthMeters) ? band : nearest
    );
  }

  function cardBandLabel(card) {
    const frequencyElement = card.querySelector('.frequency');
    const unitElement = frequencyElement?.querySelector('span');
    if (!frequencyElement || !unitElement) return null;

    const unit = unitElement.textContent.trim();
    const valueNode = [...frequencyElement.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    const value = Number((valueNode?.textContent || '').replace(/,/g, '').trim());
    if (!Number.isFinite(value)) return null;

    if (unit === 'MHz') {
      const frequencyKHz = value * 1000;
      return `${nearestShortwaveBand(frequencyKHz)}m band`;
    }

    if (unit === 'kHz') return 'Medium wave · AM';
    return null;
  }

  function decorateCards() {
    document.querySelectorAll('.signal-card').forEach((card) => {
      const tags = card.querySelector('.tags');
      if (!tags || tags.querySelector('[data-band-label]')) return;

      const label = cardBandLabel(card);
      if (!label) return;

      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.dataset.bandLabel = 'true';
      tag.textContent = label;
      tags.prepend(tag);
    });
  }

  const grid = document.getElementById('signalGrid');
  if (!grid) return;

  const observer = new MutationObserver(decorateCards);
  observer.observe(grid, { childList: true, subtree: true });
  decorateCards();
})();
