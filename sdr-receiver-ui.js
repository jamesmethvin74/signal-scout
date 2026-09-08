(() => {
  // sdr-player.js creates the lookup receiver control dynamically. Normalize
  // its markup after creation so the title and explanation are independent
  // update targets rather than a nested span. This keeps later smart-receiver
  // updates from replacing their own child nodes and also gives the control a
  // stable mobile-friendly layout.
  const button = document.getElementById('lookupReceiverButton');
  if (!button) return;

  const currentMeta = button.querySelector('span')?.textContent?.trim()
    || 'FreqBeacon will rank public SDRs for this frequency';
  const currentBadge = button.querySelector('b')?.textContent?.trim() || 'SMART';

  button.innerHTML = `
    <div class="lookup-receiver-smart-main">
      <strong>Automatic receiver selection</strong>
      <span>${currentMeta}</span>
    </div>
    <b>${currentBadge}</b>`;

  const style = document.createElement('style');
  style.id = 'signal-scout-sdr-receiver-ui-styles';
  style.textContent = `
    .lookup-receiver-smart-main { min-width:0; }
    .lookup-receiver-smart-main strong,
    .lookup-receiver-smart-main span {
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
    }
    .sdr-card-options-context { display:none !important; }
  `;
  document.head.appendChild(style);

  function frequencyFromCard(card) {
    const freqEl = card?.querySelector('.frequency');
    if (!freqEl) return null;
    const unit = freqEl.querySelector('span')?.textContent?.trim().toLowerCase() || '';
    const clone = freqEl.cloneNode(true);
    clone.querySelector('span')?.remove();
    const value = Number(clone.textContent.replace(/,/g, '').trim());
    if (!Number.isFinite(value) || value <= 0) return null;
    return unit.includes('mhz') ? value * 1000 : value;
  }

  function installCardContext(card) {
    const frequency = frequencyFromCard(card);
    if (!Number.isFinite(frequency)) return null;
    const station = card.querySelector('.station-name')?.textContent?.trim() || 'Live signal';
    const results = document.getElementById('lookupResults');
    const input = document.getElementById('lookupFrequency');
    if (!results || !input) return null;

    results.querySelectorAll('[data-sdr-card-options-context]').forEach((node) => node.remove());
    const context = document.createElement('div');
    context.className = 'lookup-result sdr-card-options-context';
    context.dataset.sdrCardOptionsContext = 'true';
    context.hidden = true;
    context.innerHTML = `<div class="lookup-result-frequency">${frequency.toLocaleString(undefined, { maximumFractionDigits: 1 })} kHz</div><h3></h3>`;
    context.querySelector('h3').textContent = station;
    results.prepend(context);

    input.value = Number.isInteger(frequency) ? String(frequency) : frequency.toFixed(1);
    input.dispatchEvent(new Event('input', { bubbles:false }));
    return context;
  }

  // Home-card Receiver Options should use the same server-ranked receiver list
  // as Listen Live. Do not install a second fetch/ranking layer in the browser.
  // A short-lived hidden lookup result supplies the existing player with the
  // card's station/frequency context without navigating away from On air.
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('.card-receiver-options');
    if (!trigger) return;
    const card = trigger.closest('.signal-card');
    if (!card) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const context = installCardContext(card);
    if (!context) return;

    button.click();
    window.setTimeout(() => {
      if (context.isConnected) context.remove();
    }, 7500);
  }, true);
})();
