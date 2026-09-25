(() => {
  const preview = window.__FREQBEACON_ACCOUNT_PREVIEW__ === true;
  const apiSuffix = preview ? '?preview=1' : '';
  const favoriteSuffix = preview ? '?preview=1' : '';
  const state = { account: null };

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#039;');

  function currentTune() {
    const raw = document.querySelector('[data-fb2-frequency]')?.textContent
      || document.querySelector('[data-sdr-frequency]')?.textContent || '';
    const frequency = Number(String(raw).replace(/,/g,'').match(/[0-9]+(?:\.[0-9]+)?/)?.[0]);
    if (!Number.isFinite(frequency)) return null;
    const station = document.querySelector('[data-fb2-station]')?.textContent?.trim()
      || document.querySelector('[data-sdr-station]')?.textContent?.trim()
      || 'Saved frequency';
    const mode = document.querySelector('.fb2-mode.is-active')?.dataset.fb2Mode
      || document.querySelector('[data-sdr-mode]')?.value || 'am';
    return { kind:'frequency', favoriteKey:`${frequency.toFixed(1)}|${mode}`, label:`${frequency.toLocaleString()} kHz · ${station}`, metadata:{ frequency, mode, station } };
  }

  async function loadAccount() {
    const response = await fetch('/api/account' + apiSuffix, { credentials:'same-origin', cache:'no-store' });
    if (!response.ok) return null;
    state.account = await response.json();
    render();
    return state.account;
  }

  async function saveCurrent() {
    const favorite = currentTune();
    if (!favorite) return setMessage('Tune to a frequency first.');
    const url = '/api/account/favorites' + favoriteSuffix;
    const response = await fetch(url, {
      method:'POST',
      headers:{'content-type':'application/json'},
      credentials:'same-origin',
      body:JSON.stringify(favorite)
    });
    if (!response.ok) return setMessage('Could not save that favorite.');
    setMessage('Saved to your favorites.');
    await loadAccount();
  }

  async function removeFavorite(id) {
    const join = favoriteSuffix ? '&' : '?';
    await fetch('/api/account/favorites' + favoriteSuffix + join + 'id=' + encodeURIComponent(id), {
      method:'DELETE', credentials:'same-origin'
    });
    await loadAccount();
  }

  function setMessage(text) {
    const el = document.querySelector('[data-fb-account-message]');
    if (el) el.textContent = text;
  }

  function render() {
    const account = state.account;
    if (!account?.authenticated) return;
    const email = account.user?.email || 'Signed in';
    let bar = document.getElementById('freqbeaconAccountBar');
    if (!bar) {
      bar = document.createElement('section');
      bar.id = 'freqbeaconAccountBar';
      bar.className = 'fb-account';
      const header = document.querySelector('.explore-header,.topbar,header');
      if (header?.parentNode) header.parentNode.insertBefore(bar, header.nextSibling);
      else document.body.prepend(bar);
    }

    const favorites = account.favorites || [];
    bar.innerHTML = `
      <div class="fb-account-row">
        <div><span class="fb-account-kicker">${preview ? 'ACCOUNT PREVIEW' : 'SIGNED IN'}</span><strong>${escapeHtml(email)}</strong></div>
        <button type="button" class="fb-account-save" data-fb-save>☆ Favorite this frequency</button>
      </div>
      <div class="fb-account-message" data-fb-account-message>${favorites.length ? `${favorites.length} saved favorite${favorites.length === 1 ? '' : 's'}` : 'Your favorites will follow you across devices.'}</div>
      <div class="fb-account-favorites">${favorites.slice(0,8).map(f => `
        <button type="button" class="fb-account-favorite" data-fb-favorite-id="${f.id}" data-frequency="${escapeHtml(f.metadata?.frequency ?? '')}" data-mode="${escapeHtml(f.metadata?.mode ?? 'am')}">
          <span>★</span><b>${escapeHtml(f.label)}</b><i data-fb-remove="${f.id}" aria-label="Remove favorite">×</i>
        </button>`).join('')}</div>`;

    bar.querySelector('[data-fb-save]')?.addEventListener('click', saveCurrent);
    bar.querySelectorAll('[data-fb-remove]').forEach((el) => el.addEventListener('click', (event) => {
      event.stopPropagation();
      removeFavorite(Number(el.dataset.fbRemove));
    }));
    bar.querySelectorAll('[data-fb-favorite-id]').forEach((button) => button.addEventListener('click', () => {
      const frequency = Number(button.dataset.frequency);
      if (!Number.isFinite(frequency)) return;
      const input = document.getElementById('lookupFrequency');
      const mode = document.getElementById('lookupMode');
      const submit = document.getElementById('lookupSubmit');
      if (input && submit) {
        input.value = String(frequency);
        if (mode) mode.value = button.dataset.mode || 'am';
        document.getElementById('lookupView')?.removeAttribute('hidden');
        submit.click();
        document.getElementById('lookupView')?.scrollIntoView({ behavior:'smooth', block:'start' });
      }
    }));
  }

  loadAccount().catch(() => {});
})();