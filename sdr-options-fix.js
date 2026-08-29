(() => {
  function normalizeText(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function setTextIfChanged(element, text) {
    if (element && element.textContent !== text) element.textContent = text;
  }

  function setPlainTextNode(element, text) {
    if (!element) return;
    if (element.childNodes.length === 1 && element.firstChild?.nodeType === Node.TEXT_NODE) {
      if (element.firstChild.nodeValue !== text) element.firstChild.nodeValue = text;
      return;
    }
    setTextIfChanged(element, text);
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

  function prepareReceiverContext(card) {
    const frequency = frequencyFromCard(card);
    if (!Number.isFinite(frequency)) return false;

    const input = document.getElementById('lookupFrequency');
    if (!input) return false;

    // Receiver options used to call lookupSubmit.click(), which synchronously
    // rendered the entire hidden Lookup results tree before opening the chooser.
    // On Android that stacked Lookup rendering, Lookup observers, receiver
    // ranking, and chooser rendering into one tap. Receiver selection only needs
    // a frequency/station context, so provide that context without running Lookup.
    input.value = Number.isInteger(frequency) ? String(frequency) : frequency.toFixed(1);
    input.dispatchEvent(new Event('input', { bubbles: false }));

    // If Lookup was used earlier in this session, refresh the lightweight
    // primary-result context in place so sdr-player.js does not rank the old
    // frequency. Updating existing text nodes does not trigger the child-list
    // observer used by the Lookup recommendation scheduler.
    const primary = document.querySelector('#lookupResults .lookup-result-primary, #lookupResults .lookup-result');
    if (primary) {
      const frequencyText = `${Number.isInteger(frequency) ? frequency.toLocaleString() : frequency.toLocaleString(undefined, { maximumFractionDigits: 1 })} kHz`;
      setPlainTextNode(primary.querySelector('.lookup-result-frequency'), frequencyText);
      const stationName = card.querySelector('.station-name')?.textContent?.trim();
      if (stationName) setPlainTextNode(primary.querySelector('h3'), stationName);
    }
    return true;
  }

  let polishTimer = null;

  function polishChooser() {
    const chooser = document.querySelector('.sdr-chooser');
    const list = chooser?.querySelector('[data-sdr-chooser-list]');
    if (!chooser || chooser.hidden || !list?.children.length) return false;

    const subtitle = chooser.querySelector('[data-sdr-chooser-subtitle]');
    if (subtitle) {
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
    return true;
  }

  function scheduleChooserPolish(attempt = 0) {
    window.clearTimeout(polishTimer);
    polishTimer = window.setTimeout(() => {
      if (polishChooser()) return;
      if (attempt < 8) scheduleChooserPolish(attempt + 1);
    }, attempt === 0 ? 0 : 350);
  }

  function openReceiverOptions(card) {
    if (!prepareReceiverContext(card)) return;
    const smartButton = document.getElementById('lookupReceiverButton');
    if (!smartButton) return;

    const openPlayer = document.querySelector('#sdrPlayer:not([hidden])');
    if (openPlayer) openPlayer.querySelector('[data-sdr-close]')?.click();

    // Open the existing smart chooser directly. No hidden Lookup submit, no
    // smooth-scroll/navigation path, and no full Lookup-results DOM rebuild.
    window.requestAnimationFrame(() => {
      smartButton.click();
      scheduleChooserPolish();
    });
  }

  // The original Receiver options button predates the smart receiver chooser
  // and routes to Lookup. Intercept it before that legacy target handler runs.
  window.addEventListener('click', (event) => {
    const button = event.target.closest('.card-receiver-options');
    if (!button) return;
    const card = button.closest('.signal-card');
    if (!card) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    openReceiverOptions(card);
  }, true);

  // Polish only after an intentional chooser open. Do not observe chooser DOM
  // mutations: an earlier version created a feedback loop that could freeze the
  // browser when the receiver list was rendered or rewritten.
  document.getElementById('lookupReceiverButton')?.addEventListener('click', () => {
    scheduleChooserPolish();
  });
})();
