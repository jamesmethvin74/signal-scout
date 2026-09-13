(() => {
  'use strict';

  function normalizeTuneLink(target) {
    const link = target?.closest?.('a.lookup-category-tune');
    if (!link) return;

    try {
      const url = new URL(link.getAttribute('href') || link.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname !== '/zero') return;
      if (url.searchParams.get('from') !== 'lookup-category') return;
      url.searchParams.set('from', 'lookup');
      link.href = `${url.pathname}${url.search}${url.hash}`;
    } catch {
      // Leave an unparseable link untouched.
    }
  }

  document.addEventListener('pointerdown', (event) => normalizeTuneLink(event.target), true);
  document.addEventListener('click', (event) => normalizeTuneLink(event.target), true);
})();
