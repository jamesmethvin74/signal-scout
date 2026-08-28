(() => {
  const OLD_NAME = 'Signal Scout';
  const NEW_NAME = 'FreqBeacon';
  const DISPLAY_NAME = 'FREQBEACON';
  const TAGLINE = 'Explore the airwaves.';
  const SPLASH_HOLD_MS = 3000;
  const SPLASH_FADE_MS = 450;

  function replaceString(value) {
    return typeof value === 'string' && value.includes(OLD_NAME)
      ? value.replaceAll(OLD_NAME, NEW_NAME)
      : value;
  }

  function installApprovedSplash() {
    const splash = document.querySelector('.freqbeacon-splash');
    if (!splash) return;

    splash.replaceChildren();
    const art = document.createElement('img');
    art.className = 'freqbeacon-splash__art';
    art.src = 'freqbeacon-startup.webp';
    art.alt = '';
    art.setAttribute('aria-hidden', 'true');
    splash.appendChild(art);

    let removed = false;
    const removeSplash = () => {
      if (removed) return;
      removed = true;
      splash.remove();
    };

    window.setTimeout(() => {
      splash.classList.add('is-leaving');
      window.setTimeout(removeSplash, SPLASH_FADE_MS + 75);
    }, SPLASH_HOLD_MS);
  }

  function brandNode(root) {
    if (!root) return;

    if (root.nodeType === Node.TEXT_NODE) {
      const next = replaceString(root.nodeValue);
      if (next !== root.nodeValue) root.nodeValue = next;
      return;
    }

    if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;

    if (root.nodeType === Node.ELEMENT_NODE) {
      for (const attr of ['aria-label', 'title', 'placeholder']) {
        if (!root.hasAttribute?.(attr)) continue;
        const current = root.getAttribute(attr);
        const next = replaceString(current);
        if (next !== current) root.setAttribute(attr, next);
      }
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const next = replaceString(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
    }

    root.querySelectorAll?.('[aria-label],[title],[placeholder]').forEach((el) => {
      for (const attr of ['aria-label', 'title', 'placeholder']) {
        if (!el.hasAttribute(attr)) continue;
        const current = el.getAttribute(attr);
        const next = replaceString(current);
        if (next !== current) el.setAttribute(attr, next);
      }
    });
  }

  function applyPrimaryBrand() {
    document.title = `${DISPLAY_NAME} — ${TAGLINE}`;

    const description = document.querySelector('meta[name="description"]');
    if (description) {
      description.content = 'FreqBeacon helps radio listeners discover shortwave, medium-wave, longwave, and amateur radio signals, then explore them with live remote SDR spectrum and audio.';
    }

    const title = document.querySelector('.brand h1');
    if (title) title.textContent = DISPLAY_NAME;

    const tagline = document.querySelector('.brand p');
    if (tagline) tagline.textContent = TAGLINE;

    const mark = document.querySelector('.signal-logo');
    if (mark) {
      mark.setAttribute('role', 'img');
      mark.setAttribute('aria-label', 'FreqBeacon Beacon Tower logo');
      mark.removeAttribute('aria-hidden');
    }

    brandNode(document.body);
  }

  installApprovedSplash();
  applyPrimaryBrand();

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) brandNode(node);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
