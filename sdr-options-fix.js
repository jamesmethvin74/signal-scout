(() => {
  const trace = (event, detail = {}) => window.__freqbeaconSdrTrace?.(`options-${event}`, detail);

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
    if (!Number.isFinite(frequency)) {
      trace('context-failed', { reason: 'invalid-card-frequency' });
      return false;
    }

    const input = document.getElementById('lookupFrequency');
    if (!input) {
      trace('context-failed', { reason: 'lookup-frequency-input-missing', frequency });
      return false;
    }

    input.value = Number.isInteger(frequency) ? String(frequency) : frequency.toFixed(1);
    input.dispatchEvent(new Event('input', { bubbles: false }));

    const primary = document.querySelector('#lookupResults .lookup-result-primary, #lookupResults .lookup-result');
    if (primary) {
      const frequencyText = `${Number.isInteger(frequency) ? frequency.toLocaleString() : frequency.toLocaleString(undefined, { maximumFractionDigits: 1 })} kHz`;
      setPlainTextNode(primary.querySelector('.lookup-result-frequency'), frequencyText);
      const stationName = card.querySelector('.station-name')?.textContent?.trim();
      if (stationName) setPlainTextNode(primary.querySelector('h3'), stationName);
    }
    trace('context-prepared', {
      frequency,
      inputValue: input.value,
      station: card.querySelector('.station-name')?.textContent?.trim() || '',
      primaryLookupResultPresent: Boolean(primary)
    });
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
    trace('chooser-polished', { choiceCount: list.querySelectorAll('.sdr-choice').length });
    return true;
  }

  function scheduleChooserPolish(attempt = 0) {
    window.clearTimeout(polishTimer);
    polishTimer = window.setTimeout(() => {
      if (polishChooser()) return;
      if (attempt < 8) scheduleChooserPolish(attempt + 1);
      else trace('chooser-polish-exhausted');
    }, attempt === 0 ? 0 : 350);
  }

  function openReceiverOptions(card) {
    trace('open-start');
    if (!prepareReceiverContext(card)) return;
    const smartButton = document.getElementById('lookupReceiverButton');
    if (!smartButton) {
      trace('open-failed', { reason: 'smart-button-missing' });
      return;
    }

    const openPlayer = document.querySelector('#sdrPlayer:not([hidden])');
    trace('open-before-player-close', { openPlayer: Boolean(openPlayer), smartButtonText: smartButton.textContent?.trim().replace(/\s+/g, ' ') || '' });
    if (openPlayer) openPlayer.querySelector('[data-sdr-close]')?.click();

    window.requestAnimationFrame(() => {
      trace('raf-before-smart-click', { lookupFrequency: document.getElementById('lookupFrequency')?.value || '' });
      smartButton.click();
      trace('raf-after-smart-click', {
        chooserHidden: document.querySelector('.sdr-chooser')?.hidden ?? null,
        choiceCount: document.querySelectorAll('.sdr-chooser .sdr-choice').length
      });
      scheduleChooserPolish();
    });
  }

  window.addEventListener('click', (event) => {
    const button = event.target.closest('.card-receiver-options');
    if (!button) return;
    const card = button.closest('.signal-card');
    trace('card-click-handler-enter', {
      defaultPrevented: event.defaultPrevented,
      isTrusted: event.isTrusted,
      tag: button.tagName,
      type: button.getAttribute('type'),
      href: button.getAttribute('href'),
      cardFound: Boolean(card)
    });
    if (!card) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    trace('card-click-prevented', { defaultPrevented: event.defaultPrevented });
    openReceiverOptions(card);
  }, true);

  document.getElementById('lookupReceiverButton')?.addEventListener('click', () => {
    trace('lookup-smart-button-handler-observed');
    scheduleChooserPolish();
  });
})();
