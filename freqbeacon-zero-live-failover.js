(() => {
  'use strict';

  const COOKIE = 'fb_explore_receiver';
  const MAX_SWITCHES = 3;
  const FAILURE_RE = /^(?:SND ERROR|SND CLOSED|NO AUDIO FRAMES|RECEIVER BUSY|RECEIVER DOWN|W\/F ERROR|W\/F CLOSED|NO W\/F FRAMES)$/i;
  const state = {
    handling: false,
    switches: 0,
    attempted: new Set()
  };

  const message = document.getElementById('scopeMessage');
  if (!message) return;

  function selectedReceiverId() {
    const match = document.cookie.match(/(?:^|;\s*)fb_explore_receiver=([^;]+)/);
    if (!match) return '';
    try { return decodeURIComponent(match[1]); } catch { return ''; }
  }

  function setSelectedReceiver(id) {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=2592000; SameSite=Lax${secure}`;
  }

  function currentFrequencyKHz() {
    const value = Number(document.getElementById('frequencyValue')?.textContent);
    return Number.isFinite(value) ? value * 1000 : 10000;
  }

  function milesBetween(a, b) {
    const lat1 = Number(a?.lat);
    const lon1 = Number(a?.lon);
    const lat2 = Number(b?.lat);
    const lon2 = Number(b?.lon);
    if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;
    const r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r;
    const dLon = (lon2 - lon1) * r;
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * 3958.8 * Math.asin(Math.sqrt(h));
  }

  function receiverFromFeature(feature) {
    const properties = feature?.properties || {};
    const coordinates = Array.isArray(feature?.geometry?.coordinates) ? feature.geometry.coordinates : [];
    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    return {
      id: String(properties.id || ''),
      name: String(properties.name || properties.location || 'Trusted KiwiSDR'),
      location: String(properties.location || properties.country || ''),
      country: String(properties.country || ''),
      receiverType: String(properties.receiverType || 'KiwiSDR'),
      antenna: String(properties.antenna || ''),
      lat: Number.isFinite(lat) ? lat : null,
      lon: Number.isFinite(lon) ? lon : null,
      trusted: true
    };
  }

  function currentReceiver(feed, id) {
    const feature = (feed?.features || []).find((item) => String(item?.properties?.id || '') === id);
    if (feature) return receiverFromFeature(feature);
    const stored = window.FREQBEACON_RADIO_CONTEXT?.read?.()?.receiver;
    if (stored && String(stored.id || '') === id) return stored;
    return null;
  }

  function fallbackRadiusMiles(frequencyKHz) {
    if (frequencyKHz < 520) return 220;
    if (frequencyKHz < 2000) return 320;
    if (frequencyKHz >= 26000) return 700;
    return 1100;
  }

  function pickAlternate(feed, current, frequencyKHz) {
    if (!current) return null;
    const maxMiles = fallbackRadiusMiles(frequencyKHz);
    const currentCountry = String(current.country || '').trim().toLowerCase();
    const candidates = (feed?.features || [])
      .map(receiverFromFeature)
      .filter((receiver) => receiver.id && !state.attempted.has(receiver.id))
      .map((receiver) => ({
        receiver,
        distance: milesBetween(current, receiver),
        sameCountry: Boolean(currentCountry && receiver.country.trim().toLowerCase() === currentCountry)
      }))
      .filter((item) => Number.isFinite(item.distance) && item.distance <= maxMiles)
      .sort((a, b) =>
        Number(b.sameCountry) - Number(a.sameCountry)
        || a.distance - b.distance
        || a.receiver.name.localeCompare(b.receiver.name)
      );
    return candidates[0] || null;
  }

  function updateReceiverUi(receiver, previousName, distance) {
    const nameEl = document.getElementById('zeroReceiverContextName');
    const placeEl = document.getElementById('zeroReceiverContextPlace');
    const identityEl = document.getElementById('receiverIdentity');
    const panel = document.getElementById('zeroReceiverContext');
    const distanceText = Number.isFinite(distance) ? ` · ${Math.round(distance).toLocaleString()} mi away` : '';

    if (panel) {
      panel.hidden = false;
      panel.classList.remove('is-loading', 'is-error');
      panel.setAttribute('aria-label', `Remote receiver ${receiver.name}, ${receiver.location}`);
    }
    if (nameEl) nameEl.textContent = receiver.name;
    if (placeEl) placeEl.textContent = `${receiver.location}${distanceText}`;
    if (identityEl) identityEl.textContent = `${receiver.name} · ${receiver.location}`.toUpperCase();

    window.FREQBEACON_RADIO_CONTEXT?.update?.({
      receiver,
      receiverConfirmedAt: Date.now(),
      receiverFallback: {
        from: previousName,
        at: Date.now()
      }
    });
  }

  function showReady(previousName, alternate, distance) {
    const frequency = currentFrequencyKHz();
    const frequencyText = frequency >= 1000
      ? `${(frequency / 1000).toFixed(3)} MHz`
      : `${frequency.toFixed(0)} kHz`;
    const distanceText = Number.isFinite(distance) ? ` (${Math.round(distance).toLocaleString()} mi away)` : '';
    message.classList.remove('error');
    message.innerHTML = `<strong>NEARBY RECEIVER READY</strong><span>${escapeHtml(previousName)} became unavailable. Switched to ${escapeHtml(alternate.name)}${escapeHtml(distanceText)}. Press START to retry ${escapeHtml(frequencyText)}.</span>`;
  }

  function showNoFallback(previousName) {
    message.classList.add('error');
    message.innerHTML = `<strong>RECEIVER UNAVAILABLE</strong><span>${escapeHtml(previousName)} stopped accepting a live receiver session, and no nearby trusted alternate is available. Choose another receiver in Explore.</span>`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  async function handleFailure() {
    if (state.handling || state.switches >= MAX_SWITCHES) return;
    const title = message.querySelector('strong')?.textContent?.trim() || '';
    const detail = message.querySelector('span')?.textContent?.trim() || '';
    if (!FAILURE_RE.test(title) && !(title === 'START FAILED' && /SND|W\/F|receiver|socket|audio|waterfall/i.test(detail))) return;

    const currentId = selectedReceiverId();
    if (!currentId) return;
    state.handling = true;
    state.attempted.add(currentId);

    try {
      const response = await fetch('/api/explore/receivers', {
        cache: 'no-store',
        headers: { accept: 'application/geo+json,application/json' }
      });
      if (!response.ok) throw new Error(`trusted receiver feed ${response.status}`);
      const feed = await response.json();
      const current = currentReceiver(feed, currentId);
      const previousName = current?.name
        || window.FREQBEACON_RADIO_CONTEXT?.read?.()?.receiver?.name
        || document.getElementById('zeroReceiverContextName')?.textContent?.trim()
        || 'Selected receiver';
      const next = pickAlternate(feed, current, currentFrequencyKHz());

      if (!next) {
        showNoFallback(previousName);
        return;
      }

      state.attempted.add(next.receiver.id);
      state.switches += 1;
      setSelectedReceiver(next.receiver.id);
      updateReceiverUi(next.receiver, previousName, next.distance);
      window.setTimeout(() => showReady(previousName, next.receiver, next.distance), 120);
    } catch {
      const previousName = window.FREQBEACON_RADIO_CONTEXT?.read?.()?.receiver?.name
        || document.getElementById('zeroReceiverContextName')?.textContent?.trim()
        || 'Selected receiver';
      showNoFallback(previousName);
    } finally {
      state.handling = false;
    }
  }

  const initial = selectedReceiverId();
  if (initial) state.attempted.add(initial);

  const observer = new MutationObserver(() => {
    window.setTimeout(handleFailure, 0);
  });
  observer.observe(message, { childList: true, characterData: true, subtree: true });
})();
