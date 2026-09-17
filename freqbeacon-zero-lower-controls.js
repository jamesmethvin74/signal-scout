(() => {
  'use strict';

  const volumeControl = document.querySelector('.volume-block .hardware-slider');
  const muteButton = document.querySelector('#mute');
  const agcControl = document.querySelector('.agc-switch');
  const agcLabel = agcControl?.querySelector('b');
  const agcOptions = agcControl?.querySelector('small');
  const gainControl = document.querySelector('.gain-block .mini-knob');
  const gainValue = document.querySelector('#rfGainValue');
  const advButton = document.querySelector('.adv-button');
  const hardwareDeck = document.querySelector('.hardware-deck');
  const power = document.querySelector('#power');

  let outputGainNode = null;
  let sndSocket = null;
  let volume = 82;
  let muted = muteButton?.getAttribute('aria-pressed') === 'true';
  let agcMode = 'fast';
  let manualGain = 50;
  let gainPointerId = null;
  let gainStartX = 0;
  let gainStartY = 0;
  let gainStartValue = manualGain;
  let gainMoved = false;
  let lastGainSendAt = 0;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  // Capture the one Web Audio gain node created by the qualified Zero engine.
  // This keeps volume control in the shell and does not change socket/session code.
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (AudioContextCtor?.prototype?.createGain) {
    const nativeCreateGain = AudioContextCtor.prototype.createGain;
    AudioContextCtor.prototype.createGain = function zeroShellCreateGain() {
      const node = nativeCreateGain.call(this);
      outputGainNode = node;
      window.setTimeout(applyVolume, 0);
      return node;
    };
  }

  // Observe the existing qualified SND socket without owning or replacing it.
  const shellSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function zeroLowerControlsSend(data) {
    if (typeof data === 'string') {
      if (data.includes('SERVER DE CLIENT FREQBEACON-ZERO SND')) sndSocket = this;
      if (/^SET\s+agc=/.test(data) && this === sndSocket) data = agcCommand();
    }
    return shellSend.call(this, data);
  };

  function radioRunning() {
    return power?.getAttribute('aria-pressed') === 'true' && sndSocket?.readyState === WebSocket.OPEN;
  }

  function applyVolume() {
    if (!outputGainNode) return;
    const next = muted ? 0 : volume / 100;
    try {
      outputGainNode.gain.value = next;
    } catch {}
  }

  function renderVolume() {
    if (!volumeControl) return;
    volumeControl.style.setProperty('--volume-pct', `${volume}%`);
    volumeControl.setAttribute('aria-valuenow', String(volume));
    volumeControl.setAttribute('aria-valuetext', `${volume} percent`);
    updateAdvancedReadout();
  }

  function setVolumeFromClientX(clientX) {
    if (!volumeControl) return;
    const rect = volumeControl.getBoundingClientRect();
    if (!rect.width) return;
    volume = Math.round(clamp((clientX - rect.left) / rect.width, 0, 1) * 100);
    renderVolume();
    applyVolume();
  }

  if (volumeControl) {
    volumeControl.classList.remove('static-slider');
    volumeControl.classList.add('is-interactive');
    volumeControl.removeAttribute('aria-hidden');
    volumeControl.setAttribute('role', 'slider');
    volumeControl.setAttribute('tabindex', '0');
    volumeControl.setAttribute('aria-label', 'Volume');
    volumeControl.setAttribute('aria-valuemin', '0');
    volumeControl.setAttribute('aria-valuemax', '100');

    let volumePointerId = null;
    volumeControl.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      volumePointerId = event.pointerId;
      try { volumeControl.setPointerCapture(event.pointerId); } catch {}
      setVolumeFromClientX(event.clientX);
    });
    volumeControl.addEventListener('pointermove', (event) => {
      if (volumePointerId !== event.pointerId) return;
      event.preventDefault();
      setVolumeFromClientX(event.clientX);
    });
    const endVolume = (event) => {
      if (volumePointerId !== event.pointerId) return;
      event.preventDefault();
      setVolumeFromClientX(event.clientX);
      try { volumeControl.releasePointerCapture(event.pointerId); } catch {}
      volumePointerId = null;
    };
    volumeControl.addEventListener('pointerup', endVolume);
    volumeControl.addEventListener('pointercancel', () => { volumePointerId = null; });
    volumeControl.addEventListener('keydown', (event) => {
      const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 5
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -5 : 0;
      if (!delta) return;
      event.preventDefault();
      volume = clamp(volume + delta, 0, 100);
      renderVolume();
      applyVolume();
    });
  }

  function agcCommand() {
    if (agcMode === 'off') {
      return `SET agc=0 hang=0 thresh=-100 slope=6 decay=1000 manGain=${manualGain}`;
    }
    if (agcMode === 'slow') {
      return 'SET agc=1 hang=1 thresh=-100 slope=6 decay=2000 manGain=50';
    }
    // FAST intentionally starts from the exact qualified-engine AGC command.
    return 'SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50';
  }

  function sendAgc(force = false) {
    if (!radioRunning()) return;
    const now = performance.now();
    if (!force && now - lastGainSendAt < 80) return;
    lastGainSendAt = now;
    try { shellSend.call(sndSocket, agcCommand()); } catch {}
  }

  function renderAgc() {
    if (!agcControl) return;
    const label = agcMode.toUpperCase();
    agcControl.dataset.agc = agcMode;
    agcControl.setAttribute('aria-label', `AGC ${label}. Tap to change.`);
    if (agcLabel) agcLabel.textContent = label;
    if (agcOptions) {
      agcOptions.innerHTML = agcMode === 'fast' ? 'SLOW<br>OFF'
        : agcMode === 'slow' ? 'FAST<br>OFF'
        : 'FAST<br>SLOW';
    }
    updateAdvancedReadout();
  }

  function cycleAgc() {
    agcMode = agcMode === 'fast' ? 'slow' : agcMode === 'slow' ? 'off' : 'fast';
    renderAgc();
    renderGain();
    sendAgc(true);
  }

  if (agcControl) {
    agcControl.classList.add('is-interactive');
    agcControl.setAttribute('role', 'button');
    agcControl.setAttribute('tabindex', '0');
    agcControl.addEventListener('click', cycleAgc);
    agcControl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      cycleAgc();
    });
  }

  function renderGain() {
    if (!gainControl) return;
    const manual = agcMode === 'off';
    const angle = -135 + (manualGain / 100) * 270;
    gainControl.style.setProperty('--gain-angle', `${angle}deg`);
    gainControl.dataset.gainMode = manual ? 'manual' : 'auto';
    gainControl.setAttribute('aria-valuenow', String(manualGain));
    gainControl.setAttribute(
      'aria-valuetext',
      manual ? `${manualGain} percent manual gain` : 'automatic gain'
    );
    if (gainValue) {
      gainValue.textContent = manual ? `${manualGain}%` : 'AUTO';
      gainValue.classList.toggle('manual', manual);
      gainValue.setAttribute(
        'aria-label',
        manual
          ? `RF gain ${manualGain} percent. Tap to restore automatic gain.`
          : 'RF gain is automatic.'
      );
    }
    updateAdvancedReadout();
  }

  function setManualGain(value, forceSend = false) {
    manualGain = Math.round(clamp(value, 0, 100));
    if (agcMode !== 'off') {
      agcMode = 'off';
      renderAgc();
    }
    renderGain();
    sendAgc(forceSend);
  }

  if (gainControl) {
    gainControl.classList.add('is-interactive');
    gainControl.removeAttribute('aria-hidden');
    gainControl.setAttribute('role', 'slider');
    gainControl.setAttribute('tabindex', '0');
    gainControl.setAttribute('aria-label', 'RF gain. Drag right or up to increase; left or down to decrease.');
    gainControl.setAttribute('aria-valuemin', '0');
    gainControl.setAttribute('aria-valuemax', '100');

    gainControl.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      gainPointerId = event.pointerId;
      gainStartX = event.clientX;
      gainStartY = event.clientY;
      gainStartValue = manualGain;
      gainMoved = false;
      gainControl.classList.add('is-adjusting');
      try { gainControl.setPointerCapture(event.pointerId); } catch {}
    });
    gainControl.addEventListener('pointermove', (event) => {
      if (gainPointerId !== event.pointerId) return;
      event.preventDefault();
      const delta = (event.clientX - gainStartX) - (event.clientY - gainStartY);
      if (Math.abs(delta) > 2) gainMoved = true;
      setManualGain(gainStartValue + delta * 0.65, false);
    });
    const endGain = (event) => {
      if (gainPointerId !== event.pointerId) return;
      event.preventDefault();
      if (gainMoved) sendAgc(true);
      try { gainControl.releasePointerCapture(event.pointerId); } catch {}
      gainPointerId = null;
      gainControl.classList.remove('is-adjusting');
    };
    gainControl.addEventListener('pointerup', endGain);
    gainControl.addEventListener('pointercancel', () => {
      gainPointerId = null;
      gainControl.classList.remove('is-adjusting');
    });
    gainControl.addEventListener('keydown', (event) => {
      const delta = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 5
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -5 : 0;
      if (!delta) return;
      event.preventDefault();
      setManualGain(manualGain + delta, true);
    });
  }

  gainValue?.addEventListener('click', () => {
    if (agcMode !== 'off') return;
    agcMode = 'fast';
    renderAgc();
    renderGain();
    sendAgc(true);
  });

  let advancedPanel = null;
  let advVolume = null;
  let advAgc = null;
  let advGain = null;

  function buildAdvancedPanel() {
    if (!hardwareDeck || advancedPanel) return;
    advancedPanel = document.createElement('div');
    advancedPanel.className = 'zero-advanced-panel';
    advancedPanel.hidden = true;
    advancedPanel.innerHTML = `
      <div class="zero-advanced-head"><strong>ADVANCED</strong><button type="button" data-adv-close aria-label="Close advanced controls">×</button></div>
      <div class="zero-advanced-stats">
        <span>VOLUME <b data-adv-volume>82%</b></span>
        <span>AGC <b data-adv-agc>FAST</b></span>
        <span>GAIN <b data-adv-gain>50%</b></span>
      </div>
      <button class="zero-advanced-reset" type="button" data-adv-reset>RESET CONTROLS</button>`;
    hardwareDeck.appendChild(advancedPanel);
    advVolume = advancedPanel.querySelector('[data-adv-volume]');
    advAgc = advancedPanel.querySelector('[data-adv-agc]');
    advGain = advancedPanel.querySelector('[data-adv-gain]');
    advancedPanel.querySelector('[data-adv-close]')?.addEventListener('click', () => setAdvancedOpen(false));
    advancedPanel.querySelector('[data-adv-reset]')?.addEventListener('click', () => {
      volume = 82;
      agcMode = 'fast';
      manualGain = 50;
      renderVolume();
      renderAgc();
      renderGain();
      applyVolume();
      sendAgc(true);
    });
    updateAdvancedReadout();
  }

  function updateAdvancedReadout() {
    if (advVolume) advVolume.textContent = `${volume}%`;
    if (advAgc) advAgc.textContent = agcMode.toUpperCase();
    if (advGain) advGain.textContent = agcMode === 'off' ? `${manualGain}%` : 'AUTO';
  }

  function setAdvancedOpen(open) {
    buildAdvancedPanel();
    if (!advancedPanel || !advButton) return;
    advancedPanel.hidden = !open;
    advButton.setAttribute('aria-expanded', String(open));
    advButton.classList.toggle('active', open);
  }

  if (advButton) {
    advButton.setAttribute('aria-haspopup', 'true');
    advButton.setAttribute('aria-expanded', 'false');
    advButton.addEventListener('click', () => setAdvancedOpen(advancedPanel?.hidden !== false));
  }

  if (muteButton) {
    new MutationObserver(() => {
      muted = muteButton.getAttribute('aria-pressed') === 'true';
      window.setTimeout(applyVolume, 0);
    }).observe(muteButton, { attributes: true, attributeFilter: ['aria-pressed'] });
  }

  power?.addEventListener('click', () => {
    window.setTimeout(() => {
      if (power.getAttribute('aria-pressed') !== 'true') sndSocket = null;
    }, 0);
  });

  renderVolume();
  renderAgc();
  renderGain();
  buildAdvancedPanel();
})();
