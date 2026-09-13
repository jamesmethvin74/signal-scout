(() => {
  'use strict';

  const form = document.querySelector('#lookupForm');
  const input = document.querySelector('#lookupFrequency');
  const submit = form?.querySelector('.lookup-submit');
  const stage = document.querySelector('#lookupStage');
  const status = document.querySelector('#lookupStatus');
  if (!form || !input || !submit || !stage || !status) return;

  let activeLookup = 0;
  let resetTimer = 0;
  let settleTimer = 0;

  function normalizeFrequencyLabel(raw) {
    const text = String(raw || '').trim();
    if (!text) return 'frequency';
    return /mhz|khz/i.test(text) ? text : `${text} kHz`;
  }

  function fixReturnLinks() {
    document.querySelectorAll('.lookup-action-secondary[href="/"], a.lookup-brand[href="/"]').forEach((link) => {
      link.href = '/zero';
      if (link.classList.contains('lookup-action-secondary')) link.textContent = 'Back to radio';
      if (link.classList.contains('lookup-brand')) link.setAttribute('aria-label', 'Return to FREQBEACON radio');
    });
  }

  function beginLookup(rawFrequency) {
    window.clearTimeout(resetTimer);
    window.clearTimeout(settleTimer);
    activeLookup += 1;
    submit.disabled = true;
    submit.textContent = 'IDENTIFYING…';
    stage.setAttribute('aria-busy', 'true');
    stage.classList.add('lookup-stage-searching');
    status.className = 'lookup-status lookup-status-working';
    status.innerHTML = `<i aria-hidden="true"></i><span>Searching ${escapeText(normalizeFrequencyLabel(rawFrequency))}… checking the FREQBEACON catalog.</span>`;
  }

  function escapeText(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function resultMessage() {
    const card = stage.querySelector('.lookup-result-card');
    if (card) {
      const frequency = card.querySelector('.lookup-result-frequency')?.textContent?.trim() || normalizeFrequencyLabel(input.value);
      const identity = card.querySelector('h2')?.textContent?.trim() || 'known signal';
      return { kind: 'done', text: `Identified ${frequency} — ${identity}` };
    }

    const empty = stage.querySelector('.lookup-empty');
    if (empty) {
      const heading = empty.querySelector('strong')?.textContent?.trim() || normalizeFrequencyLabel(input.value);
      const body = empty.querySelector('p')?.textContent?.trim() || '';
      if (/enter a frequency/i.test(heading) || /examples:/i.test(body)) {
        return { kind: 'error', text: 'Enter a valid frequency from 30 to 30,000 kHz.' };
      }
      if (/no exact station|no exact identity|no exact/i.test(body)) {
        return { kind: 'done', text: `Lookup complete for ${heading} — no exact identity is cataloged yet.` };
      }
      return { kind: 'done', text: `Lookup complete for ${heading}.` };
    }

    return { kind: 'done', text: `Lookup complete for ${normalizeFrequencyLabel(input.value)}.` };
  }

  function completeLookup() {
    if (!activeLookup) return;
    const result = resultMessage();
    activeLookup = 0;
    stage.removeAttribute('aria-busy');
    stage.classList.remove('lookup-stage-searching');
    stage.classList.add('lookup-stage-updated');
    window.setTimeout(() => stage.classList.remove('lookup-stage-updated'), 700);

    status.className = `lookup-status lookup-status-${result.kind}`;
    status.innerHTML = `<b aria-hidden="true">${result.kind === 'error' ? '!' : '✓'}</b><span>${escapeText(result.text)}</span>`;
    submit.disabled = false;
    submit.textContent = result.kind === 'error' ? 'TRY AGAIN' : 'IDENTIFIED ✓';

    resetTimer = window.setTimeout(() => {
      submit.textContent = 'IDENTIFY';
    }, 1800);
  }

  function considerCompletion() {
    fixReturnLinks();
    if (!activeLookup) return;
    if (stage.querySelector('#lookupLoading, .lookup-loading')) return;
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(completeLookup, 90);
  }

  form.addEventListener('submit', () => beginLookup(input.value), true);

  document.querySelectorAll('[data-quick]').forEach((button) => {
    button.addEventListener('click', () => beginLookup(button.dataset.quick || input.value), true);
  });

  const observer = new MutationObserver(considerCompletion);
  observer.observe(stage, { childList: true, subtree: true });

  fixReturnLinks();
})();
