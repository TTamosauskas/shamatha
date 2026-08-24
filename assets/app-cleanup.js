(() => {
  'use strict';
  const scroll = document.getElementById('unitScroll');
  if (!scroll) return;

  function cleanPracticeView() {
    document.getElementById('backFromPreparation')?.remove();
    scroll.querySelector('.active-started')?.remove();
  }

  const observer = new MutationObserver(cleanPracticeView);
  observer.observe(scroll, { childList: true, subtree: true });
  cleanPracticeView();
})();
