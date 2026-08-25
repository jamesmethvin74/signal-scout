(() => {
  const hamBands = window.SIGNAL_SCOUT_HAM_BANDS || [];
  const bandTabs = document.querySelector('.band-tabs');
  const grid = document.getElementById('signalGrid');
  const title = document.getElementById('resultsTitle');
  const count = document.getElementById('resultCount');
  const search = document.getElementById('searchInput');
  const language = document.getElementById('languageFilter');
  if (!bandTabs || !grid || !title || !count || !search || !language || !hamBands.length) return;

  let hamActive = false;
  let selectedOffset = 0;
  let bestOnly = false;
  let internalRender = false;

  const style = document.createElement('style');
  style.textContent = `
    .ham-range { font-size: 27px; font-weight: 900; line-height: 1.05; letter-spacing: -.03em; }
    .ham-range span { margin-left: 5px; color: #9db0c7; font-size: 12px; font-weight: 700; letter-spacing: .03em; }
    .ham-starts { margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,.07); }
    .ham-starts-title { margin-bottom: 7px; color: #f4f7fb; font-size: 12px; font-weight: 800; }
    .ham-starts-list { color: #82969c; font-size: 10px; line-height: 1.55; }
    .ham-note { margin-top: 10px; color: #b8c7d8; font-size: 12px; line-height: 1.45; }
    .ham-disclaimer { grid-column: 1 / -1; margin-bottom: 2px; padding: 12px 14px; border: 1px solid #24415f; border-radius: 14px; background: #0e2138; color: #bed0e3; font-size: 12px; line-height: 1.5; }
    .ham-quick-tunes { display:flex; flex-wrap:wrap; gap:7px; margin-top:8px; }
    .ham-quick-target.lookup-result { display:flex; flex:1 1 145px; min-width:0; margin:0; padding:0; border:0; border-radius:0; background:none; box-shadow:none; }
    .ham-quick-button { width:100%; min-height:48px; justify-content:flex-start; align-items:flex-start; flex-direction:column; gap:2px; padding:8px 10px; text-align:left; }
    .ham-quick-button-main { display:flex; align-items:center; gap:7px; color:#d9f9df; font-family:var(--mono); font-size:10px; font-weight:900; letter-spacing:.045em; text-transform:uppercase; }
    .ham-quick-button-meta { color:#7fa3aa; font-family:var(--mono); font-size:8px; font-weight:700; letter-spacing:.04em; }
    .ham-quick-note { margin-top:7px; color:#667d83; font-family:var(--mono); font-size:8px; line-height:1.45; }
    @media (max-width:430px) {
      .ham-quick-target.lookup-result { flex-basis:calc(50% - 4px); }
      .ham-quick-button { min-height:52px; }
    }
  `;
  document.head.appendChild(style);

  const hamButton = document.createElement('button');
  hamButton.className = 'tab';
  hamButton.dataset.band = 'HAM';
  hamButton.textContent = 'Amateur';
  bandTabs.appendChild(hamButton);

  function solarHour(date) {
    const longitudeText = document.getElementById('locationMeta')?.textContent || '';
    const match = longitudeText.match(/(-?\d+\.\d+)\s*·/);
    const longitude = match ? Number(match[1]) : null;
    if (Number.isFinite(longitude)) {
      return (date.getUTCHours() + date.getUTCMinutes() / 60 + longitude / 15 + 24) % 24;
    }
    return date.getHours() + date.getMinutes() / 60;
  }

  function activityFor(band, date) {
    const hour = solarHour(date);
    const night = hour >= 19 || hour < 6;
    const dusk = (hour >= 17 && hour < 19) || (hour >= 6 && hour < 8);
    let score = dusk ? band.dusk : night ? band.night : band.day;
    const weekend = date.getDay() === 0 || date.getDay() === 6;
    if (weekend) score += 5;
    score = Math.max(5, Math.min(96, score));

    let label = 'Quiet';
    let cls = 'score-long';
    if (score >= 80) { label = 'Great bet'; cls = 'score-good'; }
    else if (score >= 62) { label = 'Worth checking'; cls = 'score-good'; }
    else if (score >= 42) { label = 'Possible'; cls = 'score-maybe'; }

    const reasons = [];
    reasons.push(night ? 'nighttime conditions' : dusk ? 'dawn/dusk transition' : 'daytime conditions');
    if (weekend) reasons.push('weekend activity boost');
    if (band.short === '10m' || band.short === '12m' || band.short === '15m') reasons.push('strongly dependent on solar propagation');
    if (band.short === '40m' || band.short === '80m') reasons.push('usually busier after dark');
    if (band.short === '20m') reasons.push('usually strongest for daytime DX');
    return { score, label, cls, reasons: reasons.join(' · ') };
  }

  function antennaAdvice(band, score) {
    let whip = score >= 75 ? 'Worth trying' : score >= 50 ? 'Possible' : 'Limited';
    let wire = score >= 80 ? 'Helpful' : score >= 55 ? 'Recommended' : 'Strongly recommended';
    if (band.short === '160m' || band.short === '80m') {
      whip = 'Limited';
      wire = 'Strongly recommended';
    }
    return [
      ['Telescopic', whip, score >= 50 ? 'good' : 'maybe'],
      ['Ferrite bar', 'Not used for HF ham', 'off'],
      ['Added wire', wire, 'good']
    ];
  }

  function formatQuickFrequency(mhz) {
    const digits = mhz < 10 ? 4 : 3;
    return `${mhz.toFixed(digits)} MHz`;
  }

  function quickTuneMarkup(band) {
    const tunes = Array.isArray(band.quickTunes) ? band.quickTunes : [];
    if (!tunes.length) return `<div class="ham-starts-list">${band.starts.join(' · ')}</div>`;
    return `
      <div class="ham-quick-tunes">
        ${tunes.map((tune) => {
          const frequencyKHz = tune.frequencyMHz * 1000;
          const rxMode = String(tune.mode || 'usb').toLowerCase();
          return `
            <div class="lookup-result ham-quick-target">
              <span class="lookup-result-frequency" hidden>${frequencyKHz.toFixed(1)} kHz</span>
              <h3 hidden>${band.name} · ${tune.label}</h3>
              <button type="button" class="listen-live-button ham-quick-button" data-ham-quick-mode="${rxMode}" aria-label="Quick tune ${tune.label} on ${formatQuickFrequency(tune.frequencyMHz)}">
                <span class="ham-quick-button-main"><span class="live-dot" aria-hidden="true"></span>${tune.label}</span>
                <span class="ham-quick-button-meta">${formatQuickFrequency(tune.frequencyMHz)} · ${rxMode.toUpperCase()} RX</span>
              </button>
            </div>`;
        }).join('')}
      </div>
      <div class="ham-quick-note">Tap a target to open the in-app SDR. Digital/CW targets use USB receive when a dedicated decoder is not needed.</div>`;
  }

  function card(band, date) {
    const activity = activityFor(band, date);
    const antennas = antennaAdvice(band, activity.score);
    return `
      <article class="signal-card" data-ham-card="true">
        <div class="card-top">
          <div>
            <div class="ham-range">${band.minMHz.toFixed(3)}–${band.maxMHz.toFixed(3)}<span>MHz</span></div>
            <div class="station-name">${band.name} amateur band</div>
            <div class="station-description">${band.character}</div>
          </div>
          <div class="score">
            <strong class="${activity.cls}">${activity.label}</strong>
            <small>${activity.score}/100</small>
            <div class="score-meter"><i style="width:${activity.score}%"></i></div>
          </div>
        </div>
        <div class="tags">
          <span class="tag">${band.short} band</span>
          <span class="tag">Amateur radio</span>
          <span class="tag">${band.modes}</span>
        </div>
        <div class="details">
          <div class="detail">Band<b>${band.short}</b></div>
          <div class="detail">Allocation<b>${band.listen}</b></div>
          <div class="detail">What you may hear<b>${band.modes}</b></div>
          <div class="detail">Activity estimate<b>${activity.label}</b></div>
        </div>
        <div class="ham-starts">
          <div class="ham-starts-title">Quick tune live receiver</div>
          ${quickTuneMarkup(band)}
        </div>
        <div class="antenna-guide" data-antenna-guide="true">
          <div class="antenna-guide-title">Antenna starting point</div>
          <div class="antenna-options">
            ${antennas.map(([name,status,cls]) => `<span class="antenna-option ${cls}"><strong>${name}:</strong> ${status}</span>`).join('')}
          </div>
        </div>
        <div class="ham-note">${band.note}</div>
        <div class="why"><b>Why this activity rating:</b> ${activity.reasons}. This is a band-condition estimate, not a promise that a specific operator is transmitting.</div>
      </article>`;
  }

  function renderHam() {
    if (!hamActive) return;
    internalRender = true;
    const date = new Date(Date.now() + selectedOffset * 3600000);
    const query = search.value.trim().toLowerCase();
    let results = hamBands.map((band) => ({ band, activity: activityFor(band, date) }));
    if (query) {
      results = results.filter(({band}) => [band.name, band.short, band.character, band.modes, band.listen, ...band.starts].join(' ').toLowerCase().includes(query));
    }
    if (bestOnly) results = results.filter(({activity}) => activity.score >= 55);
    results.sort((a,b) => b.activity.score - a.activity.score || a.band.minMHz - b.band.minMHz);

    title.textContent = bestOnly ? 'Best amateur bands to try' : 'Amateur bands worth checking';
    count.textContent = `${results.length} band${results.length === 1 ? '' : 's'}`;
    language.disabled = true;
    language.title = 'Language filtering does not apply to amateur bands';
    grid.dataset.hamView = 'true';
    grid.innerHTML = `
      <div class="ham-disclaimer">Amateur radio is not scheduled like international broadcasting. These cards show U.S./ITU Region 2 HF amateur allocations and likely band activity for the selected time. Quick Tune opens a live public SDR at a useful activity frequency; exact operators and signals change minute to minute.</div>
      ${results.map(({band}) => card(band, date)).join('')}`;
    internalRender = false;
  }

  function activateHam() {
    hamActive = true;
    [...bandTabs.querySelectorAll('.tab')].forEach((button) => button.classList.remove('active'));
    hamButton.classList.add('active');
    renderHam();
  }

  // This capture listener is registered before sdr-player.js. It sets the
  // receiver mode for a Quick Tune target before the shared player handles it.
  document.addEventListener('click', (event) => {
    const quickTune = event.target.closest('[data-ham-quick-mode]');
    if (!quickTune) return;
    const mode = quickTune.dataset.hamQuickMode;
    const lookupMode = document.getElementById('lookupMode');
    if (lookupMode && ['am', 'sam', 'usb', 'lsb'].includes(mode)) lookupMode.value = mode;
  }, true);

  hamButton.addEventListener('click', (event) => {
    event.stopPropagation();
    activateHam();
  });

  [...bandTabs.querySelectorAll('.tab')].filter((button) => button !== hamButton).forEach((button) => {
    button.addEventListener('click', () => {
      hamActive = false;
      language.disabled = false;
      language.title = '';
      delete grid.dataset.hamView;
    }, true);
  });

  document.querySelectorAll('.time-picker .chip').forEach((button) => {
    button.addEventListener('click', (event) => {
      if (!hamActive) return;
      event.stopImmediatePropagation();
      document.querySelectorAll('.time-picker .chip').forEach((item) => item.classList.remove('active'));
      button.classList.add('active');
      selectedOffset = Number(button.dataset.offset);
      renderHam();
    }, true);
  });

  search.addEventListener('input', (event) => {
    if (!hamActive) return;
    event.stopImmediatePropagation();
    renderHam();
  }, true);

  language.addEventListener('change', (event) => {
    if (hamActive) event.stopImmediatePropagation();
  }, true);

  const bestButton = document.getElementById('bestBetsButton');
  bestButton?.addEventListener('click', (event) => {
    if (!hamActive) return;
    event.stopImmediatePropagation();
    bestOnly = !bestOnly;
    bestButton.classList.toggle('active', bestOnly);
    renderHam();
  }, true);

  const observer = new MutationObserver(() => {
    if (!hamActive || internalRender) return;
    if (grid.dataset.hamView !== 'true' || !grid.querySelector('[data-ham-card]')) renderHam();
  });
  observer.observe(grid, { childList: true, subtree: false });
})();
