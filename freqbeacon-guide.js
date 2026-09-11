(() => {
  if (new URLSearchParams(window.location.search).get('classic') === '1') return;

  const home = document.getElementById('fbTunerHome');
  const grid = document.getElementById('signalGrid');
  const player = document.getElementById('sdrPlayer');
  const startInner = home?.querySelector('.fb2-start-inner');
  if (!home || !grid || !player || !startInner) return;

  const LOCATION_STORAGE_KEY = 'signalScout:location:v1';
  const guide = {
    kind: '',
    targets: [],
    index: 0,
    retryTimer: null,
    launchToken: 0,
    live: false
  };

  const labels = {
    broadcast: 'Broadcasts',
    ham: 'Amateur voice',
    shortwave: 'Shortwave',
    longwave: 'Longwave'
  };

  function parseNumber(text) {
    const value = Number(String(text || '').replace(/,/g, '').match(/[0-9]+(?:\.[0-9]+)?/)?.[0]);
    return Number.isFinite(value) ? value : null;
  }

  function playerStatus() {
    return String(player.querySelector('[data-sdr-status]')?.textContent || '').trim().toLowerCase();
  }

  function setCoach(html, timeout = 0) {
    const coach = home.querySelector('[data-fb2-coach]');
    if (!coach) return;
    coach.innerHTML = html;
    coach.hidden = false;
    window.clearTimeout(setCoach.timer);
    if (timeout) setCoach.timer = window.setTimeout(() => { coach.hidden = true; }, timeout);
  }

  function setKindBadge(kind) {
    let badge = home.querySelector('[data-fb3-live-kind]');
    const station = home.querySelector('[data-fb2-station]');
    if (!badge && station) {
      badge = document.createElement('div');
      badge.className = 'fb3-live-kind';
      badge.dataset.fb3LiveKind = '1';
      station.insertAdjacentElement('afterend', badge);
    }
    if (badge) badge.textContent = `${labels[kind] || 'Radio'} · FREQBEACON chose the starting point`;
  }

  function dedupeTargets(targets) {
    const seen = new Set();
    return targets.filter((target) => {
      if (!target || !Number.isFinite(Number(target.frequency))) return false;
      const key = `${Number(target.frequency).toFixed(1)}|${String(target.mode || 'am').toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function shortwaveTargets() {
    const cards = [...grid.querySelectorAll(':scope > .signal-card')];
    const targets = [];
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
      targets.push({
        frequency,
        mode: 'am',
        station: card.querySelector('.station-name')?.textContent?.trim() || 'Shortwave broadcast'
      });
      if (targets.length >= 10) break;
    }
    return dedupeTargets(targets);
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

  function mediumWaveTargets() {
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
      .slice(0, 6)
      .map(({ station }) => ({
        frequency: Number(station.frequency),
        mode: 'am',
        station: station.name || 'AM broadcast'
      }));
  }

  function hamTargets() {
    const hour = new Date().getHours();
    const night = hour >= 18 || hour < 7;
    const daytime = [
      { frequency: 14300, mode: 'usb', station: '20 meters · amateur voice' },
      { frequency: 7200, mode: 'lsb', station: '40 meters · amateur voice' },
      { frequency: 18130, mode: 'usb', station: '17 meters · amateur voice' },
      { frequency: 21300, mode: 'usb', station: '15 meters · amateur voice' },
      { frequency: 28400, mode: 'usb', station: '10 meters · amateur voice' }
    ];
    const nighttime = [
      { frequency: 7200, mode: 'lsb', station: '40 meters · amateur voice' },
      { frequency: 3900, mode: 'lsb', station: '80 meters · amateur voice' },
      { frequency: 14300, mode: 'usb', station: '20 meters · amateur voice' },
      { frequency: 5357, mode: 'usb', station: '60 meters · amateur voice' }
    ];
    return night ? nighttime : daytime;
  }

  function longwaveTargets() {
    return [
      { frequency: 300, mode: 'am', station: 'Longwave · beacon and utility scan' },
      { frequency: 250, mode: 'am', station: 'Longwave · beacon and utility scan' },
      { frequency: 350, mode: 'am', station: 'Longwave · beacon and utility scan' },
      { frequency: 200, mode: 'am', station: 'Longwave · beacon and utility scan' },
      { frequency: 400, mode: 'am', station: 'Longwave · beacon and utility scan' }
    ];
  }

  function targetsFor(kind) {
    const sw = shortwaveTargets();
    if (kind === 'shortwave') return sw.length ? sw : [
      { frequency: 10000, mode: 'am', station: 'Shortwave · live band exploration' },
      { frequency: 15000, mode: 'am', station: 'Shortwave · live band exploration' },
      { frequency: 5000, mode: 'am', station: 'Shortwave · live band exploration' }
    ];
    if (kind === 'ham') return hamTargets();
    if (kind === 'longwave') return longwaveTargets();
    if (kind === 'broadcast') {
      const mw = mediumWaveTargets();
      return dedupeTargets([...mw.slice(0, 4), ...sw.slice(0, 6)]);
    }
    return sw;
  }

  function launchThroughTuner(target) {
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.hidden = true;
    trigger.dataset.fb2Jump = `${Number(target.frequency)}|${target.mode || 'am'}|${target.station || 'Live signal'}`;
    home.appendChild(trigger);
    trigger.click();
    window.setTimeout(() => trigger.remove(), 0);
  }

  function coachFor(kind, target, retry = false) {
    const intro = retry ? '<b>Trying another one…</b>' : '<b>Good choice.</b>';
    if (kind === 'broadcast') {
      return `${intro} I’m choosing an actual AM or shortwave broadcast for you and handling the frequency and receiver. You don’t need to know any radio numbers.`;
    }
    if (kind === 'ham') {
      return `${intro} I’m putting you in a voice-heavy amateur band for this time of day. Listen for conversation; Seek can move to another live carrier.`;
    }
    if (kind === 'shortwave') {
      return `${intro} I’m choosing a shortwave signal that should be on the air now. Once the waterfall appears, use Seek or tap a bright trace to explore around it.`;
    }
    return `${intro} I’m opening the longwave spectrum and looking for what the receiver can actually hear. In North America this is usually beacons, time or utility signals rather than speech.`;
  }

  function scheduleRetry(token) {
    window.clearTimeout(guide.retryTimer);
    guide.retryTimer = window.setTimeout(() => {
      if (token !== guide.launchToken || guide.live || playerStatus() === 'live rf') return;
      tryNext('timeout');
    }, 18000);
  }

  function launchIndex(index, retry = false) {
    if (!guide.targets.length) {
      setCoach('<b>Those recommendations are still loading.</b> Give FREQBEACON a moment, then pick that listening type again.', 3500);
      return;
    }
    guide.index = Math.max(0, Math.min(index, guide.targets.length - 1));
    guide.live = false;
    const target = guide.targets[guide.index];
    guide.launchToken += 1;
    const token = guide.launchToken;
    setKindBadge(guide.kind);
    setCoach(coachFor(guide.kind, target, retry));
    launchThroughTuner(target);
    scheduleRetry(token);
  }

  function tryNext(reason = '') {
    if (!guide.kind || !guide.targets.length) return;
    const maxTries = Math.min(5, guide.targets.length);
    if (guide.index + 1 >= maxTries) {
      window.clearTimeout(guide.retryTimer);
      setCoach(`<b>I couldn’t get a clean ${labels[guide.kind]?.toLowerCase() || 'radio'} start from the first ${maxTries} choices.</b> Pick another listening type and I’ll try a different part of the dial.`, 7000);
      return;
    }
    launchIndex(guide.index + 1, true);
  }

  function launchKind(kind) {
    guide.kind = kind;
    guide.targets = targetsFor(kind);
    guide.index = 0;
    guide.live = false;
    launchIndex(0, false);
  }

  function surpriseMe() {
    const hour = new Date().getHours();
    const order = hour >= 19 || hour < 7
      ? ['broadcast', 'ham', 'shortwave']
      : ['broadcast', 'shortwave', 'ham'];
    const kind = order[Math.floor(Math.random() * order.length)];
    launchKind(kind);
  }

  startInner.innerHTML = `
    <div class="fb2-start-mark">⌁</div>
    <h2>What do you want to hear?</h2>
    <p class="fb3-start-copy"><strong>You do not need to know a frequency.</strong> Pick a kind of radio and FREQBEACON will choose a sensible starting signal and receiver for you.</p>
    <div class="fb3-choice-grid">
      <button class="fb3-choice is-best" type="button" data-fb3-kind="broadcast">
        <b>📻 Broadcasts</b><span>Voices, news, talk or music from AM and international stations.</span><em>Best place to start</em>
      </button>
      <button class="fb3-choice" type="button" data-fb3-kind="ham">
        <b>🎙 Amateur voice</b><span>Real people talking on active ham bands. FREQBEACON chooses the band.</span><em>Conversation</em>
      </button>
      <button class="fb3-choice" type="button" data-fb3-kind="shortwave">
        <b>🌎 Shortwave</b><span>International radio and distant stations that are scheduled right now.</span><em>Explore the world</em>
      </button>
      <button class="fb3-choice" type="button" data-fb3-kind="longwave">
        <b>〰 Longwave</b><span>Explore the low end of the dial and hunt real beacons, time and utility signals.</span><em>Signal hunting</em>
      </button>
    </div>
    <button class="fb3-surprise" type="button" data-fb3-surprise>Surprise me — just find something interesting</button>
    <div class="fb3-no-frequency">FREQBEACON handles frequency · mode · receiver selection</div>`;

  startInner.querySelectorAll('[data-fb3-kind]').forEach((button) => {
    button.addEventListener('click', () => launchKind(button.dataset.fb3Kind));
  });
  startInner.querySelector('[data-fb3-surprise]')?.addEventListener('click', surpriseMe);

  const statusEl = player.querySelector('[data-sdr-status]');
  if (statusEl) {
    new MutationObserver(() => {
      const status = playerStatus();
      if (status === 'live rf') {
        guide.live = true;
        window.clearTimeout(guide.retryTimer);
        if (guide.kind === 'longwave') {
          setCoach('<b>You’re live on longwave.</b> This part of the spectrum is usually signal hunting rather than regular voice broadcasting in North America. Use Find signal or Seek to land on real activity.', 8000);
        } else if (guide.kind) {
          setCoach(`<b>You’re live.</b> FREQBEACON got you into ${labels[guide.kind].toLowerCase()}. Now use Seek, Find signal, or drag the tuner — no frequency entry required.`, 6500);
        }
      } else if (status === 'unavailable' && guide.kind && !guide.live) {
        window.clearTimeout(guide.retryTimer);
        window.setTimeout(() => tryNext('unavailable'), 500);
      }
    }).observe(statusEl, { childList: true, subtree: true, characterData: true });
  }
})();
