(() => {
  'use strict';

  const panel = document.getElementById('zeroReceiverContext');
  const nameEl = document.getElementById('zeroReceiverContextName');
  const placeEl = document.getElementById('zeroReceiverContextPlace');
  const identityEl = document.getElementById('receiverIdentity');
  if (!panel || !nameEl || !placeEl) return;

  function selectedReceiverId() {
    const match = document.cookie.match(/(?:^|;\s*)fb_explore_receiver=([^;]+)/);
    if (!match) return '';
    try { return decodeURIComponent(match[1]); } catch { return ''; }
  }

  const receiverId = selectedReceiverId();
  // Always expose CHANGE, even when this origin has no receiver cookie.
  // Production and Worker previews do not share their browser cookies.
  panel.hidden = false;
  if (!receiverId) {
    panel.classList.add('is-loading');
    nameEl.textContent = 'No receiver selected';
    placeEl.textContent = 'Tap CHANGE to select a receiver in Explore.';
    const statusLabel = panel.querySelector('.zero-receiver-context-status span');
    if (statusLabel) statusLabel.textContent = 'NOT SET';
    window.FREQBEACON_RADIO_CONTEXT?.clearReceiver?.();
    return;
  }

  panel.classList.add('is-loading');
  nameEl.textContent = 'Confirming selected receiver…';
  placeEl.textContent = receiverId;

  fetch('/api/explore/receivers', {
    cache: 'no-store',
    headers: { accept: 'application/geo+json,application/json' }
  })
    .then((response) => {
      if (!response.ok) throw new Error(`receiver feed ${response.status}`);
      return response.json();
    })
    .then((payload) => {
      const feature = (payload?.features || []).find((item) => String(item?.properties?.id || '') === receiverId);
      if (!feature) throw new Error('selected receiver is no longer trusted');

      const properties = feature.properties || {};
      const coordinates = Array.isArray(feature.geometry?.coordinates) ? feature.geometry.coordinates : [];
      const lon = Number(coordinates[0]);
      const lat = Number(coordinates[1]);
      const name = String(properties.name || 'Trusted KiwiSDR');
      const place = String(properties.location || properties.country || receiverId);
      panel.classList.remove('is-loading', 'is-error');
      nameEl.textContent = name;
      placeEl.textContent = place;
      panel.setAttribute('aria-label', `Remote receiver ${name}, ${place}`);
      if (identityEl) identityEl.textContent = `${name} · ${place}`.toUpperCase();

      window.FREQBEACON_RADIO_CONTEXT?.update?.({
        receiver: {
          id: receiverId,
          name,
          location: place,
          country: String(properties.country || ''),
          receiverType: String(properties.receiverType || 'KiwiSDR'),
          antenna: String(properties.antenna || ''),
          lat: Number.isFinite(lat) ? lat : null,
          lon: Number.isFinite(lon) ? lon : null,
          trusted: true
        },
        receiverConfirmedAt: Date.now()
      });
    })
    .catch(() => {
      window.FREQBEACON_RADIO_CONTEXT?.clearReceiver?.();
      panel.classList.remove('is-loading');
      panel.classList.add('is-error');
      nameEl.textContent = 'REMOTE RECEIVER NEEDS RESELECTION';
      placeEl.textContent = 'Open Explore and choose a currently trusted receiver.';
      panel.setAttribute('aria-label', 'Selected remote receiver is no longer trusted');
    });
})();