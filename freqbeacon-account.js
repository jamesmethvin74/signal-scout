(() => {
  const preview = window.__FREQBEACON_ACCOUNT_PREVIEW__ === true;
  const apiSuffix = preview ? '?preview=1' : '';
  const state = { account: null };

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#039;');

  function favorites() { return state.account?.favorites || []; }
  function favoriteMatch(payload) {
    return favorites().find((item) => item.kind === payload.kind && item.favoriteKey === payload.favoriteKey) || null;
  }

  function modeFromPage() {
    return document.querySelector('.mode-bar button.active')?.dataset.shellMode
      || document.getElementById('lookupModeChip')?.textContent?.trim().toLowerCase()
      || 'am';
  }

  function radioFavorite() {
    const frequency = Number(String(document.getElementById('frequencyDisplay')?.textContent || '').replace(/,/g,''));
    if (!Number.isFinite(frequency)) return null;
    const mode = modeFromPage();
    const receiver = document.getElementById('receiverIdentity')?.textContent?.trim() || '';
    return {
      kind:'frequency',
      favoriteKey:`${frequency.toFixed(3)}|${mode}`,
      label:`${frequency.toLocaleString(undefined,{maximumFractionDigits:3})} kHz · ${mode.toUpperCase()}`,
      metadata:{ frequency, mode, receiver }
    };
  }

  function lookupCurrentFavorite() {
    const frequency = Number(String(document.getElementById('lookupFrequency')?.value || '').replace(/,/g,''));
    if (!Number.isFinite(frequency)) return null;
    const mode = modeFromPage();
    return {
      kind:'frequency',
      favoriteKey:`${frequency.toFixed(3)}|${mode}`,
      label:`${frequency.toLocaleString(undefined,{maximumFractionDigits:3})} kHz · ${mode.toUpperCase()}`,
      metadata:{ frequency, mode }
    };
  }

  function receiverFavorite() {
    const name = document.getElementById('selectedName')?.textContent?.trim() || '';
    const location = document.getElementById('selectedLocation')?.textContent?.trim() || '';
    if (!name || /choose a trusted receiver/i.test(name)) return null;
    return {
      kind:'receiver',
      favoriteKey:`${name}|${location}`.slice(0,180),
      label: location ? `${name} · ${location}` : name,
      metadata:{ name, location }
    };
  }

  function resultFavorite(card) {
    const raw = card.querySelector('.lookup-result-frequency')?.textContent
      || card.querySelector('.lookup-card-meta span')?.textContent || '';
    const frequency = Number(String(raw).replace(/,/g,'').match(/[0-9]+(?:\.[0-9]+)?/)?.[0]);
    if (!Number.isFinite(frequency)) return null;
    const title = card.querySelector('h3,.lookup-card-title,strong')?.textContent?.trim() || 'Saved frequency';
    const modeText = [...card.querySelectorAll('.lookup-card-meta span')].map(el => el.textContent.trim())
      .find(text => /^(AM|SAM|USB|LSB|CW|NBFM)$/i.test(text));
    const mode = (modeText || modeFromPage()).toLowerCase();
    return {
      kind:'frequency',
      favoriteKey:`${frequency.toFixed(3)}|${mode}`,
      label:`${frequency.toLocaleString(undefined,{maximumFractionDigits:3})} kHz · ${title}`,
      metadata:{ frequency, mode, station:title }
    };
  }

  async function loadAccount() {
    const response = await fetch('/api/account' + apiSuffix, { credentials:'same-origin', cache:'no-store' });
    if (!response.ok) return null;
    state.account = await response.json();
    renderAccount();
    installContextFavorites();
    return state.account;
  }

  async function toggleFavorite(payload) {
    if (!payload) return;
    const existing = favoriteMatch(payload);
    if (existing) {
      const join = apiSuffix ? '&' : '?';
      const response = await fetch('/api/account/favorites' + apiSuffix + join + 'id=' + encodeURIComponent(existing.id), {
        method:'DELETE', credentials:'same-origin'
      });
      if (!response.ok) return;
    } else {
      const response = await fetch('/api/account/favorites' + apiSuffix, {
        method:'POST',
        headers:{'content-type':'application/json'},
        credentials:'same-origin',
        body:JSON.stringify(payload)
      });
      if (!response.ok) return;
    }
    await loadAccount();
  }

  function updateFavoriteButton(button, payload) {
    if (!button) return;
    const saved = payload && favoriteMatch(payload);
    button.disabled = !payload;
    button.classList.toggle('is-saved', Boolean(saved));
    button.setAttribute('aria-pressed', saved ? 'true' : 'false');
    const compact = button.dataset.fbCompact === '1';
    button.textContent = saved ? (compact ? '★' : '★ SAVED') : (compact ? '☆' : '☆ FAVORITE');
    button.title = payload ? (saved ? 'Remove from favorites' : 'Add to favorites') : 'Nothing selected yet';
  }

  function ensureButton(parent, key, payloadFn, compact = false) {
    if (!parent) return null;
    let button = parent.querySelector(`[data-fb-context-favorite="${key}"]`);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'fb-context-favorite';
      button.dataset.fbContextFavorite = key;
      if (compact) button.dataset.fbCompact = '1';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleFavorite(payloadFn()).catch(() => {});
      });
      parent.appendChild(button);
    }
    updateFavoriteButton(button, payloadFn());
    return button;
  }

  function installRadioFavorite() {
    const readout = document.querySelector('.zero-readout');
    if (!readout) return;
    ensureButton(readout, 'radio', radioFavorite);
    const refresh = () => updateFavoriteButton(readout.querySelector('[data-fb-context-favorite="radio"]'), radioFavorite());
    const frequency = document.getElementById('frequencyDisplay');
    const modes = document.querySelector('.mode-bar');
    if (frequency && !frequency.dataset.fbFavObserved) {
      frequency.dataset.fbFavObserved = '1';
      new MutationObserver(refresh).observe(frequency, { childList:true, characterData:true, subtree:true });
    }
    if (modes && !modes.dataset.fbFavObserved) {
      modes.dataset.fbFavObserved = '1';
      new MutationObserver(refresh).observe(modes, { attributes:true, subtree:true, attributeFilter:['class','aria-pressed'] });
    }
  }

  function installLookupFavorite() {
    const actions = document.querySelector('.lookup-radio-actions');
    if (actions) ensureButton(actions, 'lookup-current', lookupCurrentFavorite);
    const refresh = () => updateFavoriteButton(actions?.querySelector('[data-fb-context-favorite="lookup-current"]'), lookupCurrentFavorite());
    const input = document.getElementById('lookupFrequency');
    const chip = document.getElementById('lookupModeChip');
    if (input && !input.dataset.fbFavObserved) {
      input.dataset.fbFavObserved = '1';
      new MutationObserver(refresh).observe(input, { attributes:true, attributeFilter:['value'] });
      window.setInterval(refresh, 800);
    }
    if (chip && !chip.dataset.fbFavObserved) {
      chip.dataset.fbFavObserved = '1';
      new MutationObserver(refresh).observe(chip, { childList:true, characterData:true, subtree:true });
    }

    const stage = document.getElementById('lookupResults');
    if (!stage) return;
    const decorateResults = () => {
      stage.querySelectorAll('.lookup-result-card').forEach((card, index) => {
        const actionsBox = card.querySelector('.lookup-card-actions') || card;
        ensureButton(actionsBox, `lookup-result-${index}`, () => resultFavorite(card), true);
      });
    };
    decorateResults();
    if (!stage.dataset.fbFavObserved) {
      stage.dataset.fbFavObserved = '1';
      new MutationObserver(decorateResults).observe(stage, { childList:true, subtree:true });
    }
  }

  function installExploreFavorite() {
    const listen = document.getElementById('listenButton');
    if (!listen?.parentNode) return;
    let holder = document.getElementById('fbExploreFavoriteHolder');
    if (!holder) {
      holder = document.createElement('div');
      holder.id = 'fbExploreFavoriteHolder';
      holder.className = 'fb-explore-favorite-holder';
      listen.insertAdjacentElement('afterend', holder);
    }
    ensureButton(holder, 'receiver', receiverFavorite);
    const refresh = () => updateFavoriteButton(holder.querySelector('[data-fb-context-favorite="receiver"]'), receiverFavorite());
    const selected = document.getElementById('selectedReceiver');
    if (selected && !selected.dataset.fbFavObserved) {
      selected.dataset.fbFavObserved = '1';
      new MutationObserver(refresh).observe(selected, { childList:true, characterData:true, subtree:true });
    }
  }

  function installContextFavorites() {
    installRadioFavorite();
    installLookupFavorite();
    installExploreFavorite();
  }

  function favoriteHref(item) {
    if (item.kind === 'frequency' && Number.isFinite(Number(item.metadata?.frequency))) {
      const frequency = Number(item.metadata.frequency);
      const mode = encodeURIComponent(item.metadata?.mode || 'am');
      return `/zero?frequency=${encodeURIComponent(frequency)}&mode=${mode}`;
    }
    if (item.kind === 'receiver') return '/explore';
    return '#';
  }

  function renderAccount() {
    const account = state.account;
    if (!account?.authenticated) return;
    const email = account.user?.email || 'Signed in';
    let bar = document.getElementById('freqbeaconAccountBar');
    if (!bar) {
      bar = document.createElement('section');
      bar.id = 'freqbeaconAccountBar';
      bar.className = 'fb-account';
      const header = document.querySelector('.explore-header,.lookup-header,.zero-header,.topbar,header');
      if (header?.parentNode) header.parentNode.insertBefore(bar, header.nextSibling);
      else document.body.prepend(bar);
    }

    const items = favorites();
    bar.innerHTML = `
      <div class="fb-account-row">
        <div><span class="fb-account-kicker">${preview ? 'ACCOUNT PREVIEW' : 'SIGNED IN'}</span><strong>${escapeHtml(email)}</strong></div>
        <span class="fb-account-count">${items.length} FAVORITE${items.length === 1 ? '' : 'S'}</span>
      </div>
      <div class="fb-account-message">${items.length ? 'Your saved stations, frequencies and receivers.' : 'Star something while you are listening or browsing to save it here.'}</div>
      <div class="fb-account-favorites">${items.slice(0,8).map(item => `
        <a class="fb-account-favorite" href="${escapeHtml(favoriteHref(item))}">
          <span>★</span><b>${escapeHtml(item.label)}</b><i data-fb-remove="${item.id}" aria-label="Remove favorite">×</i>
        </a>`).join('')}</div>`;

    bar.querySelectorAll('[data-fb-remove]').forEach((el) => el.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const join = apiSuffix ? '&' : '?';
      fetch('/api/account/favorites' + apiSuffix + join + 'id=' + encodeURIComponent(el.dataset.fbRemove), {
        method:'DELETE', credentials:'same-origin'
      }).then(() => loadAccount()).catch(() => {});
    }));
  }

  loadAccount().catch(() => {});
})();