(() => {
  const grid = document.getElementById('signalGrid');
  const main = document.querySelector('.app-shell main');
  const locationCard = document.querySelector('.location-card');
  const resultsHeader = document.querySelector('.results-header');
  const resultsTitle = document.getElementById('resultsTitle');
  const resultCount = document.getElementById('resultCount');
  const onAirButton = document.getElementById('onAirButton');
  const lookupButton = document.getElementById('lookupButton');
  const bestBetsButton = document.getElementById('bestBetsButton');
  const aboutButton = document.getElementById('aboutButton');
  const lookupInput = document.getElementById('lookupFrequency');
  const lookupSubmit = document.getElementById('lookupSubmit');
  const lookupMode = document.getElementById('lookupMode');
  const lookupView = document.getElementById('lookupView');
  const navInner = document.querySelector('.bottom-nav-inner');

  if (!grid || !main || !onAirButton || !lookupButton || !navInner) return;

  const state = {
    broadcastTargets: [],
    currentTarget: null,
    history: [],
    historyIndex: -1,
    surpriseCursor: 0,
    gridFrame: 0
  };

  const HAM_VOICE = [
    { match: '160 meters', band: '160m', frequency: 1910.0, mode: 'lsb', station: '160 meters · SSB voice', label: 'Explore 160m voice', day: 20, night: 82 },
    { match: '80 / 75 meters', band: '80m', frequency: 3900.0, mode: 'lsb', station: '80 meters · regional voice', label: 'Explore 80m voice', day: 35, night: 94 },
    { match: '60 meters', band: '60m', frequency: 5357.0, mode: 'usb', station: '60 meters · USB voice', label: 'Explore 60m voice', day: 45, night: 78 },
    { match: '40 meters', band: '40m', frequency: 7200.0, mode: 'lsb', station: '40 meters · SSB voice', label: 'Explore 40m voice', day: 62, night: 96 },
    { match: '20 meters', band: '20m', frequency: 14300.0, mode: 'usb', station: '20 meters · DX voice', label: 'Explore 20m voice', day: 95, night: 52 },
    { match: '17 meters', band: '17m', frequency: 18130.0, mode: 'usb', station: '17 meters · DX voice', label: 'Explore 17m voice', day: 82, night: 34 },
    { match: '15 meters', band: '15m', frequency: 21300.0, mode: 'usb', station: '15 meters · DX voice', label: 'Explore 15m voice', day: 74, night: 22 },
    { match: '12 meters', band: '12m', frequency: 24950.0, mode: 'usb', station: '12 meters · DX voice', label: 'Explore 12m voice', day: 60, night: 15 },
    { match: '10 meters', band: '10m', frequency: 28400.0, mode: 'usb', station: '10 meters · SSB voice', label: 'Explore 10m voice', day: 52, night: 10 }
  ];

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function targetKey(target) {
    if (!target) return '';
    return `${Number(target.frequency).toFixed(1)}|${target.mode || 'am'}|${target.station || ''}`;
  }

  function parseFrequencyText(text) {
    const clean = String(text || '').replace(/,/g, '');
    const value = Number(clean.match(/[0-9]+(?:\.[0-9]+)?/)?.[0]);
    return Number.isFinite(value) ? value : null;
  }

  function targetFromContainer(container) {
    if (!container) return null;
    const lookupFrequency = container.querySelector('.lookup-result-frequency')?.textContent || '';
    if (lookupFrequency) {
      const frequency = parseFrequencyText(lookupFrequency);
      if (!Number.isFinite(frequency)) return null;
      const quick = container.querySelector('[data-ham-quick-mode]');
      return {
        frequency,
        mode: quick?.dataset.hamQuickMode || lookupMode?.value || 'am',
        station: container.querySelector('h3')?.textContent?.trim() || 'Live signal',
        kind: quick ? 'ham' : 'broadcast'
      };
    }

    const frequencyEl = container.querySelector('.frequency');
    if (!frequencyEl) return null;
    const unit = frequencyEl.querySelector('span')?.textContent?.trim().toLowerCase() || '';
    const clone = frequencyEl.cloneNode(true);
    clone.querySelector('span')?.remove();
    let frequency = parseFrequencyText(clone.textContent);
    if (!Number.isFinite(frequency)) return null;
    if (unit.includes('mhz')) frequency *= 1000;
    return {
      frequency,
      mode: 'am',
      station: container.querySelector('.station-name')?.textContent?.trim() || 'Live signal',
      kind: 'broadcast'
    };
  }

  function remember(target) {
    if (!target || !Number.isFinite(target.frequency)) return;
    const key = targetKey(target);
    if (targetKey(state.currentTarget) === key) return;
    if (state.historyIndex < state.history.length - 1) {
      state.history = state.history.slice(0, state.historyIndex + 1);
    }
    state.history.push({ ...target });
    if (state.history.length > 40) state.history.shift();
    state.historyIndex = state.history.length - 1;
    state.currentTarget = { ...target };
  }

  function proxyMarkup(target) {
    const frequency = Number(target.frequency);
    const mode = String(target.mode || 'am').toLowerCase();
    if (target.kind === 'ham' || mode === 'usb' || mode === 'lsb') {
      return `
        <div class="lookup-result fb-discovery-proxy" hidden>
          <span class="lookup-result-frequency">${frequency.toFixed(1)} kHz</span>
          <h3>${escapeHtml(target.station || 'Amateur voice')}</h3>
          <button type="button" class="listen-live-button" data-ham-quick-mode="${escapeHtml(mode)}">Listen</button>
        </div>`;
    }
    const mhz = frequency >= 1000;
    const value = mhz ? (frequency / 1000).toFixed(frequency % 10 ? 3 : 2) : frequency.toFixed(Number.isInteger(frequency) ? 0 : 1);
    return `
      <article class="signal-card fb-discovery-proxy" hidden>
        <div class="frequency">${value}<span>${mhz ? 'MHz' : 'kHz'}</span></div>
        <div class="station-name">${escapeHtml(target.station || 'Live signal')}</div>
        <button type="button" class="listen-live-button">Listen</button>
      </article>`;
  }

  function startTarget(target, { record = true } = {}) {
    if (!target || !Number.isFinite(target.frequency)) return false;
    if (record) remember(target);
    else state.currentTarget = { ...target };

    const holder = document.createElement('div');
    holder.dataset.fbProxyHolder = 'true';
    holder.innerHTML = proxyMarkup(target);
    document.body.appendChild(holder);
    const button = holder.querySelector('.listen-live-button');
    if (!button) {
      holder.remove();
      return false;
    }
    button.click();
    window.setTimeout(() => holder.remove(), 0);
    window.setTimeout(installRadioControls, 0);
    return true;
  }

  function localHour() {
    try {
      const saved = JSON.parse(window.localStorage?.getItem('signalScout:location:v1') || 'null');
      if (saved?.timeZone) {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: saved.timeZone,
          hour: '2-digit',
          hour12: false
        }).formatToParts(new Date());
        const hour = Number(parts.find((part) => part.type === 'hour')?.value);
        if (Number.isFinite(hour)) return hour % 24;
      }
    } catch {}
    return new Date().getHours();
  }

  function rankedHamTargets() {
    const hour = localHour();
    const night = hour >= 19 || hour < 6;
    return HAM_VOICE
      .map((target) => ({ ...target, priority: night ? target.night : target.day, kind: 'ham' }))
      .sort((a, b) => b.priority - a.priority);
  }

  function discoveryPool() {
    const broadcast = state.broadcastTargets.slice(0, 8).map((target, index) => ({
      ...target,
      priority: 100 - index * 6,
      kind: 'broadcast'
    }));
    const ham = rankedHamTargets().slice(0, 4);
    return [...broadcast, ...ham]
      .sort((a, b) => b.priority - a.priority)
      .filter((target, index, all) => all.findIndex((item) => targetKey(item) === targetKey(target)) === index);
  }

  function hearSomethingNow() {
    const target = state.broadcastTargets[0] || rankedHamTargets()[0];
    if (target) startTarget(target);
  }

  function surpriseMe() {
    const pool = discoveryPool();
    if (!pool.length) return;
    const currentKey = targetKey(state.currentTarget);
    const choices = pool.filter((target) => targetKey(target) !== currentKey);
    const shortlist = (choices.length ? choices : pool).slice(0, Math.min(5, pool.length));
    const index = state.surpriseCursor % shortlist.length;
    state.surpriseCursor += 1;
    startTarget(shortlist[index]);
  }

  function poolForCurrent() {
    if (state.currentTarget?.kind === 'ham') return rankedHamTargets();
    return state.broadcastTargets.length ? state.broadcastTargets : discoveryPool();
  }

  function nextSignal(direction = 1) {
    const pool = poolForCurrent();
    if (!pool.length) return;
    const currentKey = targetKey(state.currentTarget);
    let index = pool.findIndex((target) => targetKey(target) === currentKey);
    if (index < 0) index = direction > 0 ? -1 : 0;
    index = (index + direction + pool.length) % pool.length;
    startTarget(pool[index]);
  }

  function previousSignal() {
    if (state.historyIndex > 0) {
      state.historyIndex -= 1;
      startTarget(state.history[state.historyIndex], { record: false });
      return;
    }
    nextSignal(-1);
  }

  function parsePlayerFrequency() {
    const text = document.querySelector('[data-sdr-frequency]')?.textContent || '';
    return parseFrequencyText(text);
  }

  function identifyCurrentSignal() {
    const frequency = parsePlayerFrequency();
    if (!Number.isFinite(frequency) || !lookupInput || !lookupSubmit) return;
    document.body.classList.add('fb-identify-open');
    lookupButton.click();
    lookupInput.value = Number.isInteger(frequency) ? String(frequency) : frequency.toFixed(1);
    const mode = String(document.querySelector('[data-sdr-mode]')?.value || 'am').toLowerCase();
    if (lookupMode && ['am', 'sam', 'usb', 'lsb'].includes(mode)) lookupMode.value = mode;
    lookupSubmit.click();
    window.setTimeout(() => lookupView?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0);
  }

  function installRadioControls() {
    const panel = document.getElementById('sdrPlayer');
    const body = panel?.querySelector('.sdr-player-body');
    const readout = panel?.querySelector('.sdr-readout');
    if (!panel || !body || !readout) return;

    panel.classList.add('fb-radio-simple');
    if (body.querySelector('[data-fb-radio-discovery]')) return;

    const controls = document.createElement('div');
    controls.className = 'fb-radio-discovery';
    controls.dataset.fbRadioDiscovery = 'true';
    controls.innerHTML = `
      <button type="button" data-fb-prev>Previous</button>
      <button type="button" class="fb-radio-surprise" data-fb-surprise>Surprise me</button>
      <button type="button" data-fb-next>Next</button>
      <button type="button" class="fb-radio-identify" data-fb-identify>What's here?</button>
      <button type="button" class="fb-radio-controls" data-fb-radio-controls>Controls</button>`;
    readout.insertAdjacentElement('afterend', controls);

    controls.querySelector('[data-fb-prev]').addEventListener('click', previousSignal);
    controls.querySelector('[data-fb-surprise]').addEventListener('click', surpriseMe);
    controls.querySelector('[data-fb-next]').addEventListener('click', () => nextSignal(1));
    controls.querySelector('[data-fb-identify]').addEventListener('click', identifyCurrentSignal);
    controls.querySelector('[data-fb-radio-controls]').addEventListener('click', (event) => {
      const advanced = panel.classList.toggle('fb-radio-advanced');
      event.currentTarget.textContent = advanced ? 'Less controls' : 'Controls';
    });
  }

  function cardName(card) {
    return String(card.querySelector('.station-name')?.textContent || '').trim().toLowerCase();
  }

  function hamTargetForCard(card) {
    const name = cardName(card);
    return HAM_VOICE.find((target) => name.includes(target.match.toLowerCase())) || null;
  }

  function decorateHamCard(card) {
    if (!card.matches('[data-ham-card]')) return;
    const target = hamTargetForCard(card);
    card.classList.toggle('fb-ham-no-voice', !target);
    if (!target || card.querySelector('[data-fb-ham-voice-actions]')) return;

    const starts = card.querySelector('.ham-starts');
    if (!starts) return;
    const actions = document.createElement('div');
    actions.className = 'fb-ham-voice-actions';
    actions.dataset.fbHamVoiceActions = 'true';
    actions.innerHTML = `
      <div class="lookup-result fb-ham-voice-target">
        <span class="lookup-result-frequency" hidden>${target.frequency.toFixed(1)} kHz</span>
        <h3 hidden>${escapeHtml(target.station)}</h3>
        <button type="button" class="listen-live-button fb-ham-voice-button" data-ham-quick-mode="${target.mode}">
          ${escapeHtml(target.label)} · ${target.mode.toUpperCase()}
        </button>
      </div>`;
    const title = starts.querySelector('.ham-starts-title');
    if (title) title.textContent = 'Voice exploration';
    starts.appendChild(actions);
  }

  function collectBroadcastTargets(cards) {
    const activeBand = document.querySelector('.band-tabs .tab.active')?.dataset.band;
    if (activeBand !== 'SW') return;
    const seen = new Set();
    const targets = [];
    for (const card of cards) {
      if (card.matches('[data-ham-card]')) continue;
      const target = targetFromContainer(card);
      if (!target || !Number.isFinite(target.frequency)) continue;
      const key = targetKey(target);
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push(target);
      if (targets.length >= 12) break;
    }
    if (targets.length) state.broadcastTargets = targets;
  }

  function updateGridPresentation() {
    state.gridFrame = 0;
    const cards = [...grid.querySelectorAll(':scope > .signal-card')];
    const hamView = grid.dataset.hamView === 'true' || cards.some((card) => card.matches('[data-ham-card]'));

    cards.forEach((card) => {
      card.classList.remove('fb-featured');
      if (hamView) decorateHamCard(card);
      else card.classList.remove('fb-ham-no-voice');
    });

    if (!hamView) collectBroadcastTargets(cards);

    const eligible = cards.filter((card) => !card.classList.contains('fb-ham-no-voice'));
    eligible.slice(0, 3).forEach((card) => card.classList.add('fb-featured'));

    if (document.body.classList.contains('fb-more-open')) {
      if (resultCount) resultCount.textContent = `${eligible.length} ${hamView ? 'bands' : 'signals'}`;
      return;
    }

    if (resultsTitle) resultsTitle.textContent = hamView ? 'Voice bands worth exploring' : 'Worth hearing right now';
    if (resultCount) resultCount.textContent = `${Math.min(3, eligible.length)} picks`;
  }

  function scheduleGridPresentation() {
    if (state.gridFrame) return;
    state.gridFrame = window.requestAnimationFrame(updateGridPresentation);
  }

  function showExplore() {
    document.body.classList.remove('fb-more-open', 'fb-identify-open');
    if (!lookupView?.hidden) onAirButton.click();
    document.querySelectorAll('.bottom-nav .nav-button').forEach((button) => button.classList.remove('active'));
    onAirButton.classList.add('active');
    scheduleGridPresentation();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showMore() {
    if (!lookupView?.hidden) onAirButton.click();
    document.body.classList.remove('fb-identify-open');
    document.body.classList.add('fb-more-open');
    document.querySelectorAll('.bottom-nav .nav-button').forEach((button) => button.classList.remove('active'));
    document.getElementById('fbMoreButton')?.classList.add('active');
    scheduleGridPresentation();
    document.querySelector('.time-picker')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function showRadio() {
    document.body.classList.remove('fb-identify-open');
    if (!lookupView?.hidden) onAirButton.click();
    const panel = document.getElementById('sdrPlayer');
    if (!panel || panel.hidden) {
      hearSomethingNow();
    } else {
      panel.classList.remove('is-minimized');
      document.body.classList.remove('sdr-player-minimized');
      const minimize = panel.querySelector('[data-sdr-minimize]');
      if (minimize) {
        minimize.textContent = '⌄';
        minimize.setAttribute('aria-label', 'Minimize player');
      }
    }
    document.querySelectorAll('.bottom-nav .nav-button').forEach((button) => button.classList.remove('active'));
    document.getElementById('fbRadioButton')?.classList.add('active');
  }

  function buildExploreHero() {
    if (document.getElementById('fbExploreHero')) return;
    const hero = document.createElement('section');
    hero.className = 'fb-explore-hero';
    hero.id = 'fbExploreHero';
    hero.innerHTML = `
      <div class="fb-explore-kicker">Live radio discovery</div>
      <h2>Explore the airwaves.</h2>
      <p>Start with something worth hearing, then tune around. The details are there when you want them.</p>
      <div class="fb-explore-actions">
        <button type="button" class="fb-explore-primary" data-fb-hear-now>▶ Hear something now</button>
        <button type="button" class="fb-explore-surprise" data-fb-surprise-home>✦ Surprise me</button>
      </div>
      <div class="fb-explore-bands">
        <button type="button" class="fb-explore-band" data-fb-shortwave>Shortwave</button>
        <button type="button" class="fb-explore-band" data-fb-ham>Amateur voice</button>
      </div>`;
    main.insertBefore(hero, locationCard || main.firstChild);

    hero.querySelector('[data-fb-hear-now]').addEventListener('click', hearSomethingNow);
    hero.querySelector('[data-fb-surprise-home]').addEventListener('click', surpriseMe);
    hero.querySelector('[data-fb-shortwave]').addEventListener('click', () => {
      const tab = document.querySelector('.band-tabs [data-band="SW"]');
      if (tab && !tab.classList.contains('active')) tab.click();
      window.setTimeout(() => resultsHeader?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0);
    });
    hero.querySelector('[data-fb-ham]').addEventListener('click', () => {
      const tab = document.querySelector('.band-tabs [data-band="HAM"]');
      if (tab) tab.click();
      window.setTimeout(() => resultsHeader?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0);
    });

    locationCard?.classList.add('fb-location-strip');

    const note = document.createElement('div');
    note.className = 'fb-more-panel-note';
    note.textContent = 'Advanced discovery: change time, band, search, language, or inspect the full signal list.';
    resultsHeader?.insertAdjacentElement('beforebegin', note);
  }

  function buildNavigation() {
    onAirButton.querySelector('b').textContent = '⌁';
    onAirButton.querySelector('span').textContent = 'Explore';
    lookupButton.querySelector('b').textContent = '⌕';
    lookupButton.querySelector('span').textContent = 'Identify';

    if (bestBetsButton) bestBetsButton.hidden = true;
    if (aboutButton) aboutButton.hidden = true;

    if (!document.getElementById('fbRadioButton')) {
      const radio = document.createElement('button');
      radio.className = 'nav-button';
      radio.id = 'fbRadioButton';
      radio.innerHTML = '<b>◫</b><span>Radio</span>';
      radio.addEventListener('click', showRadio);
      lookupButton.insertAdjacentElement('beforebegin', radio);
    }

    if (!document.getElementById('fbMoreButton')) {
      const more = document.createElement('button');
      more.className = 'nav-button';
      more.id = 'fbMoreButton';
      more.innerHTML = '<b>•••</b><span>More</span>';
      more.addEventListener('click', showMore);
      navInner.appendChild(more);
    }

    onAirButton.addEventListener('click', () => {
      document.body.classList.remove('fb-more-open', 'fb-identify-open');
      window.setTimeout(scheduleGridPresentation, 0);
    });
    lookupButton.addEventListener('click', () => {
      document.body.classList.remove('fb-more-open');
      document.body.classList.add('fb-identify-open');
    });
  }

  // Capture before sdr-player's document-level capture handler stops propagation.
  window.addEventListener('click', (event) => {
    const button = event.target.closest?.('.listen-live-button');
    if (!button || button.closest('[data-fb-proxy-holder]')) return;
    const target = targetFromContainer(button.closest('.lookup-result, .signal-card'));
    if (target) remember(target);
  }, true);

  buildExploreHero();
  buildNavigation();
  installRadioControls();
  updateGridPresentation();

  new MutationObserver(scheduleGridPresentation).observe(grid, { childList: true, subtree: false });

  const player = document.getElementById('sdrPlayer');
  if (player) {
    player.classList.add('fb-radio-simple');
  } else {
    const bodyObserver = new MutationObserver(() => {
      if (!document.getElementById('sdrPlayer')) return;
      bodyObserver.disconnect();
      installRadioControls();
    });
    bodyObserver.observe(document.body, { childList: true });
  }

  if (window.SIGNAL_SCOUT_DATA_READY?.then) {
    window.SIGNAL_SCOUT_DATA_READY.then(scheduleGridPresentation).catch(() => {});
  }
})();
