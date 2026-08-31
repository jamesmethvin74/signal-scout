(() => {
  if (window.__freqbeaconRfReliabilityV3) return;
  window.__freqbeaconRfReliabilityV3 = true;

  // Audio connection health/failover is owned by sdr-connection-manager.js.
  // This file has one narrow responsibility: when amateur-band audio is live
  // but the paired Kiwi W/F stream cannot produce waterfall rows, optionally
  // try a small number of the already geography-ranked nearby alternatives.
  // A W/F failure is never written into audio receiver health.
  const MAX_HAM_RF_FALLBACKS = 3;
  const state = {
    attemptedNames: new Set(),
    switches: 0,
    lastSignature: '',
    busy: false
  };

  function hamViewActive() {
    return document.getElementById('signalGrid')?.dataset.hamView === 'true';
  }

  function audioIsLive() {
    return String(document.querySelector('[data-sdr-status]')?.textContent || '').trim().toLowerCase() === 'live rf';
  }

  function currentReceiverName() {
    return document.querySelector('[data-sdr-receiver-button-name]')?.textContent?.trim() || '';
  }

  function rfFailureText(text) {
    return /RF WATERFALL TIMEOUT|no W\/F rows|sent no W\/F rows|RF STREAM CLOSED|RF SOCKET ERROR/i.test(String(text || ''));
  }

  function reset() {
    state.attemptedNames.clear();
    state.switches = 0;
    state.lastSignature = '';
    state.busy = false;
  }

  function setMessage(text, error = false) {
    const message = document.querySelector('[data-sdr-message]');
    if (!message) return;
    message.textContent = text;
    message.classList.toggle('is-error', error);
  }

  function tryNextHamRfReceiver(messageText) {
    if (!hamViewActive() || !audioIsLive() || state.busy || !rfFailureText(messageText)) return;
    const current = currentReceiverName();
    const signature = `${current}|${String(messageText).trim()}`;
    if (!current || signature === state.lastSignature) return;
    state.lastSignature = signature;
    state.attemptedNames.add(current);

    if (state.switches >= MAX_HAM_RF_FALLBACKS) {
      setMessage('Receiver audio is live, but the nearby SDRs tried so far did not provide RF waterfall rows. Audio remains valid; choose another receiver manually if you want to keep testing the waterfall.', true);
      return;
    }

    state.busy = true;
    document.querySelector('[data-sdr-receiver-button]')?.click();
    window.setTimeout(() => {
      const choices = [...document.querySelectorAll('[data-sdr-choice-index]')];
      const next = choices.find((choice) => {
        if (choice.classList.contains('is-selected')) return false;
        const name = choice.querySelector('.sdr-choice-name')?.textContent?.trim() || '';
        return name && !state.attemptedNames.has(name);
      });
      if (!next) {
        document.querySelector('[data-sdr-chooser-close]')?.click();
        setMessage('Receiver audio is live, but there is no untried nearby SDR left for an automatic waterfall check. Audio remains valid.', true);
        state.busy = false;
        return;
      }
      const name = next.querySelector('.sdr-choice-name')?.textContent?.trim() || '';
      if (name) state.attemptedNames.add(name);
      state.switches += 1;
      next.click();
      state.busy = false;
    }, 100);
  }

  function installWatcher() {
    const message = document.querySelector('[data-sdr-message]');
    if (!message || message.dataset.freqbeaconRfReliability === '1') return false;
    message.dataset.freqbeaconRfReliability = '1';
    const observer = new MutationObserver(() => tryNextHamRfReceiver(message.textContent || ''));
    observer.observe(message, { childList:true, characterData:true, subtree:true });
    return true;
  }

  if (!installWatcher()) {
    const discovery = new MutationObserver(() => {
      if (installWatcher()) discovery.disconnect();
    });
    discovery.observe(document.documentElement, { childList:true, subtree:true });
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('.listen-live-button')) reset();
  }, true);
})();
