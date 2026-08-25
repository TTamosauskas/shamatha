(() => {
  'use strict';

  const unitName = document.getElementById('currentUnitName');
  const continuePath = document.getElementById('continuePath');
  const unitScroll = document.getElementById('unitScroll');

  function syncLoadingState() {
    if (!unitName || !continuePath) return;
    const loading = /carregando caminho/i.test(String(unitName.textContent || ''));
    continuePath.classList.toggle('hidden', loading);
  }

  function moveObjectiveBelowVideo() {
    if (!unitScroll) return;
    const objective = unitScroll.querySelector('.unit-heading > p:not(.eyebrow)');
    if (!objective) return;
    const media = unitScroll.querySelector('.video-frame, .media-empty');
    if (!media) return;
    objective.classList.add('stage-objective');
    media.insertAdjacentElement('afterend', objective);
  }

  syncLoadingState();
  moveObjectiveBelowVideo();

  if (unitName) {
    new MutationObserver(syncLoadingState).observe(unitName, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  if (unitScroll) {
    new MutationObserver(moveObjectiveBelowVideo).observe(unitScroll, {
      childList: true,
      subtree: true
    });
  }
})();
