(() => {
  // sdr-player.js creates the lookup receiver control dynamically. Normalize
  // its markup after creation so the title and explanation are independent
  // update targets rather than a nested span. This keeps later smart-receiver
  // updates from replacing their own child nodes and also gives the control a
  // stable mobile-friendly layout.
  const button = document.getElementById('lookupReceiverButton');
  if (!button) return;

  const currentMeta = button.querySelector('span')?.textContent?.trim()
    || 'Signal Scout will rank public SDRs for this frequency';
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
  `;
  document.head.appendChild(style);

  const optionsFix = document.createElement('script');
  optionsFix.src = 'sdr-options-fix.js?v=2';
  optionsFix.defer = true;
  document.body.appendChild(optionsFix);
})();
