(() => {
  const NOMINAL_SW_BANDS = [120, 90, 75, 60, 49, 41, 31, 25, 22, 19, 16, 15, 13, 11];

  function installStyles() {
    if (document.getElementById('signal-scout-antenna-styles')) return;
    const style = document.createElement('style');
    style.id = 'signal-scout-antenna-styles';
    style.textContent = `
      .antenna-guide {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid rgba(255,255,255,.07);
      }
      .antenna-guide-title {
        margin-bottom: 7px;
        color: #f4f7fb;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: .02em;
      }
      .antenna-options {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .antenna-option {
        border: 1px solid #24415f;
        border-radius: 999px;
        background: #19304e;
        color: #cfe0f2;
        padding: 6px 9px;
        font-size: 11px;
        font-weight: 750;
        line-height: 1.2;
      }
      .antenna-option strong { color: #f4f7fb; }
      .antenna-option.good { border-color: rgba(78,224,161,.45); }
      .antenna-option.maybe { border-color: rgba(255,200,106,.5); }
      .antenna-option.off { opacity: .72; }
      .band-detail b { color: #8de5ff; }
    `;
    document.head.appendChild(style);
  }

  function nearestShortwaveBand(frequencyKHz) {
    const wavelengthMeters = 300000 / frequencyKHz;
    return NOMINAL_SW_BANDS.reduce((nearest, band) =>
      Math.abs(band - wavelengthMeters) < Math.abs(nearest - wavelengthMeters) ? band : nearest
    );
  }

  function cardFrequency(card) {
    const frequencyElement = card.querySelector('.frequency');
    const unitElement = frequencyElement?.querySelector('span');
    if (!frequencyElement || !unitElement) return null;

    const unit = unitElement.textContent.trim();
    const valueNode = [...frequencyElement.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    const value = Number((valueNode?.textContent || '').replace(/,/g, '').trim());
    if (!Number.isFinite(value)) return null;
    return { value, unit };
  }

  function cardBandLabel(card) {
    const frequency = cardFrequency(card);
    if (!frequency) return null;

    if (frequency.unit === 'MHz') {
      return `${nearestShortwaveBand(frequency.value * 1000)}m shortwave`;
    }
    if (frequency.unit === 'kHz') return 'Medium wave (AM)';
    return null;
  }

  function cardReceptionScore(card) {
    const scoreText = card.querySelector('.score small')?.textContent || '';
    const score = Number(scoreText.split('/')[0]);
    return Number.isFinite(score) ? score : 50;
  }

  function strengthStatus(score) {
    if (score >= 80) return ['Likely', 'good'];
    if (score >= 62) return ['Worth trying', 'good'];
    if (score >= 42) return ['Marginal', 'maybe'];
    return ['Unlikely', 'off'];
  }

  function antennaRecommendations(card) {
    const frequency = cardFrequency(card);
    if (!frequency) return [];
    const score = cardReceptionScore(card);
    const [baseStatus, baseClass] = strengthStatus(score);

    if (frequency.unit === 'MHz') {
      let wireStatus = 'Optional';
      let wireClass = 'good';
      if (score < 80 && score >= 62) wireStatus = 'Helpful';
      if (score < 62 && score >= 42) {
        wireStatus = 'Often helpful';
        wireClass = 'maybe';
      }
      if (score < 42) {
        wireStatus = 'Try a wire';
        wireClass = 'maybe';
      }

      return [
        { name: 'Telescopic', status: baseStatus, cls: baseClass },
        { name: 'Ferrite bar', status: 'Not used for SW', cls: 'off' },
        { name: 'Added wire', status: wireStatus, cls: wireClass }
      ];
    }

    let wireStatus = 'Not needed';
    let wireClass = 'good';
    if (score < 75 && score >= 50) {
      wireStatus = 'May help';
      wireClass = 'maybe';
    }
    if (score < 50) {
      wireStatus = 'Loop usually better';
      wireClass = 'maybe';
    }

    return [
      { name: 'Telescopic', status: 'Usually inactive', cls: 'off' },
      { name: 'Ferrite bar', status: baseStatus, cls: baseClass },
      { name: 'Added wire', status: wireStatus, cls: wireClass }
    ];
  }

  function decorateCard(card) {
    const bandLabel = cardBandLabel(card);
    if (!bandLabel) return;

    const tags = card.querySelector('.tags');
    if (tags && !tags.querySelector('[data-band-label]')) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.dataset.bandLabel = 'true';
      tag.textContent = bandLabel;
      tags.prepend(tag);
    }

    const details = card.querySelector('.details');
    if (details && !details.querySelector('[data-band-detail]')) {
      const detail = document.createElement('div');
      detail.className = 'detail band-detail';
      detail.dataset.bandDetail = 'true';
      detail.innerHTML = `Band<b>${bandLabel}</b>`;
      details.prepend(detail);
    }

    if (!card.querySelector('[data-antenna-guide]')) {
      const recommendations = antennaRecommendations(card);
      const guide = document.createElement('div');
      guide.className = 'antenna-guide';
      guide.dataset.antennaGuide = 'true';
      guide.innerHTML = `
        <div class="antenna-guide-title">Antenna starting point</div>
        <div class="antenna-options">
          ${recommendations.map((item) => `<span class="antenna-option ${item.cls}"><strong>${item.name}:</strong> ${item.status}</span>`).join('')}
        </div>`;
      const why = card.querySelector('.why');
      if (why) card.insertBefore(guide, why);
      else card.appendChild(guide);
    }
  }

  function decorateCards() {
    document.querySelectorAll('.signal-card').forEach(decorateCard);
  }

  installStyles();
  const grid = document.getElementById('signalGrid');
  if (!grid) return;

  const observer = new MutationObserver(decorateCards);
  observer.observe(grid, { childList: true, subtree: true });
  decorateCards();
})();
