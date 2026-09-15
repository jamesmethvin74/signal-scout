(() => {
  'use strict';

  const readout = document.querySelector('.zero-frequency');
  const display = document.querySelector('#frequencyDisplay');
  const displayUnit = document.querySelector('#frequencyUnit');
  const bridge = document.querySelector('#frequencyValue');
  const centerMark = document.querySelector('#centerMark');
  const power = document.querySelector('#power');

  if (!readout || !display) return;

  // Hidden adapter into Zero's existing qualified band-target path. This button is
  // created before freqbeacon-zero-controls.js runs, so that script attaches its
  // normal tuning handler to it along with the visible band buttons. Manual entry
  // never sends Kiwi commands itself.
  const tuneBridge = document.createElement('button');
  tuneBridge.type = 'button';
  tuneBridge.id = 'manualFrequencyBridge';
  tuneBridge.dataset.bandKhz = '560';
  tuneBridge.dataset.bandMode = 'am';
  tuneBridge.hidden = true;
  tuneBridge.tabIndex = -1;
  tuneBridge.setAttribute('aria-hidden', 'true');
  document.body.appendChild(tuneBridge);

  readout.classList.add('zero-frequency-entry-trigger');
  readout.setAttribute('role', 'button');
  readout.setAttribute('tabindex', '0');
  readout.setAttribute('aria-haspopup', 'dialog');
  readout.setAttribute('aria-controls', 'frequencyEntryDialog');
  readout.setAttribute('aria-label', 'Enter a frequency manually');

  const dialog = document.createElement('dialog');
  dialog.id = 'frequencyEntryDialog';
  dialog.className = 'frequency-entry-dialog';
  dialog.innerHTML = `
    <form method="dialog" class="frequency-entry-sheet" id="frequencyEntryForm">
      <div class="frequency-entry-kicker">DIRECT TUNING</div>
      <h2>ENTER FREQUENCY</h2>
      <p>Nothing changes until you press <strong>TUNE</strong>.</p>

      <div class="frequency-entry-unit-switch" role="group" aria-label="Frequency entry units">
        <button type="button" data-entry-unit="khz" aria-pressed="true">kHz</button>
        <button type="button" data-entry-unit="mhz" aria-pressed="false">MHz</button>
      </div>

      <label class="frequency-entry-field" for="frequencyEntryInput">
        <span>FREQUENCY</span>
        <div>
          <input id="frequencyEntryInput" name="frequency" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" aria-describedby="frequencyEntryHelp frequencyEntryError">
          <b id="frequencyEntryUnit">kHz</b>
        </div>
      </label>
      <small id="frequencyEntryHelp" class="frequency-entry-help">30–30,000 kHz · examples: 560, 9955, 14200.5</small>
      <small id="frequencyEntryError" class="frequency-entry-error" role="alert" hidden></small>

      <div class="frequency-entry-actions">
        <button type="button" class="frequency-entry-cancel" id="frequencyEntryCancel">CANCEL</button>
        <button type="submit" class="frequency-entry-tune">TUNE</button>
      </div>
    </form>`;
  document.body.appendChild(dialog);

  const form = dialog.querySelector('#frequencyEntryForm');
  const input = dialog.querySelector('#frequencyEntryInput');
  const error = dialog.querySelector('#frequencyEntryError');
  const cancel = dialog.querySelector('#frequencyEntryCancel');
  const unitLabel = dialog.querySelector('#frequencyEntryUnit');
  const help = dialog.querySelector('#frequencyEntryHelp');
  const unitButtons = [...dialog.querySelectorAll('[data-entry-unit]')];
  let entryUnit = 'khz';

  function currentKHz() {
    const mhz = Number(bridge?.textContent);
    if (Number.isFinite(mhz) && mhz > 0) return mhz * 1000;

    const raw = String(display.textContent || '').replace(/,/g, '').trim();
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return 560;
    return String(displayUnit?.textContent || '').toLowerCase().includes('mhz') ? value * 1000 : value;
  }

  function activeMode() {
    const button = document.querySelector('[data-shell-mode].active, [data-shell-mode][aria-pressed="true"]');
    return String(button?.dataset?.shellMode || 'am').toLowerCase();
  }

  function formatForUnit(kHz, unit = entryUnit) {
    const value = unit === 'mhz' ? Number(kHz) / 1000 : Number(kHz);
    const maxDigits = unit === 'mhz' ? 6 : 3;
    return value.toLocaleString('en-US', {
      useGrouping: false,
      minimumFractionDigits: 0,
      maximumFractionDigits: maxDigits
    });
  }

  function rawEntryValue(unit = entryUnit) {
    const raw = String(input.value || '').trim().replace(/,/g, '');
    const maxDigits = unit === 'mhz' ? 6 : 3;
    const pattern = new RegExp(`^\\d+(?:\\.\\d{0,${maxDigits}})?$`);
    if (!pattern.test(raw)) return NaN;
    const value = Number(raw);
    return Number.isFinite(value) ? value : NaN;
  }

  function parseInputKHz() {
    const value = rawEntryValue(entryUnit);
    if (!Number.isFinite(value)) return NaN;
    return entryUnit === 'mhz' ? value * 1000 : value;
  }

  function showError(message) {
    error.textContent = message;
    error.hidden = false;
    input.setAttribute('aria-invalid', 'true');
  }

  function clearError() {
    error.hidden = true;
    error.textContent = '';
    input.removeAttribute('aria-invalid');
  }

  function syncUnitUi() {
    const isMHz = entryUnit === 'mhz';
    unitLabel.textContent = isMHz ? 'MHz' : 'kHz';
    help.textContent = isMHz
      ? '0.030–30 MHz · examples: 0.560, 9.955, 14.2005'
      : '30–30,000 kHz · examples: 560, 9955, 14200.5';
    for (const button of unitButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.entryUnit === entryUnit));
    }
  }

  function setEntryUnit(nextUnit, { convert = true } = {}) {
    if (nextUnit !== 'khz' && nextUnit !== 'mhz') return;
    if (nextUnit === entryUnit) return;

    let kHz = NaN;
    if (convert) {
      const value = rawEntryValue(entryUnit);
      if (Number.isFinite(value)) kHz = entryUnit === 'mhz' ? value * 1000 : value;
    }

    entryUnit = nextUnit;
    syncUnitUi();
    clearError();
    if (Number.isFinite(kHz)) {
      input.value = formatForUnit(kHz, entryUnit);
      input.select();
    }
  }

  function openDialog() {
    clearError();
    syncUnitUi();
    input.value = formatForUnit(currentKHz());
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    window.setTimeout(() => {
      input.focus({ preventScroll: true });
      input.select();
    }, 0);
  }

  function closeDialog() {
    clearError();
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    readout.focus({ preventScroll: true });
  }

  function primeOffState(targetKHz) {
    if (bridge) bridge.textContent = (targetKHz / 1000).toFixed(6);
    if (centerMark) centerMark.textContent = `VIEW ${targetKHz.toFixed(3)} kHz`;
    display.textContent = targetKHz.toFixed(3);
    if (displayUnit) displayUnit.textContent = 'kHz';
  }

  function requestTune(targetKHz) {
    const mode = activeMode();
    tuneBridge.dataset.bandKhz = String(targetKHz);
    tuneBridge.dataset.bandMode = mode;

    // While the receiver is stopped, also prime the visible shell so the chosen
    // target is obvious immediately. Zero's existing controls still own the
    // pending tune that is applied when START opens the qualified session.
    if (power?.getAttribute('aria-pressed') !== 'true') primeOffState(targetKHz);

    tuneBridge.click();
  }

  readout.addEventListener('click', openDialog);
  readout.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openDialog();
  });

  for (const button of unitButtons) {
    button.addEventListener('click', () => setEntryUnit(button.dataset.entryUnit));
  }

  cancel.addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDialog();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog();
  });

  input.addEventListener('input', clearError);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const targetKHz = parseInputKHz();
    if (!Number.isFinite(targetKHz)) {
      showError(entryUnit === 'mhz'
        ? 'Enter a frequency in MHz, using up to six decimal places.'
        : 'Enter a frequency in kHz, using up to three decimal places.');
      return;
    }
    if (targetKHz < 30 || targetKHz > 30000) {
      showError(entryUnit === 'mhz'
        ? 'Frequency must be between 0.030 and 30 MHz.'
        : 'Frequency must be between 30 and 30,000 kHz.');
      return;
    }

    requestTune(Math.round(targetKHz * 1000) / 1000);
    closeDialog();
  });
})();