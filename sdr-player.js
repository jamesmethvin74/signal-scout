(() => {
  if (window.__freqbeaconSdrPlayerSourceV2) return;
  window.__freqbeaconSdrPlayerSourceV2 = true;

  const LOCATION_STORAGE_KEY = 'signalScout:location:v1';
  const PASSBANDS = {
    am: [-4900, 4900],
    sam: [-4900, 4900],
    usb: [300, 2700],
    lsb: [-2700, -300]
  };

  const sdr = {
    panel: null,
    chooser: null,
    lookupReceiverButton: null,
    manager: null,
    audioContext: null,
    gain: null,
    nextPlayTime: 0,
    sampleRate: 12000,
    frequency: null,
    station: '',
    mode: 'am',
    receivers: [],
    receiverIndex: 0,
    manualReceiverId: null,
    manualContextKey: '',
    connected: false,
    configured: false,
    gotAudio: false,
    manualStop: false,
    keepaliveTimer: null,
    lastRssi: null,
    decoder: new TextDecoder(),
    recommendationSequence: 0,
    recommendationFrequency: null,
    recommendationStation: '',
    recommendationContext: null,
    directorySource: 'receiver-runtime-seed',
    directoryWarning: null,
    lookupRecommendationTimer: null
  };

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function formatFrequency(khz) {
    if (!Number.isFinite(khz)) return '-- kHz';
    const rounded = Math.round(khz * 10) / 10;
    return `${rounded.toLocaleString(undefined, { maximumFractionDigits: 1 })} kHz`;
  }

  function formatDistance(distanceMiles) {
    return Number.isFinite(distanceMiles) ? `${Math.round(distanceMiles).toLocaleString()} mi from you` : '';
  }

  function formatCoverage(receiver) {
    const min = Number(receiver?.minKHz);
    const max = Number(receiver?.maxKHz);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return 'KiwiSDR';
    const text = (value) => value >= 1000
      ? `${(value / 1000).toFixed(value % 1000 ? 1 : 0)} MHz`
      : `${Math.round(value)} kHz`;
    return `${text(min)}–${text(max)}`;
  }

  function loadStoredLocation() {
    try {
      const payload = JSON.parse(window.localStorage?.getItem(LOCATION_STORAGE_KEY) || 'null');
      const lat = Number(payload?.lat);
      const lon = Number(payload?.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    } catch {
      return null;
    }
  }

  function parseFrequencyValue(raw) {
    const normalized = String(raw || '').trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '');
    if (!normalized) return null;
    const mhzExplicit = normalized.endsWith('mhz') || normalized.endsWith('m');
    const khzExplicit = normalized.endsWith('khz') || normalized.endsWith('k');
    const numeric = Number(normalized.replace(/mhz|khz|m|k/g, ''));
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    if (mhzExplicit) return numeric * 1000;
    if (khzExplicit) return numeric;
    return numeric < 100 ? numeric * 1000 : numeric;
  }

  function frequencyFromContainer(container) {
    if (!container) return null;
    const lookupFrequency = container.querySelector('.lookup-result-frequency')?.textContent || '';
    if (lookupFrequency) {
      const value = Number(lookupFrequency.replace(/[^0-9.]/g, ''));
      if (Number.isFinite(value)) return value;
    }
    const freqEl = container.querySelector('.frequency');
    if (!freqEl) return null;
    const unit = freqEl.querySelector('span')?.textContent?.trim().toLowerCase() || '';
    const clone = freqEl.cloneNode(true);
    clone.querySelector('span')?.remove();
    const value = Number(clone.textContent.replace(/,/g, '').trim());
    if (!Number.isFinite(value)) return null;
    return unit.includes('mhz') ? value * 1000 : value;
  }

  function stationFromContainer(container) {
    return container?.querySelector('.station-name')?.textContent?.trim()
      || container?.querySelector('h3')?.textContent?.trim()
      || 'Live signal';
  }

  function modeFromContainer(container) {
    if (container?.classList.contains('lookup-result')) {
      const quickMode = container.querySelector('[data-ham-quick-mode]')?.dataset.hamQuickMode;
      const mode = quickMode || document.getElementById('lookupMode')?.value || 'am';
      return PASSBANDS[mode] ? mode : 'am';
    }
    return 'am';
  }

  function stationCoordinates(frequency, stationName) {
    const stations = window.SIGNAL_SCOUT_STATIONS || [];
    const normalizedName = String(stationName || '').trim().toLowerCase();
    const candidates = stations.filter((station) => Math.abs(Number(station.frequency) - Number(frequency)) < 0.11);
    const exactName = candidates.find((station) => String(station.name || '').trim().toLowerCase() === normalizedName);
    const station = exactName || candidates[0];
    const lat = Number(station?.lat);
    const lon = Number(station?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0) ? { lat, lon } : null;
  }

  function hamViewActive() {
    return document.getElementById('signalGrid')?.dataset.hamView === 'true';
  }

  function contextFor(frequency, container = null) {
    const user = loadStoredLocation();
    const station = stationFromContainer(container);
    const tx = stationCoordinates(frequency, station);
    return {
      frequency,
      userLat: user?.lat ?? null,
      userLon: user?.lon ?? null,
      txLat: tx?.lat ?? null,
      txLon: tx?.lon ?? null,
      ham: hamViewActive(),
      station
    };
  }

  function contextKey(context) {
    return `${Number(context?.frequency || 0).toFixed(1)}|${String(context?.station || '').toLowerCase()}|${context?.ham ? 'ham' : 'broadcast'}`;
  }

  function injectStyles() {
    if (document.getElementById('signal-scout-sdr-player-styles')) return;
    const style = document.createElement('style');
    style.id = 'signal-scout-sdr-player-styles';
    style.textContent = `
      .sdr-player{position:fixed;left:50%;bottom:calc(68px + env(safe-area-inset-bottom));z-index:30;width:min(720px,calc(100% - 16px));transform:translateX(-50%);border:1px solid rgba(37,212,230,.72);border-radius:10px;overflow:hidden;background:#050b0e;box-shadow:0 -14px 44px rgba(0,0,0,.62),0 0 28px rgba(37,212,230,.08)}
      .sdr-player[hidden]{display:none!important}.sdr-player-head{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid rgba(37,212,230,.16);background:linear-gradient(180deg,#0a171c,#071014)}
      .sdr-player-title{min-width:0;flex:1}.sdr-player-title strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#eef6f7;font-size:13px}.sdr-player-title span{display:block;margin-top:2px;color:var(--accent);font-family:var(--mono);font-size:10px;letter-spacing:.05em}
      .sdr-status{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;color:#8fa2a7;font-family:var(--mono);font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.sdr-status-dot{width:7px;height:7px;border-radius:50%;background:#6f7e82}.sdr-player.is-live .sdr-status{color:var(--green)}.sdr-player.is-live .sdr-status-dot{background:var(--green);box-shadow:0 0 10px rgba(97,231,134,.7)}
      .sdr-icon-button{width:34px;height:34px;flex:0 0 auto;border:1px solid #1b3c43;border-radius:5px;color:#9eb0b5;background:#071014;font-size:15px}.sdr-player-body{padding:10px 12px 12px}.sdr-spectrum-wrap{position:relative;overflow:hidden;border:1px solid #16424b;border-radius:6px;background:#020608}.sdr-spectrum-label{position:absolute;left:8px;top:6px;z-index:2;color:#688087;font-family:var(--mono);font-size:8px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;pointer-events:none}.sdr-spectrum{display:block;width:100%;height:150px}
      .sdr-readout{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:7px;color:#71878d;font-family:var(--mono);font-size:9px}.sdr-readout span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sdr-readout strong{color:#b8c8cb;font-weight:700;white-space:nowrap}.sdr-controls{display:grid;grid-template-columns:120px minmax(0,1fr) 92px;gap:8px;align-items:end;margin-top:10px}.sdr-control label{display:block;margin-bottom:4px;color:#71868c;font-family:var(--mono);font-size:8px;font-weight:800;letter-spacing:.06em;text-transform:uppercase}.sdr-control select{width:100%;min-height:38px;border:1px solid #1b3a41;border-radius:5px;padding:7px 28px 7px 9px;color:#d7e4e6;background:#050d10;font-size:10px}
      .sdr-receiver-button{width:100%;min-height:38px;display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid #1b3a41;border-radius:5px;padding:7px 9px;color:#d7e4e6;background:#050d10;text-align:left}.sdr-receiver-button-main{min-width:0}.sdr-receiver-button-main strong,.sdr-receiver-button-main span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sdr-receiver-button-main strong{color:#dce9eb;font-family:var(--mono);font-size:9px}.sdr-receiver-button-main span{margin-top:2px;color:#6f8b91;font-family:var(--mono);font-size:8px}.sdr-receiver-button-arrow{color:var(--accent);font-family:var(--mono);font-size:12px}
      .sdr-volume{display:flex;align-items:center;gap:7px;min-height:38px;padding:0 9px;border:1px solid #1b3a41;border-radius:5px;background:#050d10}.sdr-volume input{width:100%;accent-color:var(--accent)}.sdr-toggle{min-height:38px;border:1px solid rgba(37,212,230,.58);border-radius:5px;color:var(--accent-soft);background:rgba(37,212,230,.07);font-family:var(--mono);font-size:9px;font-weight:900;letter-spacing:.07em;text-transform:uppercase}.sdr-message{margin-top:8px;min-height:15px;color:#8ca0a5;font-size:10px;line-height:1.4}.sdr-message.is-error{color:#efbd5c}.sdr-context-note{margin-top:6px;padding-top:6px;border-top:1px solid rgba(37,212,230,.08);color:#61777d;font-family:var(--mono);font-size:8px;line-height:1.45}.sdr-player.is-minimized .sdr-player-body{display:none}body.sdr-player-open .app-shell{padding-bottom:455px!important}body.sdr-player-open.sdr-player-minimized .app-shell{padding-bottom:150px!important}
      .sdr-chooser{position:fixed;inset:0;z-index:80;display:flex;align-items:flex-end;justify-content:center;padding:12px;background:rgba(0,4,6,.72);backdrop-filter:blur(5px)}.sdr-chooser[hidden]{display:none!important}.sdr-chooser-dialog{width:min(720px,100%);max-height:min(78vh,760px);display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(37,212,230,.55);border-radius:13px;background:#050b0e;box-shadow:0 24px 80px rgba(0,0,0,.72),0 0 34px rgba(37,212,230,.08)}.sdr-chooser-head{display:flex;align-items:flex-start;gap:12px;padding:13px 14px;border-bottom:1px solid rgba(37,212,230,.14);background:linear-gradient(180deg,#0b181d,#071014)}.sdr-chooser-head-text{flex:1;min-width:0}.sdr-chooser-kicker{color:var(--accent);font-family:var(--mono);font-size:8px;font-weight:900;letter-spacing:.11em;text-transform:uppercase}.sdr-chooser-head h3{margin:3px 0 0;color:#edf6f7;font-size:16px}.sdr-chooser-head p{margin:4px 0 0;color:#70868c;font-size:10px;line-height:1.4}.sdr-chooser-list{overflow:auto;padding:8px;overscroll-behavior:contain}.sdr-choice{width:100%;display:block;margin:0 0 7px;border:1px solid #15363d;border-radius:8px;padding:11px;color:inherit;background:#071014;text-align:left}.sdr-choice.is-selected{border-color:rgba(37,212,230,.72);box-shadow:inset 0 0 0 1px rgba(37,212,230,.10);background:rgba(37,212,230,.04)}.sdr-choice-top{display:flex;align-items:flex-start;gap:10px}.sdr-choice-name{min-width:0;flex:1;color:#e4eff0;font-weight:800;font-size:11px}.sdr-choice-distance{flex:0 0 auto;color:#87a3a9;font-family:var(--mono);font-size:8px}.sdr-choice-location{margin-top:3px;color:#728a90;font-size:9px}.sdr-choice-badges{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}.sdr-choice-badge{display:inline-flex;border:1px solid rgba(37,212,230,.28);border-radius:999px;padding:3px 6px;color:#8ac8d1;background:rgba(37,212,230,.04);font-family:var(--mono);font-size:7px;font-weight:900;letter-spacing:.05em;text-transform:uppercase}.sdr-choice-badge.is-recommended{border-color:rgba(97,231,134,.48);color:#8cf0a6;background:rgba(97,231,134,.06)}.sdr-choice-reason{margin-top:7px;color:#a5b7bb;font-size:10px;line-height:1.45}.sdr-choice-meta{margin-top:6px;color:#5f777d;font-family:var(--mono);font-size:8px}.sdr-chooser-foot{padding:9px 12px 11px;border-top:1px solid rgba(37,212,230,.10);color:#647b80;font-size:9px;line-height:1.45}.sdr-chooser-foot.is-warning{color:#d0a954}
      #lookupReceiver[hidden]{display:none!important}.lookup-receiver-smart{width:100%;min-height:46px;display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid #1c4650;border-radius:7px;padding:9px 11px;color:#dbe8ea;background:#071216;text-align:left}.lookup-receiver-smart-main{min-width:0}.lookup-receiver-smart-main strong,.lookup-receiver-smart-main span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.lookup-receiver-smart-main strong{color:#e3eff0;font-size:10px}.lookup-receiver-smart-main span{margin-top:3px;color:#759097;font-family:var(--mono);font-size:8px}.lookup-receiver-smart b{flex:0 0 auto;color:var(--accent);font-family:var(--mono);font-size:9px;letter-spacing:.06em;text-transform:uppercase}
      @media(max-width:560px){.sdr-player{bottom:calc(65px + env(safe-area-inset-bottom));width:calc(100% - 10px)}.sdr-player-head{padding:9px 10px}.sdr-player-body{padding:8px 9px 10px}.sdr-spectrum{height:132px}.sdr-controls{grid-template-columns:92px minmax(0,1fr)}.sdr-controls .sdr-play-control{grid-column:1/-1}.sdr-toggle{width:100%}body.sdr-player-open .app-shell{padding-bottom:445px!important}.sdr-chooser{padding:5px}.sdr-chooser-dialog{max-height:82vh;border-radius:12px 12px 7px 7px}}
    `;
    document.head.appendChild(style);
  }

  function createPlayerShell() {
    if (sdr.panel) return sdr.panel;
    injectStyles();
    const panel = document.createElement('section');
    panel.className = 'sdr-player';
    panel.id = 'sdrPlayer';
    panel.hidden = true;
    panel.setAttribute('aria-label', 'Live SDR player');
    panel.innerHTML = `
      <div class="sdr-player-head">
        <div class="sdr-status"><span class="sdr-status-dot"></span><span data-sdr-status>Idle</span></div>
        <div class="sdr-player-title"><strong data-sdr-station>Live receiver</strong><span data-sdr-frequency>-- kHz · AM</span></div>
        <button class="sdr-icon-button" type="button" data-sdr-minimize aria-label="Minimize player">⌄</button>
        <button class="sdr-icon-button" type="button" data-sdr-close aria-label="Close player">×</button>
      </div>
      <div class="sdr-player-body">
        <div class="sdr-spectrum-wrap"><div class="sdr-spectrum-label">Live RF spectrum / waterfall</div><canvas class="sdr-spectrum" data-sdr-canvas></canvas></div>
        <div class="sdr-readout"><span data-sdr-receiver>Receiver: --</span><strong data-sdr-rssi>RSSI --</strong></div>
        <div class="sdr-controls">
          <div class="sdr-control"><label for="sdrMode">Mode</label><select id="sdrMode" data-sdr-mode><option value="am">AM</option><option value="sam">SAM</option><option value="usb">USB</option><option value="lsb">LSB</option></select></div>
          <div class="sdr-control"><label>Receiver</label><button class="sdr-receiver-button" type="button" data-sdr-receiver-button aria-haspopup="dialog"><span class="sdr-receiver-button-main"><strong data-sdr-receiver-button-name>Automatic</strong><span data-sdr-receiver-button-meta>FreqBeacon chooses the best match</span></span><span class="sdr-receiver-button-arrow">⌄</span></button></div>
          <div class="sdr-control sdr-play-control"><label>&nbsp;</label><button class="sdr-toggle" type="button" data-sdr-toggle>Stop</button></div>
        </div>
        <div class="sdr-control" style="margin-top:8px"><label>Volume</label><div class="sdr-volume"><span>◖</span><input data-sdr-volume type="range" min="0" max="1" step="0.01" value="0.75" aria-label="Volume"/><span>◗</span></div></div>
        <div class="sdr-message" data-sdr-message>Tap Listen Live on any signal to start.</div>
        <div class="sdr-context-note">Remote SDR reception may differ from reception at your location. FreqBeacon's reception score still describes your location, not this remote receiver.</div>
      </div>`;
    document.body.appendChild(panel);
    sdr.panel = panel;

    panel.querySelector('[data-sdr-close]').addEventListener('click', closePlayer);
    panel.querySelector('[data-sdr-minimize]').addEventListener('click', () => {
      const minimized = !panel.classList.contains('is-minimized');
      panel.classList.toggle('is-minimized', minimized);
      document.body.classList.toggle('sdr-player-minimized', minimized);
      const button = panel.querySelector('[data-sdr-minimize]');
      button.textContent = minimized ? '⌃' : '⌄';
      button.setAttribute('aria-label', minimized ? 'Expand player' : 'Minimize player');
    });
    panel.querySelector('[data-sdr-toggle]').addEventListener('click', () => {
      if (sdr.manager?.activeSocket || sdr.connected) {
        stopSdr({ keepPanel:true, message:'Stopped. Tap Play to reconnect.' });
      } else if (Number.isFinite(sdr.frequency)) {
        sdr.manualStop = false;
        startConnection({ manual:Boolean(sdr.manualReceiverId && sdr.manualContextKey === contextKey(sdr.recommendationContext)) });
      }
    });
    panel.querySelector('[data-sdr-volume]').addEventListener('input', (event) => {
      if (sdr.gain) sdr.gain.gain.value = Number(event.target.value);
    });
    panel.querySelector('[data-sdr-mode]').addEventListener('change', (event) => {
      sdr.mode = PASSBANDS[event.target.value] ? event.target.value : 'am';
      updatePlayerReadout();
      if (sdr.manager?.activeSocket?.readyState === WebSocket.OPEN && sdr.configured) sendTuning();
    });
    panel.querySelector('[data-sdr-receiver-button]').addEventListener('click', openReceiverChooser);
    drawIdleSpectrum('READY');
    return panel;
  }

  function createReceiverChooser() {
    if (sdr.chooser) return sdr.chooser;
    injectStyles();
    const chooser = document.createElement('div');
    chooser.className = 'sdr-chooser';
    chooser.hidden = true;
    chooser.innerHTML = `<div class="sdr-chooser-dialog" role="dialog" aria-modal="true" aria-labelledby="sdrChooserTitle"><div class="sdr-chooser-head"><div class="sdr-chooser-head-text"><div class="sdr-chooser-kicker">Receiver intelligence</div><h3 id="sdrChooserTitle">Choose listening receiver</h3><p data-sdr-chooser-subtitle>FreqBeacon ranks public receivers locally for this frequency and path.</p></div><button class="sdr-icon-button" type="button" data-sdr-chooser-close aria-label="Close receiver chooser">×</button></div><div class="sdr-chooser-list" data-sdr-chooser-list></div><div class="sdr-chooser-foot" data-sdr-chooser-foot>Public SDRs are independently operated and can fill up or go offline without warning.</div></div>`;
    chooser.addEventListener('click', (event) => {
      if (event.target === chooser) closeReceiverChooser();
      const choice = event.target.closest('[data-sdr-choice-index]');
      if (choice) chooseReceiver(Number(choice.dataset.sdrChoiceIndex));
    });
    chooser.querySelector('[data-sdr-chooser-close]').addEventListener('click', closeReceiverChooser);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !chooser.hidden) closeReceiverChooser();
    });
    document.body.appendChild(chooser);
    sdr.chooser = chooser;
    return chooser;
  }

  function playerEl(selector) {
    return createPlayerShell().querySelector(selector);
  }

  function currentReceiver() {
    return sdr.receivers[sdr.receiverIndex] || sdr.receivers[0] || null;
  }

  function renderReceiverButton() {
    const receiver = currentReceiver();
    const panel = createPlayerShell();
    panel.querySelector('[data-sdr-receiver-button-name]').textContent = receiver?.name || 'Automatic';
    panel.querySelector('[data-sdr-receiver-button-meta]').textContent = [
      receiver?.recommended ? '★ Recommended' : receiver?.role,
      formatDistance(receiver?.distanceMiles) || receiver?.location
    ].filter(Boolean).join(' · ') || 'FreqBeacon chooses the best match';
    renderLookupReceiverButton();
  }

  function renderLookupReceiverButton() {
    const button = sdr.lookupReceiverButton;
    if (!button) return;
    let strong = button.querySelector('strong');
    let meta = button.querySelector('.lookup-receiver-smart-main span');
    let badge = button.querySelector('b');
    if (!strong || !meta || !badge) {
      button.innerHTML = '<div class="lookup-receiver-smart-main"><strong></strong><span></span></div><b></b>';
      strong = button.querySelector('strong');
      meta = button.querySelector('.lookup-receiver-smart-main span');
      badge = button.querySelector('b');
    }
    const receiver = currentReceiver();
    const frequency = parseFrequencyValue(document.getElementById('lookupFrequency')?.value);
    const matches = Number.isFinite(frequency) && Number.isFinite(sdr.recommendationFrequency)
      && Math.abs(frequency - sdr.recommendationFrequency) < 5.2;
    if (!matches || !receiver) {
      strong.textContent = 'Automatic receiver selection';
      meta.textContent = 'FreqBeacon ranks cached public SDRs instantly for this frequency';
      badge.textContent = 'SMART';
      return;
    }
    strong.textContent = `${receiver.name}${Number.isFinite(receiver.distanceMiles) ? ` · ${Math.round(receiver.distanceMiles).toLocaleString()} mi` : ''}`;
    meta.textContent = receiver.reason || receiver.location || 'Best available public receiver';
    badge.textContent = receiver.recommended ? '★ BEST' : (receiver.role || 'SELECTED');
  }

  function renderReceiverChooser() {
    const chooser = createReceiverChooser();
    const frequencyText = Number.isFinite(sdr.recommendationFrequency) ? formatFrequency(sdr.recommendationFrequency) : 'this frequency';
    chooser.querySelector('[data-sdr-chooser-subtitle]').textContent = `Ranked locally for ${frequencyText}${sdr.recommendationStation ? ` · ${sdr.recommendationStation}` : ''}.`;
    const list = chooser.querySelector('[data-sdr-chooser-list]');
    list.innerHTML = sdr.receivers.map((receiver, index) => {
      const badges = [
        receiver.recommended ? '<span class="sdr-choice-badge is-recommended">★ Recommended</span>' : '',
        receiver.role && receiver.role !== 'ALTERNATE' ? `<span class="sdr-choice-badge">${escapeHtml(receiver.role)}</span>` : '',
        receiver.connectionHealth === 'recent-success' ? '<span class="sdr-choice-badge">Recent success</span>' : ''
      ].filter(Boolean).join('');
      return `<button type="button" class="sdr-choice ${index === sdr.receiverIndex ? 'is-selected' : ''}" data-sdr-choice-index="${index}"><div class="sdr-choice-top"><div class="sdr-choice-name">${escapeHtml(receiver.name || 'Public KiwiSDR')}</div><div class="sdr-choice-distance">${escapeHtml(formatDistance(receiver.distanceMiles))}</div></div><div class="sdr-choice-location">${escapeHtml(receiver.location || 'Location not listed')}</div>${badges ? `<div class="sdr-choice-badges">${badges}</div>` : ''}<div class="sdr-choice-reason">${escapeHtml(receiver.reason || 'Public receiver covering this frequency.')}</div><div class="sdr-choice-meta">${escapeHtml(formatCoverage(receiver))} · PUBLIC KIWI</div></button>`;
    }).join('');
    const foot = chooser.querySelector('[data-sdr-chooser-foot]');
    foot.classList.toggle('is-warning', Boolean(sdr.directoryWarning));
    foot.textContent = sdr.directoryWarning
      ? sdr.directoryWarning
      : 'Choices are ranked from the local/current catalog immediately. ReceiverBook refreshes in the background and never blocks this chooser.';
  }

  function openReceiverChooser() {
    if (!sdr.receivers.length) refreshLookupRecommendations({ force:false });
    renderReceiverChooser();
    const chooser = createReceiverChooser();
    chooser.hidden = false;
    window.setTimeout(() => chooser.querySelector('.sdr-choice.is-selected')?.scrollIntoView({ block:'nearest' }), 0);
  }

  function closeReceiverChooser() {
    if (sdr.chooser) sdr.chooser.hidden = true;
  }

  function chooseReceiver(index) {
    const receiver = sdr.receivers[index];
    if (!receiver) return;
    sdr.receiverIndex = index;
    sdr.manualReceiverId = receiver.id;
    sdr.manualContextKey = contextKey(sdr.recommendationContext);
    closeReceiverChooser();
    renderReceiverButton();
    updatePlayerReadout();
    rewriteLookupLiveNotes();
    if (!sdr.panel?.hidden && Number.isFinite(sdr.frequency)) {
      sdr.manualStop = false;
      startConnection({ manual:true });
    }
  }

  function installLookupReceiverControl() {
    const select = document.getElementById('lookupReceiver');
    if (!select || sdr.lookupReceiverButton) return;
    select.hidden = true;
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lookup-receiver-smart';
    button.id = 'lookupReceiverButton';
    button.setAttribute('aria-haspopup', 'dialog');
    button.innerHTML = '<div class="lookup-receiver-smart-main"><strong>Automatic receiver selection</strong><span>FreqBeacon ranks cached public SDRs instantly for this frequency</span></div><b>SMART</b>';
    select.insertAdjacentElement('afterend', button);
    const label = select.closest('.lookup-receiver-row')?.querySelector('label');
    if (label) label.htmlFor = button.id;
    button.addEventListener('click', () => {
      if (!sdr.panel?.hidden && Number.isFinite(sdr.frequency)) {
        openReceiverChooser();
        return;
      }
      refreshLookupRecommendations({ force:true });
      openReceiverChooser();
    });
    sdr.lookupReceiverButton = button;
    renderLookupReceiverButton();
  }

  function setMessage(message, isError = false) {
    const element = playerEl('[data-sdr-message]');
    element.textContent = message;
    element.classList.toggle('is-error', isError);
  }

  function setStatus(status, live = false) {
    const panel = createPlayerShell();
    panel.querySelector('[data-sdr-status]').textContent = status;
    panel.classList.toggle('is-live', live);
  }

  function updatePlayerReadout() {
    const panel = createPlayerShell();
    const receiver = currentReceiver();
    panel.querySelector('[data-sdr-station]').textContent = sdr.station || 'Live receiver';
    panel.querySelector('[data-sdr-frequency]').textContent = Number.isFinite(sdr.frequency)
      ? `${formatFrequency(sdr.frequency)} · ${sdr.mode.toUpperCase()}` : '-- kHz';
    const distance = formatDistance(receiver?.distanceMiles);
    panel.querySelector('[data-sdr-receiver]').textContent = `Receiver: ${receiver?.location || receiver?.name || '--'}${distance ? ` · ${distance}` : ''}`;
    panel.querySelector('[data-sdr-mode]').value = sdr.mode;
    panel.querySelector('[data-sdr-toggle]').textContent = sdr.manager?.activeSocket || sdr.connected ? 'Stop' : 'Play';
    renderReceiverButton();
  }

  function rssiToS(rssi) {
    if (!Number.isFinite(rssi)) return '';
    if (rssi >= -73) return `S9+${Math.max(0, Math.round(rssi + 73))}`;
    return `S${Math.max(0, Math.min(9, Math.round(9 + (rssi + 73) / 6)))}`;
  }

  function updateRssi(rssi) {
    sdr.lastRssi = rssi;
    const suffix = rssiToS(rssi);
    playerEl('[data-sdr-rssi]').textContent = Number.isFinite(rssi)
      ? `RSSI ${rssi.toFixed(1)} dB${suffix ? ` · ${suffix}` : ''}` : 'RSSI --';
  }

  async function ensureAudioContext() {
    if (sdr.audioContext && sdr.audioContext.state !== 'closed') {
      if (sdr.audioContext.state === 'suspended') await sdr.audioContext.resume();
      return sdr.audioContext;
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) throw new Error('Web Audio is not supported in this browser.');
    const context = new AudioContextCtor({ latencyHint:'interactive' });
    const gain = context.createGain();
    gain.gain.value = Number(playerEl('[data-sdr-volume]').value || 0.75);
    gain.connect(context.destination);
    sdr.audioContext = context;
    sdr.gain = gain;
    sdr.nextPlayTime = context.currentTime + 0.06;
    if (context.state === 'suspended') await context.resume();
    return context;
  }

  function scheduleAudio(samples) {
    const context = sdr.audioContext;
    if (!context || context.state === 'closed' || !samples?.length || !sdr.gain) return;
    const sampleRate = Number.isFinite(sdr.sampleRate) && sdr.sampleRate > 1000 ? sdr.sampleRate : 12000;
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(sdr.gain);
    const now = context.currentTime;
    if (sdr.nextPlayTime < now + 0.035 || sdr.nextPlayTime > now + 0.55) sdr.nextPlayTime = now + 0.055;
    source.start(sdr.nextPlayTime);
    sdr.nextPlayTime += samples.length / sampleRate;
  }

  function decodePcm(bytes, littleEndian) {
    const count = Math.floor(bytes.byteLength / 2);
    const samples = new Float32Array(count);
    const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
    for (let i = 0; i < count; i += 1) samples[i] = view.getInt16(i * 2, littleEndian) / 32768;
    return samples;
  }

  function sendSocket(message) {
    const socket = sdr.manager?.activeSocket;
    if (socket?.readyState === WebSocket.OPEN) {
      try { socket.send(message); } catch {}
    }
  }

  function sendTuning() {
    if (!Number.isFinite(sdr.frequency)) return;
    const mode = PASSBANDS[sdr.mode] ? sdr.mode : 'am';
    const [lowCut, highCut] = PASSBANDS[mode];
    sendSocket(`SET mod=${mode} low_cut=${lowCut} high_cut=${highCut} freq=${sdr.frequency.toFixed(3)}`);
  }

  function configureSdr() {
    if (sdr.configured) return;
    sdr.configured = true;
    sendSocket('SET ident_user=FreqBeacon');
    sendTuning();
    sendSocket('SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50');
    sendSocket('SET compression=0');
    sendSocket('SET squelch=0 max=0');
    sendSocket('SET genattn=0');
    sendSocket('SET gen=0 mix=-1');
    sendSocket('SET de_emp=0');
  }

  function parseKiwiBytes(bytes) {
    if (bytes.byteLength < 4) return;
    const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    if (tag === 'MSG') {
      const text = sdr.decoder.decode(bytes.subarray(4));
      const sampleRate = text.match(/(?:^|\s)sample_rate=([0-9.]+)/)?.[1];
      const audioRate = text.match(/(?:^|\s)audio_rate=([0-9]+)/)?.[1];
      if (sampleRate) {
        sdr.sampleRate = Number(sampleRate) || sdr.sampleRate;
        configureSdr();
      }
      if (audioRate && sdr.audioContext) sendSocket(`SET AR OK in=${Number(audioRate)} out=${Math.round(sdr.audioContext.sampleRate)}`);
      return;
    }
    if (tag !== 'SND' || bytes.byteLength < 10) return;
    const body = bytes.subarray(3);
    const flags = body[0];
    const smeter = (body[5] << 8) | body[6];
    updateRssi(smeter * 0.1 - 127);
    if ((flags & 0x10) !== 0) {
      sendSocket('SET compression=0');
      return;
    }
    const audioBytes = body.subarray(7);
    if (audioBytes.byteLength >= 2) scheduleAudio(decodePcm(audioBytes, (flags & 0x80) !== 0));
  }

  function handleSocketMessage(event) {
    if (event.data instanceof ArrayBuffer) parseKiwiBytes(new Uint8Array(event.data));
    else if (event.data instanceof Blob) event.data.arrayBuffer().then((buffer) => parseKiwiBytes(new Uint8Array(buffer))).catch(() => {});
    else if (typeof event.data === 'string') parseKiwiBytes(new TextEncoder().encode(event.data));
  }

  function websocketUrl(receiver) {
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const timestamp = (Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 10000)) >>> 0;
    return `${scheme}//${window.location.host}/api/sdr/ws?receiver=${encodeURIComponent(receiver.id)}&stream=SND&ts=${timestamp}`;
  }

  function clearKeepalive() {
    window.clearInterval(sdr.keepaliveTimer);
    sdr.keepaliveTimer = null;
  }

  function ensureManager() {
    if (sdr.manager) return sdr.manager;
    if (typeof window.FreqBeaconSdrConnectionManager !== 'function') throw new Error('SDR connection manager did not load.');
    sdr.manager = new window.FreqBeaconSdrConnectionManager({
      urlForReceiver: websocketUrl,
      onAttempt: ({ receiver, index, attempt }) => {
        clearKeepalive();
        sdr.receiverIndex = index;
        sdr.connected = false;
        sdr.gotAudio = false;
        sdr.configured = false;
        updatePlayerReadout();
        setStatus('Connecting', false);
        setMessage(`Connecting to ${receiver.location || receiver.name} · attempt ${attempt}…`);
        drawIdleSpectrum('CONNECTING');
      },
      onOpen: ({ socket }) => {
        try { socket.send('SET auth t=kiwi p=#'); } catch {}
        clearKeepalive();
        sdr.keepaliveTimer = window.setInterval(() => sendSocket('SET keepalive'), 5000);
        setStatus('Starting RF', false);
        setMessage('Receiver socket connected. Waiting for live SND data…');
      },
      onMessage: ({ event }) => handleSocketMessage(event),
      onUsefulData: () => {
        sdr.gotAudio = true;
        sdr.connected = true;
        setStatus('Live RF', true);
        setMessage('Actual receiver audio is live · RF v2 is opening the paired spectrum/waterfall stream.');
        updatePlayerReadout();
      },
      onFailover: ({ failed, next, reason }) => {
        clearKeepalive();
        setStatus('Failover', false);
        setMessage(`${failed?.location || failed?.name || 'Receiver'} failed (${reason}). Trying ${next?.location || next?.name || 'the next ranked receiver'}…`, true);
      },
      onUnavailable: ({ attempts, manual }) => {
        clearKeepalive();
        sdr.connected = false;
        sdr.gotAudio = false;
        sdr.configured = false;
        setStatus('Unavailable', false);
        setMessage(manual
          ? 'That receiver did not answer. Choose another receiver or return to automatic selection.'
          : `No ranked receiver answered after ${attempts} bounded attempt${attempts === 1 ? '' : 's'}. Tap Retry or choose another receiver.`, true);
        playerEl('[data-sdr-toggle]').textContent = 'Retry';
        drawIdleSpectrum('NO RECEIVER');
      },
      onDisconnected: ({ reason, manual }) => {
        clearKeepalive();
        sdr.connected = false;
        sdr.gotAudio = false;
        sdr.configured = false;
        if (!manual && reason === 'remote-close') {
          setStatus('Disconnected', false);
          setMessage('The public receiver disconnected. Tap Play to reconnect.', true);
        }
        updatePlayerReadout();
      }
    });
    return sdr.manager;
  }

  function startConnection({ manual = false } = {}) {
    if (!sdr.receivers.length || !Number.isFinite(sdr.frequency)) return;
    const manager = ensureManager();
    const manualIndex = manual && sdr.manualReceiverId
      ? sdr.receivers.findIndex((receiver) => receiver.id === sdr.manualReceiverId) : -1;
    const recommendedIndex = sdr.receivers.findIndex((receiver) => receiver.recommended);
    const startIndex = manualIndex >= 0 ? manualIndex : (recommendedIndex >= 0 ? recommendedIndex : 0);
    sdr.receiverIndex = startIndex;
    sdr.manualStop = false;
    manager.connect(sdr.receivers, { startIndex, manual:manualIndex >= 0 });
  }

  function applyRecommendations(context, { preserveManual = true } = {}) {
    const runtime = window.__freqbeaconReceiverRuntime;
    if (!runtime?.recommend) return false;
    const sequence = ++sdr.recommendationSequence;
    const payload = runtime.recommend(context);
    if (sequence !== sdr.recommendationSequence || !Array.isArray(payload?.receivers) || !payload.receivers.length) return false;
    sdr.receivers = payload.receivers;
    sdr.directorySource = payload.source || 'receiver-runtime-seed';
    sdr.directoryWarning = payload.source === 'receiver-runtime-stale-cache'
      ? 'Using the last known receiver catalog while FreqBeacon refreshes ReceiverBook in the background.' : null;
    sdr.recommendationFrequency = context.frequency;
    sdr.recommendationStation = context.station || '';
    sdr.recommendationContext = context;
    runtime.setActiveContext?.(context);

    const key = contextKey(context);
    if (!preserveManual || sdr.manualContextKey !== key) {
      sdr.manualReceiverId = null;
      sdr.manualContextKey = '';
    }
    const manualIndex = sdr.manualReceiverId ? sdr.receivers.findIndex((receiver) => receiver.id === sdr.manualReceiverId) : -1;
    const recommendedIndex = sdr.receivers.findIndex((receiver) => receiver.recommended);
    sdr.receiverIndex = manualIndex >= 0 ? manualIndex : (recommendedIndex >= 0 ? recommendedIndex : 0);
    renderReceiverButton();
    rewriteLookupLiveNotes();
    return true;
  }

  function refreshCatalogInBackground(context, { force = false } = {}) {
    const runtime = window.__freqbeaconReceiverRuntime;
    if (!runtime?.refresh) return;
    runtime.refresh(context, { force }).catch(() => {});
  }

  async function startPlayer({ frequency, station, mode = 'am', container = null }) {
    if (!Number.isFinite(frequency) || frequency < 10 || frequency > 30000) return;
    const panel = createPlayerShell();
    const context = contextFor(frequency, container);
    context.station = station || context.station || 'Live signal';
    const sameManualContext = sdr.manualReceiverId && sdr.manualContextKey === contextKey(context);

    sdr.manager?.cancel('new-listen-live');
    sdr.frequency = frequency;
    sdr.station = station || 'Live signal';
    sdr.mode = PASSBANDS[mode] ? mode : 'am';
    sdr.manualStop = false;
    sdr.connected = false;
    sdr.gotAudio = false;
    sdr.configured = false;
    applyRecommendations(context, { preserveManual:Boolean(sameManualContext) });

    panel.hidden = false;
    panel.classList.remove('is-minimized');
    document.body.classList.add('sdr-player-open');
    document.body.classList.remove('sdr-player-minimized');
    panel.querySelector('[data-sdr-minimize]').textContent = '⌄';
    updatePlayerReadout();
    setStatus('Connecting', false);
    setMessage('Opening the highest-ranked local/cached receiver immediately…');
    drawIdleSpectrum('CONNECTING');

    // Start audio permission/resume and the WebSocket in the same user-action
    // turn. ReceiverBook refresh is deliberately not on this critical path.
    const audioReady = ensureAudioContext();
    startConnection({ manual:Boolean(sameManualContext) });
    refreshCatalogInBackground(context, { force:false });
    try {
      await audioReady;
    } catch (error) {
      sdr.manager?.stop('audio-blocked');
      setStatus('Audio blocked', false);
      setMessage(error?.message || 'Could not start audio.', true);
    }
  }

  async function stopSdr({ keepPanel = true, message = 'Stopped.' } = {}) {
    sdr.manualStop = true;
    clearKeepalive();
    sdr.manager?.stop('user-stop');
    setStatus('Stopped', false);
    updateRssi(null);
    const context = sdr.audioContext;
    sdr.audioContext = null;
    sdr.gain = null;
    if (context && context.state !== 'closed') {
      try { await context.close(); } catch {}
    }
    drawIdleSpectrum('STOPPED');
    setMessage(message);
    playerEl('[data-sdr-toggle]').textContent = 'Play';
    if (!keepPanel) {
      sdr.panel.hidden = true;
      document.body.classList.remove('sdr-player-open', 'sdr-player-minimized');
    }
  }

  function closePlayer() {
    closeReceiverChooser();
    stopSdr({ keepPanel:false });
  }

  function drawIdleSpectrum(label) {
    const canvas = sdr.panel?.querySelector('[data-sdr-canvas]');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(300, Math.round((rect.width || 300) * dpr));
    const height = Math.max(120, Math.round((rect.height || 150) * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#020608'; ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(37,212,230,.08)'; ctx.lineWidth = 1;
    for (let x = 0; x < width; x += width / 10) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
    for (let y = 0; y < height; y += height / 6) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    ctx.fillStyle = 'rgba(124,234,242,.55)'; ctx.font = `${10 * dpr}px monospace`; ctx.textAlign = 'center'; ctx.fillText(label, width / 2, height / 2);
  }

  function rewriteLookupLiveNotes() {
    const results = document.getElementById('lookupResults');
    if (!results) return;
    const receiver = currentReceiver();
    const inputFrequency = parseFrequencyValue(document.getElementById('lookupFrequency')?.value);
    const matches = Number.isFinite(inputFrequency) && Number.isFinite(sdr.recommendationFrequency)
      && Math.abs(inputFrequency - sdr.recommendationFrequency) < 5.2;
    results.querySelectorAll('.lookup-live-note').forEach((note) => {
      if (!matches || !receiver) {
        note.textContent = 'Live RF · FreqBeacon will choose a receiver locally · remote reception may differ from your location';
        return;
      }
      const distance = formatDistance(receiver.distanceMiles);
      note.textContent = `Live RF · ${receiver.location || receiver.name}${distance ? ` · ${distance}` : ''} · remote reception may differ from your location`;
    });
  }

  function primaryLookupContainer() {
    return document.querySelector('#lookupResults .lookup-result-primary, #lookupResults .lookup-result');
  }

  function refreshLookupRecommendations({ force = false } = {}) {
    if (!sdr.panel?.hidden && Number.isFinite(sdr.frequency)) return true;
    const primary = primaryLookupContainer();
    const frequency = frequencyFromContainer(primary) || parseFrequencyValue(document.getElementById('lookupFrequency')?.value);
    if (!Number.isFinite(frequency) || frequency < 10 || frequency > 30000) {
      renderLookupReceiverButton();
      return false;
    }
    const context = contextFor(frequency, primary);
    const ok = applyRecommendations(context, { preserveManual:true });
    refreshCatalogInBackground(context, { force });
    return ok;
  }

  function scheduleLookupRecommendation() {
    if (!sdr.panel?.hidden && Number.isFinite(sdr.frequency)) return;
    window.clearTimeout(sdr.lookupRecommendationTimer);
    sdr.lookupRecommendationTimer = window.setTimeout(() => refreshLookupRecommendations({ force:false }), 60);
  }

  function openCardReceiverOptions(card) {
    const frequency = frequencyFromContainer(card);
    if (!Number.isFinite(frequency)) return;
    const context = contextFor(frequency, card);
    applyRecommendations(context, { preserveManual:true });
    const input = document.getElementById('lookupFrequency');
    if (input) input.value = Number.isInteger(frequency) ? String(frequency) : frequency.toFixed(1);
    openReceiverChooser();
    refreshCatalogInBackground(context, { force:false });
  }

  function handleDocumentClick(event) {
    const options = event.target.closest('.card-receiver-options');
    if (options) {
      const card = options.closest('.signal-card');
      if (!card) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openCardReceiverOptions(card);
      return;
    }

    const live = event.target.closest('.listen-live-button');
    if (!live) return;
    const container = live.closest('.lookup-result, .signal-card');
    const frequency = frequencyFromContainer(container);
    if (!Number.isFinite(frequency)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    startPlayer({
      frequency,
      station:stationFromContainer(container),
      mode:modeFromContainer(container),
      container
    });
  }

  createPlayerShell();
  createReceiverChooser();
  installLookupReceiverControl();
  rewriteLookupLiveNotes();
  document.addEventListener('click', handleDocumentClick, true);

  const lookupResults = document.getElementById('lookupResults');
  if (lookupResults) {
    new MutationObserver(() => {
      rewriteLookupLiveNotes();
      scheduleLookupRecommendation();
    }).observe(lookupResults, { childList:true, subtree:true });
  }
  document.getElementById('lookupFrequency')?.addEventListener('input', renderLookupReceiverButton);

  window.__freqbeaconSdrPlayer = Object.freeze({
    version:'sdr-player-source-v2',
    openReceiverChooser,
    refreshLookupRecommendations,
    getState:() => ({
      frequency:sdr.frequency,
      receiverId:currentReceiver()?.id || '',
      receiverCount:sdr.receivers.length,
      connected:sdr.connected,
      manualReceiverId:sdr.manualReceiverId,
      directorySource:sdr.directorySource
    })
  });
})();
