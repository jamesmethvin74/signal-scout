(() => {
  'use strict';

  // UI-only tuning aid. This decorates the existing qualified frequency readout
  // and deliberately does not own frequency state, tuning commands, sockets, or RF.
  const display = document.querySelector('#frequencyDisplay');
  const unit = document.querySelector('#frequencyUnit');
  const stepValue = document.querySelector('#stepValue');

  if (!display || !unit || !stepValue) return;

  function stepHz() {
    const match = String(stepValue.textContent || '').trim().match(/([\d.]+)\s*(k?hz)/i);
    if (!match) return NaN;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return NaN;
    return amount * (/^khz$/i.test(match[2]) ? 1000 : 1);
  }

  function unitExponent() {
    const label = String(unit.textContent || '').trim().toLowerCase();
    if (label === 'mhz') return 6;
    if (label === 'khz') return 3;
    if (label === 'hz') return 0;
    return NaN;
  }

  function digitExponent(text, index, baseExponent) {
    const dot = text.indexOf('.');
    const decimalIndex = dot >= 0 ? dot : text.length;

    if (index < decimalIndex) {
      let digitsToRight = 0;
      for (let i = index + 1; i < decimalIndex; i += 1) {
        if (/\d/.test(text[i])) digitsToRight += 1;
      }
      return baseExponent + digitsToRight;
    }

    let digitsAfterDecimal = 0;
    for (let i = decimalIndex + 1; i <= index; i += 1) {
      if (/\d/.test(text[i])) digitsAfterDecimal += 1;
    }
    return baseExponent - digitsAfterDecimal;
  }

  function placeLabel(exponent) {
    const labels = new Map([
      [6, 'MHz'],
      [5, '100 kHz'],
      [4, '10 kHz'],
      [3, '1 kHz'],
      [2, '100 Hz'],
      [1, '10 Hz'],
      [0, '1 Hz']
    ]);
    return labels.get(exponent) || `10^${exponent} Hz`;
  }

  function decorateFrequency() {
    const text = String(display.textContent || '').trim();
    const step = stepHz();
    const baseExponent = unitExponent();

    // controls.js briefly emits comma-grouped Hz before the existing UX formatter
    // converts it to the final kHz/MHz display. Wait for that formatter rather than
    // racing or replacing it.
    if (!text || text.includes(',') || !Number.isFinite(step) || !Number.isFinite(baseExponent)) return;

    const targetExponent = Math.floor(Math.log10(Math.max(1, step)));
    const signature = `${text}|${unit.textContent}|${step}|${targetExponent}`;
    if (display.dataset.stepIndicatorSignature === signature) return;

    const fragment = document.createDocumentFragment();
    let marked = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (!/\d/.test(char)) {
        fragment.append(document.createTextNode(char));
        continue;
      }

      const digit = document.createElement('span');
      digit.className = 'zero-frequency-digit';
      digit.textContent = char;

      const exponent = digitExponent(text, index, baseExponent);
      if (!marked && exponent === targetExponent) {
        marked = true;
        digit.classList.add('is-step-place');
        digit.dataset.stepPlace = placeLabel(exponent);
      }

      fragment.append(digit);
    }

    display.dataset.stepIndicatorSignature = signature;
    display.replaceChildren(fragment);
    display.dataset.stepPlace = marked ? placeLabel(targetExponent) : '';
  }

  const displayObserver = new MutationObserver(decorateFrequency);
  displayObserver.observe(display, { childList: true, characterData: true, subtree: true });

  const stepObserver = new MutationObserver(decorateFrequency);
  stepObserver.observe(stepValue, { childList: true, characterData: true, subtree: true });

  const unitObserver = new MutationObserver(decorateFrequency);
  unitObserver.observe(unit, { childList: true, characterData: true, subtree: true });

  decorateFrequency();
})();
