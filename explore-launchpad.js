(() => {
  'use strict';

  const RECOMMENDATION_FEED = '/api/explore/recommendation';
  const LOCATION_STORAGE_KEY = 'signalScout:location:v1';
  const RADIO_CONTEXT_KEY = 'freqbeacon:radio-context:v1';
  const SNAPSHOT_KEY = 'freqbeacon:explore-receiver-snapshot:v1';

  const els = {
    shell: document.getElementById('receiverLaunchpad'),
    title: document.getElementById('receiverLaunchTitle'),
    status: document.getElementById('receiverLaunchStatus'),
    network: document.getElementById('launchNetworkState'),
    previous: document.getElementById('launchPrevious'),
    previousName: document.getElementById('launchPreviousName'),
    previousLocation: document.getElementById('launchPreviousLocation'),
    choice: document.getElementById('launchChoice'),
    choiceLabel: document.getElementById('launchChoiceLabel'),
    name: document.getElementById('launchReceiverName'),
    location: document.getElementById('launchReceiverLocation'),
    health: document.getElementById('launchReceiverHealth'),
    primary: document.getElementById('launchPrimary'),
    change: document.getElementById('launchChange'),
    helper: document.getElementById('launchHelper')
  };

  if (!els.shell) return;

  let launchReceiver = null;

  function selectedReceiverId() {
    const match = document.cookie.match(/(?:^|;\s*)fb_explore_receiver=([^;]+)/);
    if (!match) return '';
    try { return decodeURIComponent(match[1]); } catch { return ''; }
  }

  function setSelectionCookie(receiverId) {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `fb_explore_receiver=${encodeURIComponent(receiverId)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  }

  function validCoordinates(value) {
    const lat = Number(value?.lat);
    const lon = Number(value?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat, lon };
  }

  function storedListeningLocation() {
    try {
      const payload = JSON.parse(localStorage.getItem(LOCATION_STORAGE_KEY) || 'null');
      if (payload?.version !== 1) return null;
      return validCoordinates(payload);
    } catch {
      return null;
    }
  }

  async function grantedDeviceLocation() {
    if (!navigator.geolocation || !navigator.permissions?.query) return null;
    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      if (permission?.state !== 'granted') return null;
    } catch {
      return null;
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), 2200);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          clearTimeout(timer);
          finish(validCoordinates(position?.coords));
        },
        () => {
          clearTimeout(timer);
          finish(null);
        },
        { enableHighAccuracy: false, maximumAge: 15 * 60 * 1000, timeout: 2000 }
      );
    });
  }

  function readSnapshot(receiverId) {
    const candidates = [SNAPSHOT_KEY, RADIO_CONTEXT_KEY];
    for (const key of candidates) {
      try {
        const payload = JSON.parse(localStorage.getItem(key) || 'null');
        const receiver = key === RADIO_CONTEXT_KEY ? payload?.receiver : payload;
        if (receiver && (!receiverId || String(receiver.id || '') === receiverId)) return receiver;
      } catch {}
    }
    return null;
  }

  function saveSnapshot(receiver) {
    if (!receiver?.id) return;
    try {
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({
        id: receiver.id,
        name: receiver.name || 'Trusted KiwiSDR',
        location: receiver.location || receiver.country || 'Location not published',
        country: receiver.country || '',
        receiverType: receiver.receiverType || 'KiwiSDR',
        antenna: receiver.antenna || '',
        lat: Number.isFinite(Number(receiver.lat)) ? Number(receiver.lat) : null,
        lon: Number.isFinite(Number(receiver.lon)) ? Number(receiver.lon) : null,
        savedAt: Date.now()
      }));
    } catch {}
  }

  function receiverName(receiver, fallback = 'Trusted KiwiSDR') {
    return String(receiver?.name || receiver?.location || fallback);
  }

  function receiverLocation(receiver, fallback = 'Location not published') {
    return String(receiver?.location || receiver?.country || fallback);
  }

  function setNetworkReady(count) {
    els.network.textContent = Number.isFinite(Number(count)) ? `${Number(count)} TRUSTED` : 'TRUSTED NETWORK';
    els.shell.classList.remove('is-network-error');
  }

  function showChoice(receiver, label) {
    launchReceiver = receiver || null;
    els.choiceLabel.textContent = label;
    if (!receiver) {
      els.name.textContent = 'No suitable trusted receiver is available right now';
      els.location.textContent = 'The trust rules were not relaxed. Try the globe again when healthy receivers are available.';
      els.health.hidden = true;
      els.primary.disabled = true;
      return;
    }
    els.name.textContent = receiverName(receiver);
    els.location.textContent = receiverLocation(receiver);
    els.health.hidden = false;
    els.primary.disabled = false;
    saveSnapshot(receiver);
  }

  function showPrevious(previous, receiverId) {
    const fallback = readSnapshot(receiverId);
    const receiver = previous || fallback || { id: receiverId, name: receiverId, location: 'Previously selected remote receiver' };
    els.previousName.textContent = receiverName(receiver, receiverId || 'Previous receiver');
    els.previousLocation.textContent = receiverLocation(receiver, 'Previously selected remote receiver');
    els.previous.hidden = false;
  }

  function renderReady(payload) {
    const current = payload.current;
    els.title.textContent = 'READY TO LISTEN';
    els.status.textContent = 'Your selected receiver is still healthy and trusted.';
    els.previous.hidden = true;
    showChoice(current, 'YOUR RECEIVER');
    els.primary.textContent = 'CONTINUE LISTENING';
    els.change.hidden = false;
    els.helper.textContent = 'Continue with the same receiver, or change it on the globe below.';
  }

  function renderStart(payload) {
    els.title.textContent = 'START LISTENING';
    els.status.textContent = 'No receiver selected';
    els.previous.hidden = true;
    showChoice(payload.recommended, 'RECOMMENDED');
    els.primary.textContent = payload.recommended ? 'USE RECOMMENDED' : 'NO TRUSTED RECEIVER AVAILABLE';
    els.change.hidden = true;
    els.helper.textContent = payload.recommended
      ? 'or choose one on the globe below · no SDR session starts until you listen'
      : 'Choose from the globe when a receiver returns to the trusted network.';
  }

  function renderUnavailable(payload, receiverId) {
    els.title.textContent = 'LAST RECEIVER UNAVAILABLE';
    els.status.textContent = 'Your previous receiver is no longer in the current trusted network.';
    showPrevious(payload.previous, receiverId);
    showChoice(payload.recommended, 'RECOMMENDED REPLACEMENT');
    els.primary.textContent = payload.recommended ? 'USE RECOMMENDED' : 'NO TRUSTED REPLACEMENT';
    els.change.hidden = true;
    els.helper.textContent = payload.recommended
      ? 'or choose another on the globe below · the replacement is not used until you approve it'
      : 'Nothing was silently substituted. Choose another healthy receiver from the globe when one is available.';
  }

  function renderError(message) {
    launchReceiver = null;
    els.shell.classList.add('is-network-error');
    els.network.textContent = 'NETWORK CHECK UNAVAILABLE';
    els.title.textContent = 'RECEIVER NETWORK UNAVAILABLE';
    els.status.textContent = message || 'FREQBEACON could not confirm the trusted receiver network.';
    els.previous.hidden = true;
    els.choiceLabel.textContent = 'TRUSTED NETWORK';
    els.name.textContent = 'No receiver will be selected automatically';
    els.location.textContent = 'The radio remains unchanged until receiver trust can be confirmed.';
    els.health.hidden = true;
    els.primary.textContent = 'TRY AGAIN';
    els.primary.disabled = false;
    els.change.hidden = true;
    els.helper.textContent = 'Trust is never weakened just to produce a recommendation.';
  }

  async function loadLaunchpad() {
    els.primary.disabled = true;
    els.change.hidden = true;
    els.network.textContent = 'CHECKING NETWORK';

    const previousId = selectedReceiverId();
    const storedLocation = storedListeningLocation();
    const deviceLocation = storedLocation || await grantedDeviceLocation();
    const url = new URL(RECOMMENDATION_FEED, location.origin);
    if (previousId) url.searchParams.set('previousId', previousId);
    if (deviceLocation) {
      url.searchParams.set('lat', String(deviceLocation.lat));
      url.searchParams.set('lon', String(deviceLocation.lon));
    }

    try {
      const response = await fetch(url.toString(), {
        cache: 'no-store',
        headers: { accept: 'application/json' }
      });
      if (!response.ok) throw new Error(`Trusted receiver check returned ${response.status}`);
      const payload = await response.json();
      setNetworkReady(payload.trustedReceiverCount);

      if (payload.state === 'ready' && payload.current) {
        renderReady(payload);
      } else if (payload.state === 'unavailable' && previousId) {
        renderUnavailable(payload, previousId);
      } else {
        renderStart(payload);
      }
    } catch (error) {
      renderError(error?.message || 'Trusted receiver check failed.');
    }
  }

  els.primary.addEventListener('click', () => {
    if (els.shell.classList.contains('is-network-error')) {
      loadLaunchpad();
      return;
    }
    if (!launchReceiver?.id) return;
    setSelectionCookie(launchReceiver.id);
    saveSnapshot(launchReceiver);
    location.assign('/zero?from=explore-home');
  });

  els.change.addEventListener('click', () => {
    const globe = document.getElementById('globeShell');
    if (!globe) return;
    globe.classList.add('is-change-target');
    globe.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    setTimeout(() => globe.classList.remove('is-change-target'), 1500);
  });

  loadLaunchpad();
})();
