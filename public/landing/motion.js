/* Gallery transitions. Pixel playback lives in illustrations.js. */
(() => {
  'use strict';
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const connection = navigator.connection;
  const cards = [...document.querySelectorAll('.game-card')];
  const still = () => reduced.matches || connection?.saveData || root.classList.contains('motion-paused');
  function syncMotion() {
    if (still()) cards.forEach(card => card.getAnimations().forEach(animation => animation.cancel()));
  }
  if ('IntersectionObserver' in window) {
    const reveal = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('visible');
        reveal.unobserve(entry.target);
      });
    }, { threshold: .06 });
    cards.forEach(card => reveal.observe(card));
  } else cards.forEach(card => card.classList.add('visible'));
  window.addEventListener('gammaru:filterchange', () => {
    let index = 0;
    cards.forEach(card => {
      if (card.hidden) return;
      card.classList.add('visible');
      card.getAnimations().forEach(animation => animation.cancel());
      if (!still()) card.animate([
        { opacity: 0, transform: 'translateY(24px)', clipPath: 'inset(0 0 16% 0)' },
        { opacity: 1, transform: 'translateY(0)', clipPath: 'inset(0)' },
      ], { duration: 400, delay: index * 40, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'backwards' });
      index++;
    });
  });
  window.addEventListener('gammaru:motionchange', syncMotion);
  reduced.addEventListener('change', syncMotion);
  connection?.addEventListener('change', syncMotion);
  document.addEventListener('visibilitychange', syncMotion);
  syncMotion();
})();
