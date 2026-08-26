(() => {
  function normalizeText(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function setTextIfChanged(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  function frequencyFromCard(card) {
    const freqEl = card?.querySelector('.frequency');
    if (!freqEl) return null;
    const unit = freqEl.querySelector('span')?.textContent?.trim().toLowerCase() || '';
    const clone = freqEl.cloneNode(true);
    clone.querySelector('span')?.remove();
    const value = Number(clone.textContent.replace(/,/g, '').trim());
    if (!Number.isFinite(value) || value <= 0) return null;
    return unit.includes('mhz') ? value * 1000 : value;
  }

  function lookupResultFrequency(result) {
    const text = result?.querySelector('.lookup-result-frequency')?.textContent || '';
    const value = Number(text.replace(/[^0-9.]/g, ''));
    return Number.isFinite(value) ? value : null;
  }

  function prepareLookupContext(card) {
    const frequency = frequencyFromCard(card);
    if (!Number.isFinite(frequency)) return false;

    const input = document.getElementById('lookupFrequency');
    const submit = document.getElementById('lookupSubmit');
    if (!input || !submit) return false;

    input.value = Number.isInteger(frequency) ? String(frequency) : frequency.toFixed(1);
    submit.click();

    const stationName = normalizeText(card.querySelector('.station-name')?.textContent);
    const results = [...document.querySelectorAll('#lookupResults .lookup-result')];
    const matching = results.find((result) => {
      const name = normalizeText(result.querySelector('h3')?.textContent);
      const resultFrequency = lookupResultFrequency(result);
      return name === stationName && Number.isFinite(resultFrequency) && Math.abs(resultFrequency - frequency) < 0.11;
    });

    if (matching) {
      results.forEach((result) => result.classList.remove('lookup-result-primary'));
      matching.classList.add('lookup-result-primary');
    }
    return true;
  }

  function openReceiverOptions(card) {
    if (!prepareLookupContext(card)) return;
    const smartButton = document.getElementById('lookupReceiverButton');
    if (!smartButton) return;

    const openPlayer = document.querySelector('#sdrPlayer:not([hidden])');
    if (openPlayer) openPlayer.querySelector('[data-sdr-close]')?.click();

    smartButton.click();
  }

  // The original Receiver options button predates the smart receiver chooser and
  // routes to Lookup. Intercept it before that legacy target handler runs and
  // open the chooser for the card that was actually tapped.
  window.addEventListener('click', (event) => {
    const button = event.target.closest('.card-receiver-options');
    if (!button) return;
    const card = button.closest('.signal-card');
    if (!card) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    openReceiverOptions(card);
  }, true);

  let polishing = false;

  function polishChooser() {
    if (polishing) return;
    const chooser = document.querySelector('.sdr-chooser');
    const list = chooser?.querySelector('[data-sdr-chooser-list]');
    if (!list) return;

    polishing = true;
    try {
      const subtitle = chooser.querySelector('[data-sdr-chooser-subtitle]');
      if (subtitle && !subtitle.dataset.purposeExplained) {
        subtitle.dataset.purposeExplained = 'true';
        const rankedText = subtitle.textContent.replace(/\s*★.*$/, '').trim();
        setTextIfChanged(subtitle, `${rankedText} ★ marks the best match for what you may hear at your location.`);
      }

      const seen = new Set();
      [...list.querySelectorAll('.sdr-choice')].forEach((choice) => {
        const name = normalizeText(choice.querySelector('.sdr-choice-name')?.textContent);
        const location = normalizeText(choice.querySelector('.sdr-choice-location')?.textContent);
        const distance = normalizeText(choice.querySelector('.sdr-choice-distance')?.textContent);
        const key = `${name}|${location}|${distance}`;

        if (seen.has(key)) {
          choice.remove();
          return;
        }
        seen.add(key);

        const recommended = choice.querySelector('.sdr-choice-badge.is-recommended');
        const roleBadges = [...choice.querySelectorAll('.sdr-choice-badge:not(.is-recommended)')]
          .map((badge) => normalizeText(badge.textContent));
        const reason = choice.querySelector('.sdr-choice-reason');

        if (recommended) {
          setTextIfChanged(recommended, '★ Best match for you');
          if (reason && roleBadges.includes('near you')) {
            setTextIfChanged(reason, 'Best receiver for comparing with what your radio is likely to hear at your location. It is nearby and still follows a useful HF path.');
          } else if (reason) {
            setTextIfChanged(reason, 'Best overall receiver for comparing against your location, considering distance, path, frequency, and current day/night conditions.');
          }
        }

        if (reason && roleBadges.includes('station check')) {
          setTextIfChanged(reason, 'Best used to check whether the transmitter appears active. It is not necessarily the best receiver for matching what you should hear at your location.');
        }
      });
    } finally {
      polishing = false;
    }
  }

  const chooser = document.querySelector('.sdr-chooser');
  if (chooser) {
    const observer = new MutationObserver(polishChooser);
    observer.observe(chooser, { childList: true, subtree: true, characterData: true });
    polishChooser();
  }
})();
