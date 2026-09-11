(() => {
  if (new URLSearchParams(window.location.search).get('classic') === '1') return;

  const LOCATION_STORAGE_KEY = 'signalScout:location:v1';

  function parseNumber(text) {
    const value = Number(String(text || '').replace(/,/g, '').match(/[0-9]+(?:\.[0-9]+)?/)?.[0]);
    return Number.isFinite(value) ? value : null;
  }

  function savedLocation() {
    try {
      const saved = JSON.parse(window.localStorage?.getItem(LOCATION_STORAGE_KEY) || 'null');
      const lat = Number(saved?.lat);
      const lon = Number(saved?.lon);
      return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
    } catch {
      return null;
    }
  }

  function milesBetween(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r;
    const dLon = (lon2 - lon1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 3958.8 * 2 * Math.asin(Math.sqrt(a));
  }

  function formatFrequency(target) {
    const frequency = Number(target.frequency);
    if (!Number.isFinite(frequency)) return '';
    if (frequency >= 1000) return `${(frequency / 1000).toFixed(frequency % 1000 ? 3 : 1)} MHz`;
    return `${Math.round(frequency)} kHz`;
  }

  function mediumWaveOptions() {
    const stations = (window.SIGNAL_SCOUT_STATIONS || []).filter((station) => station?.band === 'MW');
    const location = savedLocation();
    const hour = new Date().getHours();
    const night = hour >= 19 || hour < 6;

    return stations
      .map((station) => {
        const lat = Number(station.lat);
        const lon = Number(station.lon);
        const distance = location && Number.isFinite(lat) && Number.isFinite(lon)
          ? milesBetween(location.lat, location.lon, lat, lon)
          : 99999;
        const power = Number(night ? station.nightPower : station.dayPower) || 0;
        return { station, distance, power };
      })
      .sort((a, b) => a.distance - b.distance || b.power - a.power)
      .slice(0, 2)
      .map(({ station, distance }, index) => ({
        frequency: Number(station.frequency),
        mode: 'am',
        station: station.name || 'AM broadcast',
        title: station.name || 'Nearby AM station',
        description: Number.isFinite(distance) && distance < 99999
          ? `Nearby AM broadcast · about ${Math.round(distance)} miles from your listening location`
          : 'Nearby AM broadcast · a good place to hear regular voice programming',
        badge: index === 0 ? 'Closest AM' : 'Nearby AM'
      }));
  }

  function shortwaveOptions(limit = 3) {
    const grid = document.getElementById('signalGrid');
    if (!grid) return [];
    const cards = [...grid.querySelectorAll(':scope > .signal-card')];
    const options = [];

    for (const card of cards) {
      if (card.matches('[data-ham-card]')) continue;
      const frequencyEl = card.querySelector('.frequency');
      if (!frequencyEl) continue;
      const unit = frequencyEl.querySelector('span')?.textContent?.trim().toLowerCase() || '';
      const clone = frequencyEl.cloneNode(true);
      clone.querySelector('span')?.remove();
      let frequency = parseNumber(clone.textContent);
      if (!Number.isFinite(frequency)) continue;
      if (unit.includes('mhz')) frequency *= 1000;
      if (frequency < 1700) continue;

      const station = card.querySelector('.station-name')?.textContent?.trim() || 'Shortwave broadcast';
      const score = card.querySelector('.score strong')?.textContent?.trim() || 'On air now';
      const description = card.querySelector('.station-description')?.textContent?.trim();
      options.push({
        frequency,
        mode: 'am',
        station,
        title: station,
        description: description || 'Current shortwave broadcast from the FREQBEACON schedule',
        badge: `${score} shortwave`
      });
      if (options.length >= limit) break;
    }
    return options;
  }

  function broadcastOptions() {
    const options = [...mediumWaveOptions(), ...shortwaveOptions(3)];
    if (options.length) return options;
    return [
      { frequency: 10000, mode: 'am', station: 'WWV', title: 'WWV', description: 'A dependable shortwave time-and-frequency signal to get the receiver going.', badge: 'Reliable signal' },
      { frequency: 15000, mode: 'am', station: 'WWV', title: 'WWV', description: 'A higher daytime shortwave channel for live RF and audio.', badge: 'Daytime option' }
    ];
  }

  function hamOptions() {
    const hour = new Date().getHours();
    const night = hour >= 18 || hour < 7;
    const base = night ? [
      { frequency: 7200, mode: 'lsb', station: '40 meters · amateur voice', title: '40 meters', description: 'Regional conversations and evening activity. Usually the easiest ham band to start with.', badge: 'Recommended now' },
      { frequency: 3900, mode: 'lsb', station: '80 meters · amateur voice', title: '80 meters', description: 'Closer-range evening and nighttime conversations with plenty of ragchewing.', badge: 'Night voice' },
      { frequency: 14300, mode: 'usb', station: '20 meters · amateur voice', title: '20 meters', description: 'Long-distance voices and DX. Often still useful around sunset.', badge: 'Long distance' },
      { frequency: 5357, mode: 'usb', station: '60 meters · amateur voice', title: '60 meters', description: 'A smaller channelized voice band that can be interesting after dark.', badge: 'Worth a look' }
    ] : [
      { frequency: 14300, mode: 'usb', station: '20 meters · amateur voice', title: '20 meters', description: 'Long-distance voices and DX. One of the best daytime places to hear hams talking.', badge: 'Recommended now' },
      { frequency: 7200, mode: 'lsb', station: '40 meters · amateur voice', title: '40 meters', description: 'Regional conversations and a dependable all-around voice band.', badge: 'Regional voice' },
      { frequency: 28400, mode: 'usb', station: '10 meters · amateur voice', title: '10 meters', description: 'Daytime long-distance openings. Fantastic when the band is open, quiet when it is not.', badge: 'High upside' },
      { frequency: 18130, mode: 'usb', station: '17 meters · amateur voice', title: '17 meters', description: 'Quieter long-distance voice with less crowding than 20 meters.', badge: 'DX alternative' }
    ];
    return base;
  }

  function ensureSheet() {
    let backdrop = document.querySelector('[data-fb4-backdrop]');
    if (backdrop) return backdrop;

    backdrop = document.createElement('div');
    backdrop.className = 'fb4-backdrop';
    backdrop.dataset.fb4Backdrop = '1';
    backdrop.hidden = true;
    backdrop.innerHTML = `
      <section class="fb4-sheet" role="dialog" aria-modal="true" aria-labelledby="fb4Title">
        <div class="fb4-sheet-head">
          <div><div class="fb4-kicker">Choose a starting point</div><h3 id="fb4Title" data-fb4-title></h3><p data-fb4-subtitle></p></div>
          <button class="fb4-close" type="button" data-fb4-close aria-label="Close">×</button>
        </div>
        <div class="fb4-option-list" data-fb4-options></div>
        <div class="fb4-sheet-foot">You are not locking yourself in. Once the radio is live, Seek and the tuner can take you somewhere else.</div>
      </section>`;
    document.body.appendChild(backdrop);

    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop || event.target.closest('[data-fb4-close]')) closeSheet();
    });
    return backdrop;
  }

  function closeSheet() {
    const backdrop = document.querySelector('[data-fb4-backdrop]');
    if (!backdrop) return;
    backdrop.hidden = true;
    document.body.classList.remove('fb4-options-open');
  }

  function launchTarget(target, kind) {
    closeSheet();
    const home = document.getElementById('fbTunerHome');
    if (!home) return;

    const stationEl = home.querySelector('[data-fb2-station]');
    if (stationEl) stationEl.textContent = target.station || target.title || 'Live signal';

    let badge = home.querySelector('[data-fb3-live-kind]');
    if (!badge && stationEl) {
      badge = document.createElement('div');
      badge.className = 'fb3-live-kind';
      badge.dataset.fb3LiveKind = '1';
      stationEl.insertAdjacentElement('afterend', badge);
    }
    if (badge) badge.textContent = `${kind === 'ham' ? 'Amateur voice' : 'Broadcasts'} · ${target.title || target.station}`;

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.hidden = true;
    trigger.dataset.fb2Jump = `${Number(target.frequency)}|${target.mode || 'am'}|${target.station || target.title || 'Live signal'}`;
    home.appendChild(trigger);
    trigger.click();
    window.setTimeout(() => trigger.remove(), 0);
  }

  function showOptions(kind) {
    const backdrop = ensureSheet();
    const options = kind === 'ham' ? hamOptions() : broadcastOptions();
    const title = backdrop.querySelector('[data-fb4-title]');
    const subtitle = backdrop.querySelector('[data-fb4-subtitle]');
    const list = backdrop.querySelector('[data-fb4-options]');

    title.textContent = kind === 'ham' ? 'Pick an amateur voice band' : 'Pick a broadcast to try';
    subtitle.textContent = kind === 'ham'
      ? 'You only need to choose the kind of listening that sounds interesting. FREQBEACON handles the actual tuning and receiver.'
      : 'Here are a few sensible starts instead of one blind guess — nearby AM plus shortwave broadcasts that should be on the air now.';

    list.innerHTML = options.map((target, index) => `
      <button class="fb4-option ${index === 0 ? 'is-recommended' : ''}" type="button" data-fb4-index="${index}">
        <span class="fb4-option-main"><b>${target.title || target.station}</b><small>${target.description || ''}</small></span>
        <span class="fb4-option-side"><em>${target.badge || 'Try this'}</em><span>${formatFrequency(target)} · ${(target.mode || 'am').toUpperCase()}</span></span>
      </button>`).join('');

    list.querySelectorAll('[data-fb4-index]').forEach((button) => {
      button.addEventListener('click', () => {
        const target = options[Number(button.dataset.fb4Index)];
        if (target) launchTarget(target, kind);
      });
    });

    backdrop.hidden = false;
    document.body.classList.add('fb4-options-open');
    window.setTimeout(() => list.querySelector('button')?.focus({ preventScroll: true }), 30);
  }

  function installQuickSwitches(home) {
    const footer = home.querySelector('.fb2-footerbar');
    if (!footer || footer.querySelector('[data-fb4-quick-switches]')) return;
    const wrap = document.createElement('div');
    wrap.className = 'fb4-quick-switches';
    wrap.dataset.fb4QuickSwitches = '1';
    wrap.innerHTML = `
      <button type="button" data-fb4-open="broadcast">📻 Broadcasts</button>
      <button type="button" data-fb4-open="ham">🎙 Amateur</button>`;
    footer.insertBefore(wrap, footer.querySelector('.fb2-more'));
    wrap.addEventListener('click', (event) => {
      const button = event.target.closest('[data-fb4-open]');
      if (button) showOptions(button.dataset.fb4Open);
    });
  }

  function install() {
    const home = document.getElementById('fbTunerHome');
    const startInner = home?.querySelector('.fb2-start-inner');
    if (!home || !startInner) return false;

    const copy = startInner.querySelector('.fb3-start-copy');
    if (copy) copy.innerHTML = '<strong>You do not need to know a frequency.</strong> Pick a category first. Broadcasts and Amateur voice will then show you a few good places to start.';

    document.addEventListener('click', (event) => {
      const category = event.target.closest('[data-fb3-kind]');
      if (!category) return;
      const kind = category.dataset.fb3Kind;
      if (kind !== 'broadcast' && kind !== 'ham') return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      showOptions(kind);
    }, true);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && document.body.classList.contains('fb4-options-open')) closeSheet();
    });

    installQuickSwitches(home);
    return true;
  }

  if (install()) return;
  const observer = new MutationObserver(() => {
    if (install()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 10000);
})();
