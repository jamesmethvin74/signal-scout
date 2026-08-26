(() => {
  const enhanced = new WeakMap();
  let active = null;
  let overlay;
  let sheetTitle;
  let optionsHost;
  let closeButton;
  let previousBodyOverflow = '';

  function selectedText(select) {
    const option = select.selectedOptions?.[0] || select.options?.[select.selectedIndex];
    return option?.textContent?.trim() || 'Choose';
  }

  function pickerTitle(select) {
    const labelledBy = select.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean)
        .join(' ');
      if (text) return text;
    }

    const explicitLabel = select.id
      ? document.querySelector(`label[for="${CSS.escape(select.id)}"]`)?.textContent?.trim()
      : '';

    return explicitLabel
      || select.getAttribute('aria-label')
      || select.name
      || 'Choose an option';
  }

  function ensureOverlay() {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.className = 'ss-picker-overlay';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="ss-picker-sheet" role="dialog" aria-modal="true" aria-labelledby="ssPickerTitle">
        <div class="ss-picker-handle" aria-hidden="true"></div>
        <div class="ss-picker-header">
          <h2 class="ss-picker-title" id="ssPickerTitle">Choose an option</h2>
          <button class="ss-picker-close" type="button" aria-label="Close picker">×</button>
        </div>
        <div class="ss-picker-options" role="listbox"></div>
      </div>
    `;

    document.body.appendChild(overlay);
    sheetTitle = overlay.querySelector('.ss-picker-title');
    optionsHost = overlay.querySelector('.ss-picker-options');
    closeButton = overlay.querySelector('.ss-picker-close');

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) closePicker();
    });
    closeButton.addEventListener('click', closePicker);
  }

  function syncSelect(select) {
    const state = enhanced.get(select);
    if (!state) return;

    state.value.textContent = selectedText(select);
    state.trigger.disabled = !!select.disabled;
    state.shell.hidden = !!select.hidden;
  }

  function renderOptions(select) {
    optionsHost.replaceChildren();
    optionsHost.setAttribute('aria-label', pickerTitle(select));

    [...select.options].forEach((option) => {
      if (option.hidden) return;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ss-picker-option';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', option.selected ? 'true' : 'false');
      button.disabled = option.disabled;

      const label = document.createElement('span');
      label.className = 'ss-picker-option-label';
      label.textContent = option.textContent?.trim() || option.value;

      const radio = document.createElement('span');
      radio.className = 'ss-picker-radio';
      radio.setAttribute('aria-hidden', 'true');

      button.append(label, radio);
      button.addEventListener('click', () => {
        if (button.disabled) return;
        select.value = option.value;
        [...select.options].forEach((item) => {
          item.selected = item === option;
        });
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        syncSelect(select);
        closePicker();
      });

      optionsHost.appendChild(button);
    });
  }

  function openPicker(select) {
    const state = enhanced.get(select);
    if (!state || select.disabled || select.hidden) return;

    ensureOverlay();
    syncSelect(select);
    active = { select, trigger: state.trigger };
    sheetTitle.textContent = pickerTitle(select);
    renderOptions(select);

    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    overlay.hidden = false;
    state.trigger.setAttribute('aria-expanded', 'true');

    requestAnimationFrame(() => {
      overlay.classList.add('is-open');
      closeButton.focus({ preventScroll: true });
    });
  }

  function closePicker() {
    if (!overlay || overlay.hidden) return;

    const trigger = active?.trigger;
    overlay.classList.remove('is-open');
    document.body.style.overflow = previousBodyOverflow;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');

    window.setTimeout(() => {
      overlay.hidden = true;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      active = null;
    }, 180);
  }

  function enhanceSelect(select) {
    if (!(select instanceof HTMLSelectElement)) return;
    if (select.multiple || select.dataset.nativePicker === 'true' || enhanced.has(select)) return;

    const shell = document.createElement('div');
    shell.className = 'ss-picker-field';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'ss-picker-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-label', select.getAttribute('aria-label') || pickerTitle(select));

    const value = document.createElement('span');
    value.className = 'ss-picker-trigger-value';

    const chevron = document.createElement('span');
    chevron.className = 'ss-picker-trigger-chevron';
    chevron.setAttribute('aria-hidden', 'true');

    trigger.append(value, chevron);
    shell.appendChild(trigger);
    select.insertAdjacentElement('afterend', shell);

    select.classList.add('ss-native-select');
    select.tabIndex = -1;
    select.setAttribute('aria-hidden', 'true');

    enhanced.set(select, { shell, trigger, value });
    syncSelect(select);

    trigger.addEventListener('click', () => openPicker(select));
    select.addEventListener('change', () => syncSelect(select));
    select.addEventListener('input', () => syncSelect(select));
  }

  function enhanceWithin(root) {
    if (root instanceof HTMLSelectElement) enhanceSelect(root);
    root.querySelectorAll?.('select').forEach(enhanceSelect);
  }

  enhanceWithin(document);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'childList') {
        record.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) enhanceWithin(node);
        });
      }

      const select = record.target instanceof HTMLSelectElement
        ? record.target
        : record.target.closest?.('select');
      if (select) syncSelect(select);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'disabled', 'selected']
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePicker();
  });
})();
