(() => {
  'use strict';

  const card = document.getElementById('globeReceiverCard');
  const scroll = document.querySelector('.explore-app > .fb-page-scroll');
  const nav = document.querySelector('.fb-bottom-nav');
  if (!card || !scroll || !nav) return;

  let revealFrame = 0;
  let settleTimer = 0;

  function visibleBottom() {
    const navRect = nav.getBoundingClientRect();
    const viewportHeight = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight;
    return Math.min(navRect.top, viewportHeight) - 12;
  }

  function revealCard({ smooth = true } = {}) {
    if (card.hidden) return;
    cancelAnimationFrame(revealFrame);
    revealFrame = requestAnimationFrame(() => {
      const rect = card.getBoundingClientRect();
      const bottom = visibleBottom();
      const overlap = rect.bottom - bottom;
      if (overlap <= 0) return;
      scroll.scrollBy({
        top: overlap + 12,
        behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto'
      });
    });
  }

  const observer = new MutationObserver((mutations) => {
    if (!mutations.some((mutation) => mutation.type === 'attributes' && mutation.attributeName === 'hidden')) return;
    if (card.hidden) return;
    revealCard({ smooth: true });
    clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => revealCard({ smooth: false }), 260);
  });

  observer.observe(card, { attributes: true, attributeFilter: ['hidden'] });
  window.visualViewport?.addEventListener('resize', () => revealCard({ smooth: false }), { passive: true });
  window.addEventListener('orientationchange', () => window.setTimeout(() => revealCard({ smooth: false }), 120), { passive: true });
})();
