(() => {
  let queued = false;

  function scan() {
    queued = false;
    document.querySelectorAll('.program-guide-card.is-broadcast').forEach((slot) => {
      const source = slot.querySelector('.program-guide-source')?.textContent || '';
      if (!/AOKI|NDXC/i.test(source)) return;
      if (slot.dataset.scheduleMatchLabel === 'true') return;
      const kicker = slot.querySelector('.program-guide-kicker');
      if (!kicker) return;
      kicker.innerHTML = '<span class="program-broadcast-dot"></span>ON NOW · SCHEDULE MATCH';
      slot.dataset.scheduleMatchLabel = 'true';
    });
  }

  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(scan);
  }

  new MutationObserver(queue).observe(document.body,{childList:true,subtree:true,characterData:true});
  queue();
  setTimeout(queue,750);
  setTimeout(queue,2000);
})();
