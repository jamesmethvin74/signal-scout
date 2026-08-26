(() => {
  const LOCATION_STORAGE_KEY = 'signalScout:location:v1';
  const LEGACY_RECEIVERS = [
    {
      id: 'florida',
      name: 'Florida KiwiSDR',
      location: 'Palm Harbor, Florida',
      distanceMiles: null,
      minKHz: 10,
      maxKHz: 30000,
      role: 'ALTERNATE',
      reason: 'Fallback public receiver while the live directory is unavailable.',
      recommended: true
    },
    {
      id: 'north-carolina',
      name: 'North Carolina KiwiSDR',
      location: 'Apex, North Carolina',
      distanceMiles: null,
      minKHz: 10,
      maxKHz: 30000,
      role: 'ALTERNATE',
      reason: 'Fallback public receiver while the live directory is unavailable.',
      recommended: false
    },
    {
      id: 'pennsylvania',
      name: 'Pennsylvania KiwiSDR',
      location: 'Ridley Park, Pennsylvania',
      distanceMiles: null,
      minKHz: 10,
      maxKHz: 30000,
      role: 'ALTERNATE',
      reason: 'Fallback public receiver while the live directory is unavailable.',
      recommended: false
    }
  ];

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
    socket: null,
    audioContext: null,
    analyser: null,
    gain: null,
    nextPlayTime: 0,
    sampleRate: 12000,
    frequency: null,
    station: '',
    mode: 'am',
    receivers: LEGACY_RECEIVERS.map((receiver) => ({ ...receiver })),
    receiverIndex: 0,
    manualReceiverId: null,
    connected: false,
    configured: false,
    gotAudio: false,
    manualStop: false,
    keepaliveTimer: null,
    connectTimer: null,
    animationFrame: null,
    lastRssi: null,
    fallbackTried: new Set(),
    decoder: new TextDecoder(),
    recommendationSequence: 0,
    recommendationFrequency: null,
    recommendationStation: '',
    directorySource: 'fallback',
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
    const decimals = Number.isInteger(khz) ? 0 : 1;
    return `${khz.toLocaleString(undefined, { maximumFractionDigits: decimals })} kHz`;
  }

  function formatDistance(distanceMiles) {
    if (!Number.isFinite(distanceMiles)) return '';
    return `${Math.round(distanceMiles).toLocaleString()} mi from you`;
  }

  function formatCoverage(receiver) {
    const min = Number(receiver?.minKHz);
    const max = Number(receiver?.maxKHz);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return 'KiwiSDR';
    const minText = min >= 1000 ? `${(min / 1000).toFixed(min % 1000 ? 1 : 0)} MHz` : `${Math.round(min)} kHz`;
    const maxText = max >= 1000 ? `${(max / 1000).toFixed(max % 1000 ? 1 : 0)} MHz` : `${Math.round(max)} kHz`;
    return `${minText}–${maxText}`;
  }

  function loadStoredLocation() {
    try {
      const payload = JSON.parse(window.localStorage?.getItem(LOCATION_STORAGE_KEY) || 'null');
      const lat = Number(payload?.lat);
      const lon = Number(payload?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon };
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
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;
    return { lat, lon };
  }

  function injectStyles() {
    if (document.getElementById('signal-scout-sdr-player-styles')) return;
    const style = document.createElement('style');
    style.id = 'signal-scout-sdr-player-styles';
    style.textContent = `
      .sdr-player { position:fixed; left:50%; bottom:calc(68px + env(safe-area-inset-bottom)); z-index:30; width:min(720px,calc(100% - 16px)); transform:translateX(-50%); border:1px solid rgba(37,212,230,.72); border-radius:10px; overflow:hidden; background:#050b0e; box-shadow:0 -14px 44px rgba(0,0,0,.62),0 0 28px rgba(37,212,230,.08); }
      .sdr-player[hidden] { display:none !important; }
      .sdr-player-head { display:flex; align-items:center; gap:10px; padding:10px 12px; border-bottom:1px solid rgba(37,212,230,.16); background:linear-gradient(180deg,#0a171c,#071014); }
      .sdr-player-title { min-width:0; flex:1; }
      .sdr-player-title strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#eef6f7; font-size:13px; }
      .sdr-player-title span { display:block; margin-top:2px; color:var(--accent); font-family:var(--mono); font-size:10px; letter-spacing:.05em; }
      .sdr-status { display:inline-flex; align-items:center; gap:6px; flex:0 0 auto; color:#8fa2a7; font-family:var(--mono); font-size:9px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; }
      .sdr-status-dot { width:7px; height:7px; border-radius:50%; background:#6f7e82; }
      .sdr-player.is-live .sdr-status { color:var(--green); }
      .sdr-player.is-live .sdr-status-dot { background:var(--green); box-shadow:0 0 10px rgba(97,231,134,.7); }
      .sdr-icon-button { width:34px; height:34px; flex:0 0 auto; border:1px solid #1b3c43; border-radius:5px; color:#9eb0b5; background:#071014; font-size:15px; }
      .sdr-icon-button:hover { border-color:#2f6a74; color:#e3f2f4; }
      .sdr-player-body { padding:10px 12px 12px; }
      .sdr-spectrum-wrap { position:relative; overflow:hidden; border:1px solid #16424b; border-radius:6px; background:#020608; }
      .sdr-spectrum-label { position:absolute; left:8px; top:6px; z-index:2; color:#688087; font-family:var(--mono); font-size:8px; font-weight:800; letter-spacing:.08em; text-transform:uppercase; pointer-events:none; }
      .sdr-spectrum { display:block; width:100%; height:150px; }
      .sdr-readout { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:7px; color:#71878d; font-family:var(--mono); font-size:9px; }
      .sdr-readout span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .sdr-readout strong { color:#b8c8cb; font-weight:700; white-space:nowrap; }
      .sdr-controls { display:grid; grid-template-columns:120px minmax(0,1fr) 92px; gap:8px; align-items:end; margin-top:10px; }
      .sdr-control label { display:block; margin-bottom:4px; color:#71868c; font-family:var(--mono); font-size:8px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; }
      .sdr-control select { width:100%; min-height:38px; border:1px solid #1b3a41; border-radius:5px; padding:7px 28px 7px 9px; color:#d7e4e6; background:#050d10; font-size:10px; }
      .sdr-receiver-button { width:100%; min-height:38px; display:flex; align-items:center; justify-content:space-between; gap:8px; border:1px solid #1b3a41; border-radius:5px; padding:7px 9px; color:#d7e4e6; background:#050d10; text-align:left; }
      .sdr-receiver-button:hover { border-color:#2f6973; }
      .sdr-receiver-button-main { min-width:0; }
      .sdr-receiver-button-main strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#dce9eb; font-family:var(--mono); font-size:9px; }
      .sdr-receiver-button-main span { display:block; margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#6f8b91; font-family:var(--mono); font-size:8px; }
      .sdr-receiver-button-arrow { color:var(--accent); font-family:var(--mono); font-size:12px; }
      .sdr-volume { display:flex; align-items:center; gap:7px; min-height:38px; padding:0 9px; border:1px solid #1b3a41; border-radius:5px; background:#050d10; }
      .sdr-volume span { color:#70858b; font-size:12px; }
      .sdr-volume input { width:100%; accent-color:var(--accent); }
      .sdr-toggle { min-height:38px; border:1px solid rgba(37,212,230,.58); border-radius:5px; color:var(--accent-soft); background:rgba(37,212,230,.07); font-family:var(--mono); font-size:9px; font-weight:900; letter-spacing:.07em; text-transform:uppercase; }
      .sdr-message { margin-top:8px; min-height:15px; color:#8ca0a5; font-size:10px; line-height:1.4; }
      .sdr-message.is-error { color:#efbd5c; }
      .sdr-context-note { margin-top:6px; padding-top:6px; border-top:1px solid rgba(37,212,230,.08); color:#61777d; font-family:var(--mono); font-size:8px; line-height:1.45; }
      .sdr-player.is-minimized .sdr-player-body { display:none; }
      body.sdr-player-open .app-shell { padding-bottom:455px !important; }
      body.sdr-player-open.sdr-player-minimized .app-shell { padding-bottom:150px !important; }

      .sdr-chooser { position:fixed; inset:0; z-index:80; display:flex; align-items:flex-end; justify-content:center; padding:12px; background:rgba(0,4,6,.72); backdrop-filter:blur(5px); }
      .sdr-chooser[hidden] { display:none !important; }
      .sdr-chooser-dialog { width:min(720px,100%); max-height:min(78vh,760px); display:flex; flex-direction:column; overflow:hidden; border:1px solid rgba(37,212,230,.55); border-radius:13px; background:#050b0e; box-shadow:0 24px 80px rgba(0,0,0,.72),0 0 34px rgba(37,212,230,.08); }
      .sdr-chooser-head { display:flex; align-items:flex-start; gap:12px; padding:13px 14px; border-bottom:1px solid rgba(37,212,230,.14); background:linear-gradient(180deg,#0b181d,#071014); }
      .sdr-chooser-head-text { flex:1; min-width:0; }
      .sdr-chooser-kicker { color:var(--accent); font-family:var(--mono); font-size:8px; font-weight:900; letter-spacing:.11em; text-transform:uppercase; }
      .sdr-chooser-head h3 { margin:3px 0 0; color:#edf6f7; font-size:16px; }
      .sdr-chooser-head p { margin:4px 0 0; color:#70868c; font-size:10px; line-height:1.4; }
      .sdr-chooser-list { overflow:auto; padding:8px; overscroll-behavior:contain; }
      .sdr-choice { width:100%; display:block; margin:0 0 7px; border:1px solid #15363d; border-radius:8px; padding:11px; color:inherit; background:#071014; text-align:left; }
      .sdr-choice:last-child { margin-bottom:0; }
      .sdr-choice:hover { border-color:#2b6570; background:#09181d; }
      .sdr-choice.is-selected { border-color:rgba(37,212,230,.72); box-shadow:inset 0 0 0 1px rgba(37,212,230,.10); background:rgba(37,212,230,.055); }
      .sdr-choice-top { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
      .sdr-choice-name { min-width:0; color:#e5eff0; font-size:12px; font-weight:850; line-height:1.3; }
      .sdr-choice-distance { flex:0 0 auto; color:#8aa0a5; font-family:var(--mono); font-size:8px; white-space:nowrap; }
      .sdr-choice-location { margin-top:2px; color:#8ca1a6; font-size:10px; }
      .sdr-choice-badges { display:flex; flex-wrap:wrap; gap:5px; margin-top:7px; }
      .sdr-choice-badge { display:inline-flex; align-items:center; min-height:20px; border:1px solid #1d4149; border-radius:3px; padding:3px 6px; color:#80a1a7; background:#061014; font-family:var(--mono); font-size:7px; font-weight:900; letter-spacing:.06em; text-transform:uppercase; }
      .sdr-choice-badge.is-recommended { border-color:rgba(97,231,134,.48); color:#8cf0a6; background:rgba(97,231,134,.06); }
      .sdr-choice-reason { margin-top:7px; color:#a5b7bb; font-size:10px; line-height:1.45; }
      .sdr-choice-meta { margin-top:6px; color:#5f777d; font-family:var(--mono); font-size:8px; }
      .sdr-chooser-foot { padding:9px 12px 11px; border-top:1px solid rgba(37,212,230,.10); color:#647b80; font-size:9px; line-height:1.45; }
      .sdr-chooser-foot.is-warning { color:#d0a954; }

      #lookupReceiver[hidden] { display:none !important; }
      .lookup-receiver-smart { width:100%; min-height:46px; display:flex; align-items:center; justify-content:space-between; gap:10px; border:1px solid #1c4650; border-radius:7px; padding:9px 11px; color:#dbe8ea; background:#071216; text-align:left; }
      .lookup-receiver-smart:hover { border-color:#2e6d78; }
      .lookup-receiver-smart strong { display:block; color:#e3eff0; font-size:10px; }
      .lookup-receiver-smart span { display:block; margin-top:3px; color:#759097; font-family:var(--mono); font-size:8px; }
      .lookup-receiver-smart b { flex:0 0 auto; color:var(--accent); font-family:var(--mono); font-size:9px; letter-spacing:.06em; text-transform:uppercase; }

      @media (max-width:560px) {
        .sdr-player { bottom:calc(65px + env(safe-area-inset-bottom)); width:calc(100% - 10px); }
        .sdr-player-head { padding:9px 10px; }
        .sdr-player-body { padding:8px 9px 10px; }
        .sdr-spectrum { height:132px; }
        .sdr-controls { grid-template-columns:92px minmax(0,1fr); }
        .sdr-controls .sdr-play-control { grid-column:1 / -1; }
        .sdr-toggle { width:100%; }
        body.sdr-player-open .app-shell { padding-bottom:445px !important; }
        .sdr-chooser { padding:5px; }
        .sdr-chooser-dialog { max-height:82vh; border-radius:12px 12px 7px 7px; }
        .sdr-chooser-head { padding:12px; }
        .sdr-chooser-list { padding:6px; }
        .sdr-choice { padding:10px; }
      }
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
        <div class="sdr-player-title">
          <strong data-sdr-station>Live receiver</strong>
          <span data-sdr-frequency>-- kHz · AM</span>
        </div>
        <button class="sdr-icon-button" type="button" data-sdr-minimize aria-label="Minimize player">⌄</button>
        <button class="sdr-icon-button" type="button" data-sdr-close aria-label="Close player">×</button>
      </div>
      <div class="sdr-player-body">
        <div class="sdr-spectrum-wrap">
          <div class="sdr-spectrum-label">Live audio spectrum / baseband waterfall</div>
          <canvas class="sdr-spectrum" data-sdr-canvas></canvas>
        </div>
        <div class="sdr-readout">
          <span data-sdr-receiver>Receiver: --</span>
          <strong data-sdr-rssi>RSSI --</strong>
        </div>
        <div class="sdr-controls">
          <div class="sdr-control">
            <label for="sdrMode">Mode</label>
            <select id="sdrMode" data-sdr-mode>
              <option value="am">AM</option>
              <option value="sam">SAM</option>
              <option value="usb">USB</option>
              <option value="lsb">LSB</option>
            </select>
          </div>
          <div class="sdr-control">
            <label>Receiver</label>
            <button class="sdr-receiver-button" type="button" data-sdr-receiver-button aria-haspopup="dialog">
              <span class="sdr-receiver-button-main"><strong data-sdr-receiver-button-name>Automatic</strong><span data-sdr-receiver-button-meta>Signal Scout chooses the best match</span></span>
              <span class="sdr-receiver-button-arrow">⌄</span>
            </button>
          </div>
          <div class="sdr-control sdr-play-control">
            <label>&nbsp;</label>
            <button class="sdr-toggle" type="button" data-sdr-toggle>Stop</button>
          </div>
        </div>
        <div class="sdr-control" style="margin-top:8px">
          <label>Volume</label>
          <div class="sdr-volume"><span>◖</span><input data-sdr-volume type="range" min="0" max="1" step="0.01" value="0.75" aria-label="Volume" /><span>◗</span></div>
        </div>
        <div class="sdr-message" data-sdr-message>Tap Listen Live on any signal to start.</div>
        <div class="sdr-context-note">Remote SDR reception may differ from reception at your location. Signal Scout's reception score still describes your location, not this remote receiver.</div>
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
      if (sdr.socket || sdr.connected) {
        stopSdr({ keepPanel: true, message: 'Stopped. Tap Play to reconnect.' });
      } else if (Number.isFinite(sdr.frequency)) {
        sdr.manualStop = false;
        sdr.fallbackTried.clear();
        connectSdr(sdr.receiverIndex);
      }
    });
    panel.querySelector('[data-sdr-volume]').addEventListener('input', (event) => {
      if (sdr.gain) sdr.gain.gain.value = Number(event.target.value);
    });
    panel.querySelector('[data-sdr-mode]').addEventListener('change', (event) => {
      sdr.mode = PASSBANDS[event.target.value] ? event.target.value : 'am';
      updatePlayerReadout();
      if (sdr.socket?.readyState === WebSocket.OPEN && sdr.configured) sendTuning();
    });
    panel.querySelector('[data-sdr-receiver-button]').addEventListener('click', () => openReceiverChooser());

    drawIdleSpectrum('READY');
    return panel;
  }

  function createReceiverChooser() {
    if (sdr.chooser) return sdr.chooser;
    injectStyles();
    const chooser = document.createElement('div');
    chooser.className = 'sdr-chooser';
    chooser.hidden = true;
    chooser.innerHTML = `
      <div class="sdr-chooser-dialog" role="dialog" aria-modal="true" aria-labelledby="sdrChooserTitle">
        <div class="sdr-chooser-head">
          <div class="sdr-chooser-head-text">
            <div class="sdr-chooser-kicker">Receiver intelligence</div>
            <h3 id="sdrChooserTitle">Choose listening receiver</h3>
            <p data-sdr-chooser-subtitle>Signal Scout ranks public receivers for this frequency and path.</p>
          </div>
          <button class="sdr-icon-button" type="button" data-sdr-chooser-close aria-label="Close receiver chooser">×</button>
        </div>
        <div class="sdr-chooser-list" data-sdr-chooser-list></div>
        <div class="sdr-chooser-foot" data-sdr-chooser-foot>Public SDRs are independently operated and can fill up or go offline without warning.</div>
      </div>`;
    chooser.addEventListener('click', (event) => {
      if (event.target === chooser) closeReceiverChooser();
      const choice = event.target.closest('[data-sdr-choice-index]');
      if (!choice) return;
      chooseReceiver(Number(choice.dataset.sdrChoiceIndex));
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
    return sdr.receivers[sdr.receiverIndex] || sdr.receivers[0] || LEGACY_RECEIVERS[0];
  }

  function renderReceiverButton() {
    const receiver = currentReceiver();
    const panel = createPlayerShell();
    panel.querySelector('[data-sdr-receiver-button-name]').textContent = receiver?.name || 'Automatic';
    const distance = formatDistance(receiver?.distanceMiles);
    panel.querySelector('[data-sdr-receiver-button-meta]').textContent = [
      receiver?.recommended ? '★ Recommended' : receiver?.role,
      distance || receiver?.location
    ].filter(Boolean).join(' · ');
    renderLookupReceiverButton();
  }

  function renderLookupReceiverButton() {
    const button = sdr.lookupReceiverButton;
    if (!button) return;
    const receiver = currentReceiver();
    const frequency = parseFrequencyValue(document.getElementById('lookupFrequency')?.value);
    const recommendationMatches = Number.isFinite(frequency)
      && Number.isFinite(sdr.recommendationFrequency)
      && Math.abs(frequency - sdr.recommendationFrequency) < 5.2;

    const strong = button.querySelector('strong');
    const meta = button.querySelector('span');
    const badge = button.querySelector('b');
    if (!recommendationMatches) {
      strong.textContent = 'Automatic receiver selection';
      meta.textContent = 'Signal Scout will rank public SDRs for this frequency';
      badge.textContent = 'SMART';
      return;
    }
    strong.textContent = `${receiver?.name || 'Recommended receiver'}${Number.isFinite(receiver?.distanceMiles) ? ` · ${Math.round(receiver.distanceMiles).toLocaleString()} mi` : ''}`;
    meta.textContent = receiver?.reason || receiver?.location || 'Best available public receiver';
    badge.textContent = receiver?.recommended ? '★ BEST' : (receiver?.role || 'SELECTED');
  }

  function renderReceiverChooser() {
    const chooser = createReceiverChooser();
    const frequencyText = Number.isFinite(sdr.recommendationFrequency) ? formatFrequency(sdr.recommendationFrequency) : 'this frequency';
    chooser.querySelector('[data-sdr-chooser-subtitle]').textContent = `Ranked for ${frequencyText}${sdr.recommendationStation ? ` · ${sdr.recommendationStation}` : ''}.`;
    const list = chooser.querySelector('[data-sdr-chooser-list]');
    list.innerHTML = sdr.receivers.map((receiver, index) => {
      const distance = formatDistance(receiver.distanceMiles);
      const badges = [
        receiver.recommended ? '<span class="sdr-choice-badge is-recommended">★ Recommended</span>' : '',
        receiver.role && receiver.role !== 'ALTERNATE' ? `<span class="sdr-choice-badge">${escapeHtml(receiver.role)}</span>` : ''
      ].filter(Boolean).join('');
      return `
        <button type="button" class="sdr-choice ${index === sdr.receiverIndex ? 'is-selected' : ''}" data-sdr-choice-index="${index}">
          <div class="sdr-choice-top">
            <div class="sdr-choice-name">${escapeHtml(receiver.name || 'Public KiwiSDR')}</div>
            <div class="sdr-choice-distance">${escapeHtml(distance)}</div>
          </div>
          <div class="sdr-choice-location">${escapeHtml(receiver.location || 'Location not listed')}</div>
          ${badges ? `<div class="sdr-choice-badges">${badges}</div>` : ''}
          <div class="sdr-choice-reason">${escapeHtml(receiver.reason || 'Public receiver covering this frequency.')}</div>
          <div class="sdr-choice-meta">${escapeHtml(formatCoverage(receiver))} · PUBLIC KIWI</div>
        </button>`;
    }).join('');
    const foot = chooser.querySelector('[data-sdr-chooser-foot]');
    foot.classList.toggle('is-warning', Boolean(sdr.directoryWarning));
    foot.textContent = sdr.directoryWarning
      ? `Live receiver directory unavailable; showing fallback receivers. ${sdr.directoryWarning}`
      : 'Public SDRs are independently operated and can fill up or go offline without warning. Remote reception is not a measurement of reception at your location.';
  }

  function openReceiverChooser() {
    renderReceiverChooser();
    const chooser = createReceiverChooser();
    chooser.hidden = false;
    const selected = chooser.querySelector('.sdr-choice.is-selected');
    window.setTimeout(() => selected?.scrollIntoView({ block: 'nearest' }), 0);
  }

  function closeReceiverChooser() {
    if (sdr.chooser) sdr.chooser.hidden = true;
  }

  function chooseReceiver(index) {
    if (!sdr.receivers[index]) return;
    sdr.receiverIndex = index;
    sdr.manualReceiverId = sdr.receivers[index].id;
    closeReceiverChooser();
    renderReceiverButton();
    updatePlayerReadout();
    rewriteLookupLiveNotes();
    if (!sdr.panel?.hidden && Number.isFinite(sdr.frequency)) {
      sdr.manualStop = false;
      sdr.fallbackTried.clear();
      connectSdr(index);
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
    button.innerHTML = '<span><strong>Automatic receiver selection</strong><span>Signal Scout will rank public SDRs for this frequency</span></span><b>SMART</b>';
    select.insertAdjacentElement('afterend', button);
    const label = select.closest('.lookup-receiver-row')?.querySelector('label');
    if (label) label.htmlFor = button.id;
    button.addEventListener('click', async () => {
      if (!sdr.panel?.hidden && Number.isFinite(sdr.frequency)) {
        openReceiverChooser();
        return;
      }
      await refreshLookupRecommendations({ force: true });
      openReceiverChooser();
    });
    sdr.lookupReceiverButton = button;
    renderLookupReceiverButton();
  }

  function setMessage(message, isError = false) {
    const el = playerEl('[data-sdr-message]');
    el.textContent = message;
    el.classList.toggle('is-error', isError);
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
      ? `${formatFrequency(sdr.frequency)} · ${sdr.mode.toUpperCase()}`
      : '-- kHz';
    const distance = formatDistance(receiver?.distanceMiles);
    panel.querySelector('[data-sdr-receiver]').textContent = `Receiver: ${receiver?.location || receiver?.name || '--'}${distance ? ` · ${distance}` : ''}`;
    panel.querySelector('[data-sdr-mode]').value = sdr.mode;
    panel.querySelector('[data-sdr-toggle]').textContent = sdr.socket || sdr.connected ? 'Stop' : 'Play';
    renderReceiverButton();
  }

  function rssiToS(rssi) {
    if (!Number.isFinite(rssi)) return '';
    if (rssi >= -73) return `S9+${Math.max(0, Math.round(rssi + 73))}`;
    const value = Math.max(0, Math.min(9, Math.round(9 + (rssi + 73) / 6)));
    return `S${value}`;
  }

  function updateRssi(rssi) {
    sdr.lastRssi = rssi;
    const suffix = rssiToS(rssi);
    playerEl('[data-sdr-rssi]').textContent = Number.isFinite(rssi)
      ? `RSSI ${rssi.toFixed(1)} dB${suffix ? ` · ${suffix}` : ''}`
      : 'RSSI --';
  }

  async function ensureAudioContext() {
    if (sdr.audioContext && sdr.audioContext.state !== 'closed') {
      if (sdr.audioContext.state === 'suspended') await sdr.audioContext.resume();
      return sdr.audioContext;
    }
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) throw new Error('Web Audio is not supported in this browser.');
    const context = new AudioContextCtor({ latencyHint: 'interactive' });
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    const gain = context.createGain();
    gain.gain.value = Number(playerEl('[data-sdr-volume]').value || 0.75);
    analyser.connect(gain);
    gain.connect(context.destination);
    sdr.audioContext = context;
    sdr.analyser = analyser;
    sdr.gain = gain;
    sdr.nextPlayTime = context.currentTime + 0.08;
    startSpectrumAnimation();
    return context;
  }

  function scheduleAudio(samples) {
    const context = sdr.audioContext;
    if (!context || context.state === 'closed' || !samples?.length) return;
    const sampleRate = Number.isFinite(sdr.sampleRate) && sdr.sampleRate > 1000 ? sdr.sampleRate : 12000;
    const buffer = context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(sdr.analyser);
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
    if (sdr.socket?.readyState === WebSocket.OPEN) sdr.socket.send(message);
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
    sendSocket('SET ident_user=Signal Scout');
    sendTuning();
    sendSocket('SET agc=1 hang=0 thresh=-100 slope=6 decay=1000 manGain=50');
    sendSocket('SET compression=0');
    sendSocket('SET squelch=0 max=0');
    sendSocket('SET genattn=0');
    sendSocket('SET gen=0 mix=-1');
    sendSocket('SET de_emp=0');
  }

  function parseKiwiMessage(bytes) {
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
      if (audioRate && sdr.audioContext) {
        sendSocket(`SET AR OK in=${Number(audioRate)} out=${Math.round(sdr.audioContext.sampleRate)}`);
      }
      if (/(?:^|\s)too_busy=1(?:\s|$)/.test(text)) failCurrentReceiver('Receiver is full. Trying the next ranked receiver…');
      if (/(?:^|\s)down=1(?:\s|$)/.test(text)) failCurrentReceiver('Receiver is offline. Trying the next ranked receiver…');
      return;
    }

    if (tag !== 'SND' || bytes.byteLength < 10) return;
    const body = bytes.subarray(3);
    const flags = body[0];
    const smeter = (body[5] << 8) | body[6];
    const rssi = smeter * 0.1 - 127;
    updateRssi(rssi);

    if ((flags & 0x10) !== 0) {
      sendSocket('SET compression=0');
      return;
    }

    const littleEndian = (flags & 0x80) !== 0;
    const audioBytes = body.subarray(7);
    if (audioBytes.byteLength < 2) return;
    scheduleAudio(decodePcm(audioBytes, littleEndian));

    if (!sdr.gotAudio) {
      sdr.gotAudio = true;
      sdr.connected = true;
      window.clearTimeout(sdr.connectTimer);
      setStatus('Live RF', true);
      setMessage('Actual receiver audio · spectrum and waterfall are generated from the live audio stream.');
      updatePlayerReadout();
    }
  }

  function websocketUrl(receiverIndex) {
    const receiver = sdr.receivers[receiverIndex] || sdr.receivers[0] || LEGACY_RECEIVERS[0];
    const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const timestamp = (Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 10000)) >>> 0;
    return `${scheme}//${window.location.host}/api/sdr/ws?receiver=${encodeURIComponent(receiver.id)}&stream=SND&ts=${timestamp}`;
  }

  function clearConnectionTimers() {
    window.clearTimeout(sdr.connectTimer);
    window.clearInterval(sdr.keepaliveTimer);
    sdr.connectTimer = null;
    sdr.keepaliveTimer = null;
  }

  function disconnectSocket() {
    clearConnectionTimers();
    const socket = sdr.socket;
    sdr.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try { socket.close(1000, 'Signal Scout disconnect'); } catch {}
    }
    sdr.connected = false;
    sdr.configured = false;
    sdr.gotAudio = false;
  }

  function nextFallbackReceiver() {
    for (let offset = 1; offset <= sdr.receivers.length; offset += 1) {
      const index = (sdr.receiverIndex + offset) % sdr.receivers.length;
      if (!sdr.fallbackTried.has(index)) return index;
    }
    return null;
  }

  function failCurrentReceiver(message) {
    if (sdr.manualStop) return;
    disconnectSocket();
    setMessage(message, true);
    const next = nextFallbackReceiver();
    if (next == null) {
      setStatus('Unavailable', false);
      setMessage('The ranked public receivers did not answer. Tap Retry or choose another receiver.', true);
      playerEl('[data-sdr-toggle]').textContent = 'Retry';
      drawIdleSpectrum('NO RECEIVER');
      return;
    }
    sdr.fallbackTried.add(next);
    window.setTimeout(() => connectSdr(next), 450);
  }

  async function connectSdr(receiverIndex) {
    if (!Number.isFinite(sdr.frequency)) return;
    disconnectSocket();
    sdr.manualStop = false;
    sdr.receiverIndex = sdr.receivers[receiverIndex] ? receiverIndex : 0;
    sdr.fallbackTried.add(sdr.receiverIndex);
    updatePlayerReadout();
    const receiver = currentReceiver();
    setStatus('Connecting', false);
    setMessage(`Connecting to ${receiver?.location || receiver?.name || 'public receiver'}…`);
    drawIdleSpectrum('CONNECTING');

    try {
      await ensureAudioContext();
    } catch (error) {
      setStatus('Audio blocked', false);
      setMessage(error.message || 'Could not start audio.', true);
      return;
    }

    let socket;
    try {
      socket = new WebSocket(websocketUrl(sdr.receiverIndex));
      socket.binaryType = 'arraybuffer';
    } catch {
      failCurrentReceiver('Could not open the receiver stream. Trying the next ranked receiver…');
      return;
    }
    sdr.socket = socket;

    socket.onopen = () => {
      sendSocket('SET auth t=kiwi p=#');
      sdr.keepaliveTimer = window.setInterval(() => sendSocket('SET keepalive'), 5000);
    };
    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) parseKiwiMessage(new Uint8Array(event.data));
      else if (event.data instanceof Blob) event.data.arrayBuffer().then((buffer) => parseKiwiMessage(new Uint8Array(buffer))).catch(() => {});
      else if (typeof event.data === 'string') parseKiwiMessage(new TextEncoder().encode(event.data));
    };
    socket.onerror = () => {
      if (!sdr.gotAudio) failCurrentReceiver('Receiver connection failed. Trying the next ranked receiver…');
    };
    socket.onclose = () => {
      if (!sdr.manualStop && !sdr.gotAudio) failCurrentReceiver('Receiver did not answer. Trying the next ranked receiver…');
      else if (!sdr.manualStop && sdr.gotAudio) {
        disconnectSocket();
        setStatus('Disconnected', false);
        setMessage('The public receiver disconnected. Tap Play to reconnect.', true);
        playerEl('[data-sdr-toggle]').textContent = 'Play';
      }
    };
    sdr.connectTimer = window.setTimeout(() => {
      if (!sdr.gotAudio) failCurrentReceiver('Receiver timed out. Trying the next ranked receiver…');
    }, 9000);
  }

  async function stopSdr({ keepPanel = true, message = 'Stopped.' } = {}) {
    sdr.manualStop = true;
    disconnectSocket();
    setStatus('Stopped', false);
    updateRssi(null);
    if (sdr.animationFrame) {
      cancelAnimationFrame(sdr.animationFrame);
      sdr.animationFrame = null;
    }
    const context = sdr.audioContext;
    sdr.audioContext = null;
    sdr.analyser = null;
    sdr.gain = null;
    if (context && context.state !== 'closed') {
      try { await context.close(); } catch {}
    }
    drawIdleSpectrum('STOPPED');
    setMessage(message);
    updatePlayerReadout();
    playerEl('[data-sdr-toggle]').textContent = 'Play';
    if (!keepPanel) {
      sdr.panel.hidden = true;
      document.body.classList.remove('sdr-player-open', 'sdr-player-minimized');
    }
  }

  function closePlayer() {
    closeReceiverChooser();
    stopSdr({ keepPanel: false });
  }

  function recommendationUrl(frequency, container) {
    const url = new URL('/api/sdr/receivers', window.location.origin);
    url.searchParams.set('frequency', Number(frequency).toFixed(1));
    const user = loadStoredLocation();
    if (user) {
      url.searchParams.set('lat', user.lat.toFixed(5));
      url.searchParams.set('lon', user.lon.toFixed(5));
    }
    const stationName = stationFromContainer(container);
    const tx = stationCoordinates(frequency, stationName);
    if (tx) {
      url.searchParams.set('txLat', tx.lat.toFixed(5));
      url.searchParams.set('txLon', tx.lon.toFixed(5));
    }
    return url;
  }

  async function refreshReceiverRecommendations({ frequency, container = null, force = false } = {}) {
    if (!Number.isFinite(frequency) || frequency < 10 || frequency > 30000) return false;
    const stationName = stationFromContainer(container);
    if (!force
      && Number.isFinite(sdr.recommendationFrequency)
      && Math.abs(sdr.recommendationFrequency - frequency) < 0.11
      && sdr.recommendationStation === stationName
      && sdr.receivers.length) return true;

    const sequence = ++sdr.recommendationSequence;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 6500);
    try {
      const response = await fetch(recommendationUrl(frequency, container), {
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`Receiver directory HTTP ${response.status}`);
      const payload = await response.json();
      if (sequence !== sdr.recommendationSequence) return false;
      if (!Array.isArray(payload?.receivers) || !payload.receivers.length) throw new Error('No public receiver covers this frequency');

      sdr.receivers = payload.receivers;
      sdr.directorySource = payload.source || 'directory';
      sdr.directoryWarning = payload.warning || null;
      sdr.recommendationFrequency = frequency;
      sdr.recommendationStation = stationName;
      const manualIndex = sdr.manualReceiverId
        ? sdr.receivers.findIndex((receiver) => receiver.id === sdr.manualReceiverId)
        : -1;
      const recommendedIndex = sdr.receivers.findIndex((receiver) => receiver.recommended);
      sdr.receiverIndex = manualIndex >= 0 ? manualIndex : (recommendedIndex >= 0 ? recommendedIndex : 0);
      renderReceiverButton();
      rewriteLookupLiveNotes();
      return true;
    } catch (error) {
      if (sequence !== sdr.recommendationSequence) return false;
      sdr.receivers = LEGACY_RECEIVERS.map((receiver) => ({ ...receiver }));
      sdr.directorySource = 'fallback';
      sdr.directoryWarning = error?.name === 'AbortError' ? 'Receiver directory timed out.' : (error?.message || 'Receiver directory unavailable.');
      sdr.recommendationFrequency = frequency;
      sdr.recommendationStation = stationName;
      const manualIndex = sdr.manualReceiverId
        ? sdr.receivers.findIndex((receiver) => receiver.id === sdr.manualReceiverId)
        : -1;
      sdr.receiverIndex = manualIndex >= 0 ? manualIndex : 0;
      renderReceiverButton();
      rewriteLookupLiveNotes();
      return false;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function startPlayer({ frequency, station, mode = 'am', container = null }) {
    if (!Number.isFinite(frequency) || frequency < 10 || frequency > 30000) return;
    const panel = createPlayerShell();
    sdr.frequency = frequency;
    sdr.station = station || 'Live signal';
    sdr.mode = PASSBANDS[mode] ? mode : 'am';
    sdr.manualStop = false;
    sdr.fallbackTried.clear();
    panel.hidden = false;
    panel.classList.remove('is-minimized');
    document.body.classList.add('sdr-player-open');
    document.body.classList.remove('sdr-player-minimized');
    panel.querySelector('[data-sdr-minimize]').textContent = '⌄';
    setStatus('Finding SDR', false);
    setMessage('Finding the most useful public receiver for this frequency and path…');
    drawIdleSpectrum('RANKING RECEIVERS');

    // Create/resume Web Audio while still inside the user's click gesture. The
    // directory lookup can then finish without Android/iOS blocking playback.
    try {
      await ensureAudioContext();
    } catch (error) {
      setStatus('Audio blocked', false);
      setMessage(error.message || 'Could not start audio.', true);
      return;
    }

    await refreshReceiverRecommendations({ frequency, container, force: true });
    if (sdr.manualStop || sdr.panel?.hidden || sdr.frequency !== frequency) return;
    updatePlayerReadout();
    connectSdr(sdr.receiverIndex);
  }

  function drawIdleSpectrum(label) {
    const canvas = sdr.panel?.querySelector('[data-sdr-canvas]');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(300, Math.round(rect.width * dpr));
    const height = Math.max(120, Math.round(rect.height * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#020608';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(37,212,230,.08)';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += width / 10) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y < height; y += height / 6) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(124,234,242,.55)';
    ctx.font = `${10 * dpr}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(label, width / 2, height / 2);
  }

  function startSpectrumAnimation() {
    if (sdr.animationFrame) cancelAnimationFrame(sdr.animationFrame);
    const canvas = playerEl('[data-sdr-canvas]');
    const freqData = new Uint8Array(sdr.analyser.frequencyBinCount);

    const draw = () => {
      if (!sdr.analyser || !sdr.audioContext || sdr.audioContext.state === 'closed') return;
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const width = Math.max(300, Math.round(rect.width * dpr));
      const height = Math.max(120, Math.round(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext('2d');
      const spectrumH = Math.round(height * 0.58);
      const waterfallTop = spectrumH + 1;
      const waterfallH = height - waterfallTop;
      sdr.analyser.getByteFrequencyData(freqData);

      if (waterfallH > 2) {
        ctx.drawImage(canvas, 0, waterfallTop, width, waterfallH - 1, 0, waterfallTop + 1, width, waterfallH - 1);
        const binW = width / freqData.length;
        for (let i = 0; i < freqData.length; i += 1) {
          const value = freqData[i] / 255;
          const hue = 190 - value * 120;
          const light = 7 + value * 55;
          ctx.fillStyle = `hsl(${hue} 85% ${light}%)`;
          ctx.fillRect(i * binW, waterfallTop, Math.ceil(binW + 1), 1);
        }
      }

      ctx.fillStyle = '#020608';
      ctx.fillRect(0, 0, width, spectrumH);
      ctx.strokeStyle = 'rgba(37,212,230,.08)';
      ctx.lineWidth = 1;
      for (let x = 0; x <= width; x += width / 8) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, spectrumH); ctx.stroke();
      }
      for (let y = 0; y <= spectrumH; y += spectrumH / 4) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }

      ctx.beginPath();
      for (let i = 0; i < freqData.length; i += 1) {
        const x = (i / (freqData.length - 1)) * width;
        const normalized = freqData[i] / 255;
        const y = spectrumH - 5 - normalized * (spectrumH - 12);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = '#25d4e6';
      ctx.lineWidth = Math.max(1, 1.3 * dpr);
      ctx.stroke();

      const nyquist = (sdr.sampleRate || 12000) / 2;
      ctx.fillStyle = 'rgba(183,200,203,.55)';
      ctx.font = `${8 * dpr}px monospace`;
      ctx.textAlign = 'left';
      ctx.fillText('0 Hz', 4 * dpr, spectrumH - 5 * dpr);
      ctx.textAlign = 'center';
      ctx.fillText(`${(nyquist / 2000).toFixed(1)} kHz`, width / 2, spectrumH - 5 * dpr);
      ctx.textAlign = 'right';
      ctx.fillText(`${(nyquist / 1000).toFixed(1)} kHz`, width - 4 * dpr, spectrumH - 5 * dpr);

      sdr.animationFrame = requestAnimationFrame(draw);
    };
    draw();
  }

  function rewriteLookupLiveNotes() {
    const results = document.getElementById('lookupResults');
    if (!results) return;
    const receiver = currentReceiver();
    const inputFrequency = parseFrequencyValue(document.getElementById('lookupFrequency')?.value);
    const matches = Number.isFinite(inputFrequency)
      && Number.isFinite(sdr.recommendationFrequency)
      && Math.abs(inputFrequency - sdr.recommendationFrequency) < 5.2;
    results.querySelectorAll('.lookup-live-note').forEach((note) => {
      if (!matches) {
        const text = 'Live RF · Signal Scout will choose a receiver · remote reception may differ from your location';
        if (note.textContent !== text) note.textContent = text;
        return;
      }
      const distance = formatDistance(receiver?.distanceMiles);
      const text = `Live RF · ${receiver?.location || receiver?.name || 'public receiver'}${distance ? ` · ${distance}` : ''} · remote reception may differ from your location`;
      if (note.textContent !== text) note.textContent = text;
    });
  }

  function primaryLookupContainer() {
    return document.querySelector('#lookupResults .lookup-result-primary, #lookupResults .lookup-result');
  }

  async function refreshLookupRecommendations({ force = false } = {}) {
    if (!sdr.panel?.hidden && Number.isFinite(sdr.frequency)) return true;
    const primary = primaryLookupContainer();
    const frequency = frequencyFromContainer(primary)
      || parseFrequencyValue(document.getElementById('lookupFrequency')?.value);
    if (!Number.isFinite(frequency) || frequency < 10 || frequency > 30000) {
      renderLookupReceiverButton();
      return false;
    }
    return refreshReceiverRecommendations({ frequency, container: primary, force });
  }

  function scheduleLookupRecommendation() {
    if (!sdr.panel?.hidden && Number.isFinite(sdr.frequency)) return;
    window.clearTimeout(sdr.lookupRecommendationTimer);
    sdr.lookupRecommendationTimer = window.setTimeout(() => refreshLookupRecommendations().catch(() => {}), 220);
  }

  function handleListenLiveClick(event) {
    const link = event.target.closest('.listen-live-button');
    if (!link) return;
    const container = link.closest('.lookup-result, .signal-card');
    const frequency = frequencyFromContainer(container);
    if (!Number.isFinite(frequency)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    startPlayer({
      frequency,
      station: stationFromContainer(container),
      mode: modeFromContainer(container),
      container
    });
  }

  createPlayerShell();
  createReceiverChooser();
  installLookupReceiverControl();
  rewriteLookupLiveNotes();
  document.addEventListener('click', handleListenLiveClick, true);

  const lookupResults = document.getElementById('lookupResults');
  if (lookupResults) {
    new MutationObserver(() => {
      rewriteLookupLiveNotes();
      scheduleLookupRecommendation();
    }).observe(lookupResults, { childList: true, subtree: true });
  }
  document.getElementById('lookupFrequency')?.addEventListener('input', () => {
    renderLookupReceiverButton();
  });
})();
