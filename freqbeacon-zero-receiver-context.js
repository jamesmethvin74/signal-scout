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
  if (!receiverId) return;

  panel.hidden = false;
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
      const name = String(properties.name || 'Trusted KiwiSDR');
      const place = String(properties.location || properties.country || receiverId);
      panel.classList.remove('is-loading', 'is-error');
      nameEl.textContent = name;
      placeEl.textContent = place;
      panel.setAttribute('aria-label', `Remote receiver ${name}, ${place}`);
      if (identityEl) identityEl.textContent = `${name} · ${place}`.toUpperCase();
    })
    .catch(() => {
      panel.classList.remove('is-loading');
      panel.classList.add('is-error');
      nameEl.textContent = 'REMOTE RECEIVER NEEDS RESELECTION';
      placeEl.textContent = 'Open Explore and choose a currently trusted receiver.';
      panel.setAttribute('aria-label', 'Selected remote receiver is no longer trusted');
    });
})();
